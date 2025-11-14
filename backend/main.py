from fastapi import FastAPI, HTTPException, Depends, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import JSONResponse
from fastapi.responses import RedirectResponse
from contextlib import asynccontextmanager
import asyncio
import uvicorn
from datetime import datetime
import os
import logging
from typing import List, Optional, Dict, Any, Annotated
from pydantic import BaseModel, Field
import uuid
import hashlib
import hmac
from urllib.parse import quote

from app.database import MongoDB
from app.models import Meeting, MeetingCreate, MeetingUpdate, Metadata, Room, RoomAvailability, User, Poll
from app.services import MeetingService, MetadataService, UserService, PollService
from app.google_calendar import (
    generate_auth_url,
    exchange_code_for_tokens,
    create_event_with_meet,
    create_calendar_event,
    update_event_attendees,
    update_event,
    delete_event,
)
import anyio
from app.notification_service import notification_service
from app.email_reply_listener import EmailReplyListener
from app.auth import create_access_token, get_current_user_token, get_optional_user_token, security
from app.ai_service import ai_service
from google.oauth2 import id_token as google_id_token
from google.auth.transport import requests as google_requests
from app.calendar_service import list_events as calendar_list_events, get_free_busy
from app.rooms_catalog import ROOMS_CATALOG
from dateutil import parser as date_parser
from datetime import timezone, timedelta
from zoneinfo import ZoneInfo
from jose import jwt, JWTError


def _ensure_tz(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _parse_busy_entry(entry: Dict[str, str]) -> tuple[datetime, datetime]:
    start = _ensure_tz(date_parser.isoparse(entry["start"]))
    end = _ensure_tz(date_parser.isoparse(entry["end"]))
    return start, end


def _merge_intervals(intervals: List[tuple[datetime, datetime]]) -> List[tuple[datetime, datetime]]:
    if not intervals:
        return []
    intervals = sorted(intervals, key=lambda x: x[0])
    merged = [list(intervals[0])]
    for start, end in intervals[1:]:
        if start <= merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], end)
        else:
            merged.append([start, end])
    return [(start, end) for start, end in merged]


MAX_SUGGESTION_POOL = 96  # cover 48 half-hour slots across a day


def _generate_suggestions(
    busy_intervals: List[tuple[datetime, datetime]],
    window_start: datetime,
    window_end: datetime,
    duration: timedelta,
    increment: timedelta,
    max_suggestions: int,
) -> List[Dict[str, datetime]]:
    suggestions: List[Dict[str, datetime]] = []
    cursor = window_start
    for start, end in busy_intervals:
        if cursor < start:
            slot_start = cursor
            while slot_start + duration <= min(start, window_end):
                suggestions.append({"start": slot_start, "end": slot_start + duration})
                if len(suggestions) >= MAX_SUGGESTION_POOL:
                    return suggestions
                slot_start += increment
        cursor = max(cursor, end)
        if cursor >= window_end:
            break
    while cursor + duration <= window_end and len(suggestions) < MAX_SUGGESTION_POOL:
        suggestions.append({"start": cursor, "end": cursor + duration})
        cursor += increment
    return suggestions


DAYPART_BUCKETS = (
    ("morning", 6, 12),
    ("afternoon", 12, 17),
    ("evening", 17, 22),
)
QUIET_HOURS = (6, 22)  # inclusive start, exclusive end

POLL_TOKEN_SECRET = os.getenv("POLL_TOKEN_SECRET") or os.getenv("JWT_SECRET_KEY") or "dev-poll-token-secret"
POLL_TOKEN_SECRET_BYTES = POLL_TOKEN_SECRET.encode("utf-8")
POLL_TOKEN_ALGORITHM = "HS256"
POLL_TOKEN_TTL_HOURS = int(os.getenv("POLL_TOKEN_TTL_HOURS", str(24 * 7)))

logger = logging.getLogger(__name__)


def _poll_token_expiration(deadline: Optional[datetime]) -> datetime:
    default_exp = datetime.now(timezone.utc) + timedelta(hours=POLL_TOKEN_TTL_HOURS)
    if not deadline:
        return default_exp
    deadline_utc = _ensure_tz(deadline)
    return min(default_exp, deadline_utc)


def generate_poll_token(poll_id: str, email: str, deadline: Optional[datetime]) -> str:
    exp = _poll_token_expiration(deadline)
    payload = {
        "poll_id": poll_id,
        "email": email.lower(),
        "exp": int(exp.timestamp()),
    }
    return jwt.encode(payload, POLL_TOKEN_SECRET, algorithm=POLL_TOKEN_ALGORITHM)


def verify_poll_token(poll_id: str, token: str) -> Optional[str]:
    if not token:
        return None
    try:
        payload = jwt.decode(token, POLL_TOKEN_SECRET, algorithms=[POLL_TOKEN_ALGORITHM])
    except JWTError:
        return None
    if payload.get("poll_id") != poll_id:
        return None
    email = payload.get("email")
    if not email:
        return None
    return str(email)


def _legacy_poll_token_input(poll_id: str, email: str) -> bytes:
    return f"{poll_id}:{email.lower()}".encode("utf-8")


def verify_legacy_poll_token(poll_id: str, email: str, token: Optional[str]) -> bool:
    if not token or not email:
        return False
    expected = hmac.new(POLL_TOKEN_SECRET_BYTES, _legacy_poll_token_input(poll_id, email), hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, token)


def _get_allowed_voter_emails(poll: Poll, meeting: Meeting) -> set[str]:
    allowed = {participant.email.lower() for participant in meeting.participants}
    if poll.organizer_email:
        allowed.add(poll.organizer_email.lower())
    return allowed


def _resolve_voter_identity(
    poll: Poll,
    meeting: Meeting,
    token: Optional[str],
    voter_email_param: Optional[str],
    current_user: Optional[User],
    *,
    require_identity: bool,
) -> Optional[str]:
    allowed_emails = _get_allowed_voter_emails(poll, meeting)
    poll_id_str = str(poll.id)
    token_email = verify_poll_token(poll_id_str, token) if token else None
    if token and not token_email:
        raise HTTPException(status_code=403, detail="Invalid or missing poll token.")

    legacy_email = None
    if not token_email and voter_email_param:
        if verify_legacy_poll_token(poll_id_str, voter_email_param, token):
            legacy_email = voter_email_param.lower()

    user_email = current_user.email.lower() if current_user else None
    if token_email and user_email and token_email != user_email:
        raise HTTPException(
            status_code=403,
            detail="This poll link is tied to a different participant.",
        )

    candidate = token_email or user_email or legacy_email
    if candidate and candidate not in allowed_emails:
        if require_identity:
            raise HTTPException(
                status_code=403,
                detail="Only invited participants may vote.",
            )
        candidate = None

    if require_identity and not candidate:
        raise HTTPException(
            status_code=403,
            detail="Sign in or use your personalized poll link to vote.",
        )

    return candidate


async def _apply_poll_outcome(poll: Poll) -> Optional[Meeting]:
    if meeting_service is None:
        return None
    meeting = await meeting_service.get_meeting(poll.meeting_id)
    if not meeting:
        return None
    if poll.winning_option_id:
        winning_option = next((opt for opt in poll.options if opt.id == poll.winning_option_id), None)
        if winning_option:
            update = MeetingUpdate(
                start_time=winning_option.start_time,
                end_time=winning_option.end_time,
                status="scheduled",
            )
            updated_meeting = await meeting_service.update_meeting(poll.meeting_id, update)
            meeting = updated_meeting or meeting
            meta = dict(meeting.metadata or {})
            if meta.pop("poll_pending", None):
                updated_meta = await meeting_service.update_meeting_metadata(poll.meeting_id, meta)
                meeting = updated_meta or meeting
            for participant in meeting.participants:
                await notification_service.send_poll_finalized(meeting, participant, winning_option)
    return meeting


class PollAutoFinalizer:
    def __init__(self, poll_service: PollService, interval_seconds: int = 60):
        self.poll_service = poll_service
        self.interval_seconds = interval_seconds
        self._task: Optional[asyncio.Task] = None

    async def start(self):
        if self._task:
            return
        loop = asyncio.get_running_loop()
        self._task = loop.create_task(self._run())

    async def stop(self):
        if not self._task:
            return
        self._task.cancel()
        try:
            await self._task
        except asyncio.CancelledError:
            pass
        self._task = None

    async def _run(self):
        while True:
            try:
                finalized_polls = await self.poll_service.finalize_expired_polls()
                if finalized_polls:
                    for poll in finalized_polls:
                        try:
                            await _apply_poll_outcome(poll)
                        except Exception as exc:
                            logger.error("Failed to apply poll outcome for %s: %s", poll.id, exc)
                    logger.info("Auto-finalized %s polls after deadline", len(finalized_polls))
            except asyncio.CancelledError:
                break
            except Exception as exc:
                logger.error("Poll auto-finalizer encountered an error: %s", exc)
            await asyncio.sleep(self.interval_seconds)


def _get_zone(tz_name: Optional[str]) -> ZoneInfo:
    try:
        return ZoneInfo(tz_name) if tz_name else ZoneInfo("UTC")
    except Exception:
        return ZoneInfo("UTC")


def _prioritize_human_friendly_slots(
    slots: List[Dict[str, datetime]],
    tz_name: Optional[str],
    max_suggestions: int,
) -> List[Dict[str, datetime]]:
    if not slots:
        return []

    tz = _get_zone(tz_name)
    in_hours: List[Dict[str, datetime]] = []
    out_of_hours: List[Dict[str, datetime]] = []

    for slot in slots:
        local_start = slot["start"].astimezone(tz)
        hour = local_start.hour
        if QUIET_HOURS[0] <= hour < QUIET_HOURS[1]:
            in_hours.append({**slot, "_local_hour": hour})
        else:
            out_of_hours.append(slot)

    if not in_hours:
        return slots[:max_suggestions]

    buckets: Dict[str, List[Dict[str, datetime]]] = {name: [] for name, _, _ in DAYPART_BUCKETS}
    leftovers: List[Dict[str, datetime]] = []
    for slot in in_hours:
        hour = slot.pop("_local_hour")
        placed = False
        for name, start_hour, end_hour in DAYPART_BUCKETS:
            if start_hour <= hour < end_hour:
                buckets[name].append(slot)
                placed = True
                break
        if not placed:
            leftovers.append(slot)

    prioritized: List[Dict[str, datetime]] = []
    while len(prioritized) < max_suggestions:
        picked = False
        for name, _, _ in DAYPART_BUCKETS:
            bucket = buckets[name]
            if bucket:
                prioritized.append(bucket.pop(0))
                picked = True
                if len(prioritized) >= max_suggestions:
                    break
        if not picked:
            break

    if len(prioritized) < max_suggestions:
        remaining: List[Dict[str, datetime]] = []
        for name, _, _ in DAYPART_BUCKETS:
            remaining.extend(buckets[name])
        remaining.extend(leftovers)
        remaining.extend(out_of_hours)
        for slot in remaining:
            if slot not in prioritized:
                prioritized.append(slot)
            if len(prioritized) >= max_suggestions:
                break

    return prioritized[:max_suggestions]

# Request models for notification endpoints
class UpdateNotificationRequest(BaseModel):
    changes_description: str

class CancellationNotificationRequest(BaseModel):
    cancellation_reason: str

class AddParticipantsRequest(BaseModel):
    emails: List[str] = Field(default_factory=list)


class AvailabilityRequest(BaseModel):
    participants: List[str]
    duration_minutes: int
    window_start: datetime
    window_end: datetime
    slot_increment_minutes: int = 30
    max_suggestions: int = 5
    client_timezone: Optional[str] = None


class PollOptionPayload(BaseModel):
    start_time: datetime
    end_time: datetime


class CreatePollRequest(BaseModel):
    options: List[PollOptionPayload]
    deadline: Optional[datetime] = None


class VoteRequest(BaseModel):
    option_id: str
    token: Optional[str] = None
    voter_email: Optional[str] = None


class FinalizePollRequest(BaseModel):
    option_id: Optional[str] = None


class RoomsAvailabilityResponse(BaseModel):
    rooms: List[RoomAvailability]


CurrentUser = Annotated[User, Depends(get_current_user_token)]
OptionalCurrentUser = Annotated[Optional[User], Depends(get_optional_user_token)]


def _ensure_meeting_owner(meeting: Meeting, current_user: CurrentUser) -> None:
    """Guard that only the organizer can mutate/read their meetings."""
    if meeting.organizer_email and meeting.organizer_email != current_user.email:
        raise HTTPException(status_code=403, detail="You can only manage meetings you created.")

# Initialize services after database connection
meeting_service = None
metadata_service = None
user_service = None
poll_service = None
poll_auto_finalizer: Optional["PollAutoFinalizer"] = None

async def process_email_reply(meeting_id: str, from_email: str, action: str, payload: str | None):
    # Basic placeholder actions: record metadata; real logic can update meetings
    metadata_key = f"reply:{meeting_id}:{from_email}:{datetime.now(timezone.utc).isoformat()}"
    await metadata_service.create_metadata(
        key=metadata_key,
        value={"action": action, "payload": payload},
        metadata_type="email_reply",
        description="Email reply processed"
    )


reply_listener: EmailReplyListener | None = None
GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID")


@asynccontextmanager
async def lifespan(app: FastAPI):
    print("Starting Meeting Scheduler Backend...")
    await MongoDB.connect_to_mongo()
    
    # Initialize services after database connection
    global meeting_service, metadata_service, user_service, poll_service, poll_auto_finalizer
    meeting_service = MeetingService()
    metadata_service = MetadataService()
    user_service = UserService()
    poll_service = PollService()
    global reply_listener
    reply_listener = EmailReplyListener(process_email_reply)
    await reply_listener.start()
    poll_auto_finalizer = PollAutoFinalizer(
        poll_service,
        interval_seconds=int(os.getenv("POLL_FINALIZER_INTERVAL_SECONDS", "60")),
    )
    await poll_auto_finalizer.start()
    
    yield
    print("Shutting down Meeting Scheduler Backend...")
    if reply_listener:
        await reply_listener.stop()
    if poll_auto_finalizer:
        await poll_auto_finalizer.stop()
    await MongoDB.close_mongo_connection()

app = FastAPI(
    title="Meeting Scheduler API",
    description="AI-powered meeting scheduling API",
    version="1.0.0",
    lifespan=lifespan
)

# Temporarily disable authentication for development
# security = HTTPBearer()

app.add_middleware(
    CORSMiddleware,
    allow_origins=[os.getenv("FRONTEND_URL", "http://localhost:3000")],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.add_middleware(
    TrustedHostMiddleware,
    allowed_hosts=["*"]
)

@app.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "service": "meeting-scheduler-backend"
    }


@app.get("/api/health")
async def health_check_api():
    return await health_check()


@app.get("/api/me")
async def get_me(current_user: CurrentUser):
    user_dict = current_user.model_dump()
    user_dict.pop("preferences", None)
    user_dict.pop("calendars", None)
    if "id" in user_dict and user_dict["id"] is not None:
        user_dict["id"] = str(user_dict["id"])
    if "_id" in user_dict and user_dict["_id"] is not None:
        user_dict["_id"] = str(user_dict["_id"])
    return user_dict


@app.get("/api/rooms", response_model=List[Room])
async def list_rooms(current_user: CurrentUser):
    return ROOMS_CATALOG


@app.get("/api/rooms/availability", response_model=RoomsAvailabilityResponse)
async def room_availability(
    current_user: CurrentUser,
    start_time: datetime = Query(..., description="Start of the window to check (ISO8601)"),
    end_time: datetime = Query(..., description="End of the window to check (ISO8601)"),
    exclude_meeting_id: Optional[str] = None,
):
    if end_time <= start_time:
        raise HTTPException(status_code=400, detail="end_time must be after start_time")
    availability = await meeting_service.get_rooms_availability(start_time, end_time, exclude_meeting_id)
    return RoomsAvailabilityResponse(rooms=availability)


@app.get("/api/calendars/events")
async def get_calendar_events(
    time_min: datetime,
    time_max: datetime,
    current_user: CurrentUser,
):
    creds = (current_user.preferences or {}).get("google_credentials")
    if not creds:
        raise HTTPException(status_code=400, detail="Google account not connected")
    try:
        events = await anyio.to_thread.run_sync(
            calendar_list_events,
            creds,
            _ensure_tz(time_min),
            _ensure_tz(time_max),
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to load events: {exc}") from exc
    return {"events": events}


@app.get("/api/auth/google/login")
async def google_login(redirect_uri: Optional[str] = Query(default=None)):
    if metadata_service is None:
        raise HTTPException(status_code=503, detail="Metadata service unavailable")
    state = str(uuid.uuid4())
    await metadata_service.create_metadata(
        key=f"oauth_state:{state}",
        value={
            "created_at": datetime.now(timezone.utc).isoformat(),
            "redirect_uri": redirect_uri,
        },
        metadata_type="oauth_state",
        description="Google auth state"
    )
    auth_url = generate_auth_url(state)
    return {"auth_url": auth_url}


@app.get("/api/auth/google/callback")
async def google_auth_callback(code: str, state: Optional[str] = None):
    if metadata_service is None or user_service is None:
        raise HTTPException(status_code=503, detail="Service unavailable")
    if not state:
        raise HTTPException(status_code=400, detail="Missing state parameter")
    state_key = f"oauth_state:{state}"
    state_entry = await metadata_service.get_metadata(state_key)
    if not state_entry:
        raise HTTPException(status_code=400, detail="Invalid or expired state")
    await metadata_service.delete_metadata(state_key)
    redirect_uri = None
    if isinstance(state_entry.value, dict):
        redirect_uri = state_entry.value.get("redirect_uri")

    tokens = exchange_code_for_tokens(code)
    id_token_jwt = tokens.get("id_token")
    if not id_token_jwt:
        raise HTTPException(status_code=400, detail="Missing id_token from Google response")

    try:
        id_info = google_id_token.verify_oauth2_token(
            id_token_jwt,
            google_requests.Request(),
            GOOGLE_CLIENT_ID
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid Google ID token") from exc

    email = id_info.get("email")
    sub = id_info.get("sub")
    name = id_info.get("name") or email
    picture = id_info.get("picture")

    if not email or not sub:
        raise HTTPException(status_code=400, detail="Google account missing email or subject")

    user = await user_service.upsert_google_user(
        email=email,
        name=name,
        google_sub=sub,
        picture=picture,
        credentials=tokens,
    )

    access_token = create_access_token({"sub": sub})

    if redirect_uri:
        redirect = f"{redirect_uri}?token={access_token}"
        return RedirectResponse(redirect)

    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user": user,
    }

@app.get("/api/meetings", response_model=List[Meeting])
async def get_meetings(current_user: CurrentUser):
    """Get all meetings for the current user"""
    return await meeting_service.get_all_meetings(current_user.email)

@app.post("/api/meetings", response_model=Meeting)
async def create_meeting(meeting_data: MeetingCreate, current_user: CurrentUser):
    """Create a new meeting"""
    # Validate that end time is after start time and start is in the future (unless poll pending)
    now = datetime.now(timezone.utc)
    start_time = _ensure_tz(meeting_data.start_time)
    end_time = _ensure_tz(meeting_data.end_time)
    meeting_data.start_time = start_time
    meeting_data.end_time = end_time
    poll_pending = bool((meeting_data.metadata or {}).get("poll_pending"))
    if not poll_pending and start_time <= now:
        raise HTTPException(status_code=400, detail="Start time must be in the future.")
    if end_time <= start_time:
        raise HTTPException(status_code=400, detail="End time must be after start time. Please choose an end time later than the start.")
    from datetime import timedelta
    if (end_time - start_time) < timedelta(minutes=5):
        raise HTTPException(status_code=400, detail="Meeting duration must be at least 5 minutes. Extend the end time or move the start time earlier.")

    # Create meeting in DB first
    try:
        meeting = await meeting_service.create_meeting(
            meeting_data,
            meeting_data.metadata,
            organizer_email=current_user.email,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    # Attempt to create calendar events if user connected Google
    try:
        user = current_user
        prefs = user.preferences if user else {}
        creds = prefs.get("google_credentials")
        location_type = (meeting.metadata or {}).get("location_type", "online")
        if creds:
            attendees = [p.email for p in meeting.participants]
            event_timezone = os.getenv("DEFAULT_TIMEZONE", "UTC")
            location_text = (meeting.metadata or {}).get("room_location") or (meeting.metadata or {}).get("room_name")
            from functools import partial
            if location_type == "online":
                create_fn = partial(
                    create_event_with_meet,
                    creds,
                    title=meeting.title,
                    description=meeting.description,
                    start_time=meeting.start_time,
                    end_time=meeting.end_time,
                    attendees=attendees,
                    timezone=event_timezone,
                )
            else:
                create_fn = partial(
                    create_calendar_event,
                    creds,
                    title=meeting.title,
                    description=meeting.description,
                    start_time=meeting.start_time,
                    end_time=meeting.end_time,
                    attendees=attendees,
                    timezone=event_timezone,
                    location=location_text,
                )
            created = await anyio.to_thread.run_sync(create_fn)
            # Update meeting metadata with Google event info
            new_meta = dict(meeting.metadata or {})
            if location_type == "online":
                new_meta["meeting_platform"] = "google_meet"
                if created.meet_url:
                    new_meta["meeting_url"] = created.meet_url
            if created.event_id:
                new_meta["google_event_id"] = created.event_id
            if created.html_link:
                new_meta["google_event_link"] = created.html_link
            meeting = await meeting_service.update_meeting_metadata(str(meeting.id), new_meta) or meeting
    except Exception as e:
        # Log and continue without failing meeting creation
        print(f"Google Calendar integration failed: {e}")

    return meeting


@app.post("/api/availability/suggest")
async def suggest_availability(request: AvailabilityRequest, current_user: CurrentUser):
    if not request.participants:
        raise HTTPException(status_code=400, detail="Participants are required")
    window_start = _ensure_tz(request.window_start)
    window_end = _ensure_tz(request.window_end)
    if window_end <= window_start:
        raise HTTPException(status_code=400, detail="window_end must be after window_start")
    duration = timedelta(minutes=request.duration_minutes)
    if duration <= timedelta(minutes=0):
        raise HTTPException(status_code=400, detail="duration_minutes must be positive")
    increment = timedelta(minutes=request.slot_increment_minutes)
    participants = list(dict.fromkeys([*(request.participants or []), current_user.email]))

    client_timezone = request.client_timezone or os.getenv("DEFAULT_TIMEZONE", "UTC")

    missing: List[str] = []
    missing_details: Dict[str, str] = {}
    busy: List[tuple[datetime, datetime]] = []

    for email in participants:
        user = await user_service.get_user(email)
        creds = (user.preferences or {}).get("google_credentials") if user else None
        if not creds:
            missing.append(email)
            missing_details[email] = "Google Calendar not connected"
            continue
        try:
            busy_blocks = await anyio.to_thread.run_sync(
                get_free_busy,
                creds,
                window_start,
                window_end,
            )
        except Exception as exc:
            missing.append(email)
            missing_details[email] = f"Calendar access failed: {exc}"
            continue
        for block in busy_blocks:
            busy.append(_parse_busy_entry(block))

    merged_busy = _merge_intervals(busy)
    suggestions = _generate_suggestions(
        merged_busy,
        window_start,
        window_end,
        duration,
        increment,
        request.max_suggestions,
    )
    now = datetime.now(timezone.utc)
    suggestions = [slot for slot in suggestions if slot["end"] > now]
    suggestions = _prioritize_human_friendly_slots(
        suggestions,
        client_timezone,
        request.max_suggestions,
    )

    return {
        "suggestions": [
            {"start": slot["start"].isoformat(), "end": slot["end"].isoformat()}
            for slot in suggestions
        ],
        "participants_missing": missing,
        "participants_missing_details": missing_details,
    }

class ConversationalScheduleRequest(BaseModel):
    message: str = Field(..., description="Natural language meeting request")
    timezone: Optional[str] = Field(None, description="User's timezone (e.g., 'America/New_York')")


class ConversationalScheduleResponse(BaseModel):
    success: bool
    meeting: Optional[Meeting] = None
    requires_clarification: bool = False
    clarification_message: Optional[str] = None
    parsed_data: Optional[Dict[str, Any]] = None
    error: Optional[str] = None


@app.post("/api/ai/schedule", response_model=ConversationalScheduleResponse)
async def conversational_schedule(
    request: ConversationalScheduleRequest,
    current_user: CurrentUser,
):
    """
    Schedule a meeting using natural language.
    
    Example requests:
    - "Schedule a 30-minute meeting with john@example.com tomorrow at 2pm"
    - "Create a meeting with alice@example.com and bob@example.com next Monday at 10am for 1 hour"
    - "Set up a team sync with the engineering team tomorrow afternoon"
    """
    try:
        # Parse the natural language request
        parsed = await ai_service.parse_scheduling_request(
            user_message=request.message,
            user_email=current_user.email,
            user_timezone=request.timezone,
        )
        
        # If clarification is needed, return early
        if parsed.get("requires_clarification"):
            return ConversationalScheduleResponse(
                success=False,
                requires_clarification=True,
                clarification_message=parsed.get("clarification_message"),
                parsed_data=parsed,
            )
        
        # Validate required fields
        if not parsed.get("title"):
            return ConversationalScheduleResponse(
                success=False,
                requires_clarification=True,
                clarification_message="Please provide a meeting title.",
                parsed_data=parsed,
            )
        
        if not parsed.get("participants"):
            return ConversationalScheduleResponse(
                success=False,
                requires_clarification=True,
                clarification_message="Please specify at least one participant.",
                parsed_data=parsed,
            )
        
        # Determine start and end times
        start_time = parsed.get("start_time")
        end_time = parsed.get("end_time")
        duration_minutes = parsed.get("duration_minutes", 30)
        
        # If no specific time provided, we need clarification
        if not start_time:
            return ConversationalScheduleResponse(
                success=False,
                requires_clarification=True,
                clarification_message="Please specify a time for the meeting. For example: 'tomorrow at 2pm' or 'next Monday at 10am'.",
                parsed_data=parsed,
            )
        
        # Calculate end_time if not provided
        if not end_time and duration_minutes:
            from datetime import timedelta
            end_time = start_time + timedelta(minutes=duration_minutes)
        elif not end_time:
            # Default to 30 minutes if no duration specified
            from datetime import timedelta
            end_time = start_time + timedelta(minutes=30)
        
        # Validate times
        now = datetime.now(timezone.utc)
        if start_time <= now:
            return ConversationalScheduleResponse(
                success=False,
                requires_clarification=True,
                clarification_message="Meeting start time must be in the future. Please specify a future time.",
                parsed_data=parsed,
            )
        
        if end_time <= start_time:
            return ConversationalScheduleResponse(
                success=False,
                requires_clarification=True,
                clarification_message="End time must be after start time.",
                parsed_data=parsed,
            )
        
        # Prepare metadata
        metadata = parsed.get("metadata", {})
        metadata["location_type"] = parsed.get("location_type", "online")
        if parsed.get("room_id"):
            metadata["room_id"] = parsed.get("room_id")
        if request.timezone:
            metadata["timezone"] = request.timezone
        metadata["ai_generated"] = True
        metadata["original_message"] = request.message
        
        # Create the meeting
        meeting_data = MeetingCreate(
            title=parsed["title"],
            description=parsed.get("description", ""),
            participants=parsed["participants"],
            start_time=start_time,
            end_time=end_time,
            preferred_date=parsed.get("preferred_date"),
            metadata=metadata,
        )
        
        meeting = await meeting_service.create_meeting(
            meeting_data,
            metadata,
            organizer_email=current_user.email,
        )
        
        return ConversationalScheduleResponse(
            success=True,
            meeting=meeting,
            requires_clarification=False,
            parsed_data=parsed,
        )
        
    except ValueError as e:
        return ConversationalScheduleResponse(
            success=False,
            error=str(e),
            requires_clarification=True,
            clarification_message=str(e),
        )
    except Exception as e:
        logger.error(f"Error in conversational scheduling: {e}", exc_info=True)
        return ConversationalScheduleResponse(
            success=False,
            error="An error occurred while processing your request. Please try again or use the standard meeting form.",
        )


@app.get("/api/meetings/{meeting_id}", response_model=Meeting)
async def get_meeting(meeting_id: str, current_user: CurrentUser):
    """Get a specific meeting by ID"""
    meeting = await meeting_service.get_meeting(meeting_id)
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
    _ensure_meeting_owner(meeting, current_user)

    if meeting.status == "completed" or meeting.end_time <= datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="Cannot generate event for a completed meeting.")
    return meeting

@app.put("/api/meetings/{meeting_id}", response_model=Meeting)
async def update_meeting(meeting_id: str, meeting_update: MeetingUpdate, current_user: CurrentUser):
    """Update a meeting"""
    # Validate new times against current meeting to ensure min duration and proper ordering
    current_meeting = await meeting_service.get_meeting(meeting_id)
    if not current_meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
    _ensure_meeting_owner(current_meeting, current_user)

    if current_meeting.status == "completed" or current_meeting.end_time <= datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="Completed meetings cannot be modified.")

    normalized_start = _ensure_tz(meeting_update.start_time) if meeting_update.start_time else None
    normalized_end = _ensure_tz(meeting_update.end_time) if meeting_update.end_time else None

    proposed_start = normalized_start or current_meeting.start_time
    proposed_end = normalized_end or current_meeting.end_time

    if normalized_start is not None or normalized_end is not None:
        meeting_update = meeting_update.model_copy(
            update={
                "start_time": normalized_start,
                "end_time": normalized_end,
            }
        )

    if proposed_end <= proposed_start:
        raise HTTPException(status_code=400, detail="End time must be after start time. Please choose an end time later than the start.")
    from datetime import timedelta
    if (proposed_end - proposed_start) < timedelta(minutes=5):
        raise HTTPException(status_code=400, detail="Meeting duration must be at least 5 minutes. Extend the end time or move the start time earlier.")

    # If timing changed and no explicit status provided, mark as rescheduled for clarity
    time_changed = (
        (normalized_start and normalized_start != current_meeting.start_time)
        or (normalized_end and normalized_end != current_meeting.end_time)
    )
    if time_changed and meeting_update.status is None:
        meeting_update.status = "rescheduled"

    try:
        meeting = await meeting_service.update_meeting(meeting_id, meeting_update)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")

    # Sync changes to Google Calendar if event exists or create one if needed for online meetings
    try:
        user = current_user
        prefs = user.preferences if user else {}
        creds = prefs.get("google_credentials")
        if creds:
            event_timezone = os.getenv("DEFAULT_TIMEZONE", "UTC")
            google_event_id = (meeting.metadata or {}).get("google_event_id")
            location_type = (meeting.metadata or {}).get("location_type", "online")
            location_text = (meeting.metadata or {}).get("room_location") or (meeting.metadata or {}).get("room_name")
            attendees = [p.email for p in meeting.participants]

            if not google_event_id:
                from functools import partial
                if location_type == "online":
                    create_fn = partial(
                        create_event_with_meet,
                        creds,
                        title=meeting.title,
                        description=meeting.description,
                        start_time=meeting.start_time,
                        end_time=meeting.end_time,
                        attendees=attendees,
                        timezone=event_timezone,
                    )
                else:
                    create_fn = partial(
                        create_calendar_event,
                        creds,
                        title=meeting.title,
                        description=meeting.description,
                        start_time=meeting.start_time,
                        end_time=meeting.end_time,
                        attendees=attendees,
                        timezone=event_timezone,
                        location=location_text,
                    )
                created = await anyio.to_thread.run_sync(create_fn)
                meta = dict(meeting.metadata or {})
                if location_type == "online":
                    meta["meeting_platform"] = "google_meet"
                    if created.meet_url:
                        meta["meeting_url"] = created.meet_url
                if created.event_id:
                    meta["google_event_id"] = created.event_id
                if created.html_link:
                    meta["google_event_link"] = created.html_link
                meeting = await meeting_service.update_meeting_metadata(str(meeting.id), meta) or meeting
            elif google_event_id:
                from functools import partial
                update_fn = partial(
                    update_event,
                    creds,
                    event_id=google_event_id,
                    title=meeting.title,
                    description=meeting.description,
                    start_time=meeting.start_time,
                    end_time=meeting.end_time,
                    timezone=event_timezone,
                    attendees=attendees,
                )
                await anyio.to_thread.run_sync(update_fn)
    except Exception as e:
        print(f"Google Calendar sync on update failed: {e}")

    return meeting

@app.delete("/api/meetings/{meeting_id}")
async def delete_meeting(meeting_id: str, current_user: CurrentUser):
    """Delete a meeting"""
    meeting = await meeting_service.get_meeting(meeting_id)
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
    _ensure_meeting_owner(meeting, current_user)
    google_event_id = (meeting.metadata or {}).get("google_event_id")
    creds = (current_user.preferences or {}).get("google_credentials")
    if google_event_id and creds:
        try:
            from functools import partial

            delete_fn = partial(
                delete_event,
                creds,
                event_id=google_event_id,
            )
            await anyio.to_thread.run_sync(delete_fn)
        except Exception as exc:
            print(f"Failed to delete Google Calendar event {google_event_id}: {exc}")
    success = await meeting_service.delete_meeting(meeting_id)
    if not success:
        raise HTTPException(status_code=404, detail="Meeting not found")
    return {"message": "Meeting deleted successfully"}

@app.post("/api/meetings/{meeting_id}/send-invitation")
async def send_invitation(meeting_id: str, current_user: CurrentUser):
    """Send invitation for a meeting to all participants"""
    meeting = await meeting_service.get_meeting(meeting_id)
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
    _ensure_meeting_owner(meeting, current_user)
    
    # Send invitations to all participants
    results = await notification_service.send_bulk_invitations(meeting)
    
    successful_sends = sum(1 for success in results.values() if success)
    total_participants = len(meeting.participants)
    
    return {
        "message": f"Invitations sent to {successful_sends}/{total_participants} participants",
        "results": results
    }

@app.post("/api/meetings/{meeting_id}/send-reminder")
async def send_reminder(meeting_id: str, current_user: CurrentUser):
    """Send reminder for a meeting to all participants"""
    meeting = await meeting_service.get_meeting(meeting_id)
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
    _ensure_meeting_owner(meeting, current_user)
    
    # Send reminders to all participants
    results = await notification_service.send_bulk_reminders(meeting, hours_before=1)
    
    successful_sends = sum(1 for success in results.values() if success)
    total_participants = len(meeting.participants)
    
    return {
        "message": f"Reminders sent to {successful_sends}/{total_participants} participants",
        "results": results
    }

@app.post("/api/meetings/{meeting_id}/send-update")
async def send_update_notification(meeting_id: str, request: UpdateNotificationRequest, current_user: CurrentUser):
    """Send update notification for a meeting to all participants"""
    meeting = await meeting_service.get_meeting(meeting_id)
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
    _ensure_meeting_owner(meeting, current_user)
    
    # Send update notifications to all participants
    results = {}
    for participant in meeting.participants:
        results[participant.email] = await notification_service.send_meeting_update(
            meeting, participant, request.changes_description
        )
    
    successful_sends = sum(1 for success in results.values() if success)
    total_participants = len(meeting.participants)
    
    return {
        "message": f"Update notifications sent to {successful_sends}/{total_participants} participants",
        "results": results
    }

@app.post("/api/meetings/{meeting_id}/send-cancellation")
async def send_cancellation_notification(meeting_id: str, request: CancellationNotificationRequest, current_user: CurrentUser):
    """Send cancellation notification for a meeting to all participants"""
    meeting = await meeting_service.get_meeting(meeting_id)
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
    _ensure_meeting_owner(meeting, current_user)
    
    # Send cancellation notifications to all participants
    results = {}
    for participant in meeting.participants:
        results[participant.email] = await notification_service.send_meeting_cancellation(
            meeting, participant, request.cancellation_reason
        )
    
    successful_sends = sum(1 for success in results.values() if success)
    total_participants = len(meeting.participants)
    
    return {
        "message": f"Cancellation notifications sent to {successful_sends}/{total_participants} participants",
        "results": results
    }

@app.post("/api/meetings/{meeting_id}/generate-meet-link", response_model=Meeting)
async def generate_meet_link(meeting_id: str, current_user: CurrentUser):
    """Generate and attach a Google Meet link for a meeting"""
    existing = await meeting_service.get_meeting(meeting_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Meeting not found")
    _ensure_meeting_owner(existing, current_user)
    meeting = await meeting_service.generate_meet_link(meeting_id)
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
    return meeting

@app.post("/api/meetings/{meeting_id}/create-google-event", response_model=Meeting)
async def create_google_event(meeting_id: str, current_user: CurrentUser):
    """Create a Google Calendar event with a Meet link for this meeting"""
    meeting = await meeting_service.get_meeting(meeting_id)
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
    _ensure_meeting_owner(meeting, current_user)

    user = current_user
    prefs = user.preferences or {}
    creds = prefs.get("google_credentials")
    if not creds:
        raise HTTPException(status_code=400, detail="Google account not connected")

    attendees = [p.email for p in meeting.participants]
    event_timezone = os.getenv("DEFAULT_TIMEZONE", "UTC")
    try:
        from functools import partial
        create_fn = partial(
            create_event_with_meet,
            creds,
            title=meeting.title,
            description=meeting.description,
            start_time=meeting.start_time,
            end_time=meeting.end_time,
            attendees=attendees,
            timezone=event_timezone,
        )
        created = await anyio.to_thread.run_sync(create_fn)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create Google event: {e}")

    meta = dict(meeting.metadata or {})
    meta["meeting_platform"] = "google_meet"
    if created.meet_url:
        meta["meeting_url"] = created.meet_url
    if created.event_id:
        meta["google_event_id"] = created.event_id
    if created.html_link:
        meta["google_event_link"] = created.html_link

    updated = await meeting_service.update_meeting_metadata(meeting_id, meta)
    return updated or meeting

@app.post("/api/meetings/{meeting_id}/participants", response_model=Meeting)
async def add_meeting_participants(meeting_id: str, request: AddParticipantsRequest, current_user: CurrentUser):
    """Add participants to a meeting and update Google Calendar event if present"""
    if not request.emails:
        raise HTTPException(status_code=400, detail="No emails provided")

    existing_meeting = await meeting_service.get_meeting(meeting_id)
    if not existing_meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
    _ensure_meeting_owner(existing_meeting, current_user)

    if existing_meeting.status == "completed" or existing_meeting.end_time <= datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="Cannot modify a completed meeting.")

    meeting = await meeting_service.add_participants(meeting_id, request.emails)
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")

    # Try to update Google Calendar attendees if event exists and user connected Google
    google_event_id = (meeting.metadata or {}).get("google_event_id")
    if google_event_id:
        try:
            user = current_user
            creds = (user.preferences or {}).get("google_credentials") if user else None
            if creds:
                from functools import partial
                emails = [p.email for p in meeting.participants]
                update_fn = partial(
                    update_event_attendees,
                    creds,
                    event_id=google_event_id,
                    attendees=emails,
                    send_updates="all",
                )
                await anyio.to_thread.run_sync(update_fn)
        except Exception as e:
            print(f"Google event attendee update failed: {e}")

    return meeting


@app.post("/api/meetings/{meeting_id}/polls")
async def create_poll(meeting_id: str, request: CreatePollRequest, current_user: CurrentUser):
    if poll_service is None:
        raise HTTPException(status_code=503, detail="Poll service unavailable")
    meeting = await meeting_service.get_meeting(meeting_id)
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
    if not request.options:
        raise HTTPException(status_code=400, detail="At least one option is required")

    options_payload = [
        {"start_time": opt.start_time, "end_time": opt.end_time}
        for opt in request.options
    ]
    normalized_deadline = _ensure_tz(request.deadline) if request.deadline else None
    poll = await poll_service.create_poll(
        meeting_id=meeting_id,
        organizer_email=current_user.email,
        options=options_payload,
        deadline=normalized_deadline,
    )

    meta = dict(meeting.metadata or {})
    meta["poll_id"] = str(poll.id)
    await meeting_service.update_meeting_metadata(meeting_id, meta)

    poll_id_str = str(poll.id)
    base_poll_url = f"{os.getenv('FRONTEND_URL', 'http://localhost:3000')}/poll/{poll_id_str}"
    for participant in meeting.participants:
        token = generate_poll_token(poll_id_str, participant.email, poll.deadline)
        participant_poll_url = f"{base_poll_url}?token={quote(token)}"
        await notification_service.send_poll_invitation(meeting, participant, participant_poll_url)

    return poll


@app.get("/api/meetings/{meeting_id}/polls")
async def get_meeting_polls(meeting_id: str, current_user: OptionalCurrentUser = None):
    """Get all polls for a meeting"""
    meeting = await meeting_service.get_meeting(meeting_id)
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
    
    polls = await poll_service.get_polls_for_meeting(meeting_id)
    
    # Serialize polls with viewer email if authenticated
    viewer_email = current_user.email if current_user else None
    serialized_polls = []
    for poll in polls:
        serialized_polls.append(_serialize_poll(poll, meeting, viewer_email))
    
    return serialized_polls


@app.get("/api/polls/{poll_id}")
async def get_poll(
    poll_id: str,
    token: Optional[str] = Query(default=None),
    voter_email: Optional[str] = Query(default=None),
    current_user: OptionalCurrentUser = None,
):
    poll = await poll_service.get_poll(poll_id)
    if not poll:
        raise HTTPException(status_code=404, detail="Poll not found")
    meeting = await meeting_service.get_meeting(poll.meeting_id)
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found for poll")
    viewer_email = _resolve_voter_identity(
        poll,
        meeting,
        token,
        voter_email,
        current_user,
        require_identity=False,
    )
    return _serialize_poll(poll, meeting, viewer_email)


@app.post("/api/polls/{poll_id}/vote")
async def vote_poll(poll_id: str, request: VoteRequest, current_user: OptionalCurrentUser = None):
    poll = await poll_service.get_poll(poll_id)
    if not poll:
        raise HTTPException(status_code=404, detail="Poll not found")

    meeting = await meeting_service.get_meeting(poll.meeting_id)
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found for poll")

    voter_email = _resolve_voter_identity(
        poll,
        meeting,
        request.token,
        request.voter_email,
        current_user,
        require_identity=True,
    )
    if not voter_email:
        raise HTTPException(status_code=403, detail="Sign in or use your personalized poll link to vote.")
    
    try:
        poll = await poll_service.add_vote(poll_id, request.option_id, voter_email)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return _serialize_poll(poll, meeting, voter_email)


@app.post("/api/polls/{poll_id}/finalize")
async def finalize_poll(poll_id: str, request: FinalizePollRequest, current_user: CurrentUser):
    poll = await poll_service.finalize_poll(poll_id, request.option_id)
    if not poll:
        raise HTTPException(status_code=404, detail="Poll not found")
    if poll.organizer_email and poll.organizer_email != current_user.email:
        raise HTTPException(status_code=403, detail="You can only finalize polls you created.")

    meeting = await _apply_poll_outcome(poll)
    if meeting is None:
        meeting = await meeting_service.get_meeting(poll.meeting_id)
    return _serialize_poll(poll, meeting)


@app.get("/api/google/auth-url")
async def legacy_google_auth_url():
    """Backward compatible endpoint for older frontend builds"""
    return await google_login()


@app.get("/api/google/callback")
async def legacy_google_callback(code: str, state: Optional[str] = None):
    return await google_auth_callback(code, state)

@app.post("/api/metadata", response_model=Metadata)
async def create_metadata(
    current_user: CurrentUser,
    key: str,
    value: Any,
    metadata_type: str,
    description: Optional[str] = None,
):
    """Create metadata entry"""
    return await metadata_service.create_metadata(key, value, metadata_type, description)

@app.get("/api/metadata/{key}", response_model=Metadata)
async def get_metadata(key: str, current_user: CurrentUser):
    """Get metadata by key"""
    metadata = await metadata_service.get_metadata(key)
    if not metadata:
        raise HTTPException(status_code=404, detail="Metadata not found")
    return metadata

@app.get("/api/metadata", response_model=List[Metadata])
async def get_all_metadata(current_user: CurrentUser):
    """Get all metadata"""
    return await metadata_service.get_all_metadata()

@app.put("/api/metadata/{key}", response_model=Metadata)
async def update_metadata(
    current_user: CurrentUser,
    key: str,
    value: Any,
    metadata_type: str,
    description: Optional[str] = None,
):
    """Update metadata"""
    metadata = await metadata_service.update_metadata(key, value, metadata_type, description)
    if not metadata:
        raise HTTPException(status_code=404, detail="Metadata not found")
    return metadata

@app.delete("/api/metadata/{key}")
async def delete_metadata(key: str, current_user: CurrentUser):
    """Delete metadata by key"""
    success = await metadata_service.delete_metadata(key)
    if not success:
        raise HTTPException(status_code=404, detail="Metadata not found")
    return {"message": "Metadata deleted successfully"}

# Event endpoints - DISABLED: Event model and EventService not implemented
# TODO: Implement Event model, EventCreate, EventUpdate, and EventService to enable these endpoints
# @app.get("/api/events", response_model=List[Event])
# @app.post("/api/events", response_model=Event)
# @app.get("/api/events/{event_id}", response_model=Event)
# @app.put("/api/events/{event_id}", response_model=Event)
# @app.delete("/api/events/{event_id}")

@app.put("/api/meetings/{meeting_id}/metadata")
async def update_meeting_metadata(
    meeting_id: str,
    metadata: Dict[str, Any],
    current_user: CurrentUser,
):
    """Update meeting metadata"""
    meeting = await meeting_service.update_meeting_metadata(meeting_id, metadata)
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
    return meeting

# Duplicate/broken poll endpoints removed - use the working endpoints above (lines 1265-1407)

@app.exception_handler(404)
async def not_found_handler(request, exc):
    # Log the requested path for debugging
    print(f"404 Error: Requested path: {request.url.path}")
    print(f"404 Error: Full URL: {request.url}")
    return JSONResponse(
        status_code=404,
        content={
            "error": "Resource not found",
            "path": str(request.url.path),
            "available_endpoints": [
                "/health",
                "/api/meetings",
                "/api/events",
                "/api/google/callback",
                "/api/auth/google/login-url",
                "/api/auth/me",
                "/api/auth/logout"
            ]
        }
    )

@app.exception_handler(500)
async def internal_error_handler(request, exc):
    return JSONResponse(
        status_code=500,
        content={"error": "Internal server error"}
    )

if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=int(os.getenv("PORT", 8000)),
        reload=True
    )
def _serialize_poll(poll: Poll, meeting: Optional[Meeting] = None, viewer_email: Optional[str] = None) -> Dict[str, Any]:
    poll_dict = poll.model_dump(mode="json")
    if meeting:
        poll_dict["meeting_summary"] = {
            "title": meeting.title,
            "description": meeting.description,
            "start_time": meeting.start_time.isoformat(),
            "end_time": meeting.end_time.isoformat(),
            "organizer_email": meeting.organizer_email,
        }
    if viewer_email:
        viewer_vote = next(
            (vote.option_id for vote in poll.votes if vote.voter_email.lower() == viewer_email.lower()),
            None,
        )
        poll_dict["viewer_vote_option_id"] = viewer_vote
    else:
        poll_dict["viewer_vote_option_id"] = None
    deadline_dt = poll.deadline
    if deadline_dt and deadline_dt.tzinfo is None:
        deadline_dt = deadline_dt.replace(tzinfo=timezone.utc)
    poll_dict["is_deadline_passed"] = bool(
        deadline_dt and datetime.now(timezone.utc) >= deadline_dt
    )
    return poll_dict
