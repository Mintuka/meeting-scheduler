from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import JSONResponse
from contextlib import asynccontextmanager
import uvicorn
from datetime import datetime
import os
from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field
import uuid

from app.database import MongoDB
from app.models import Meeting, MeetingCreate, MeetingUpdate, Metadata
from app.services import MeetingService, MetadataService, UserService
from app.google_calendar import (
    generate_auth_url,
    exchange_code_for_tokens,
    create_event_with_meet,
    update_event_attendees,
    update_event,
)
import anyio
from app.notification_service import notification_service
from app.email_reply_listener import EmailReplyListener

# Request models for notification endpoints
class UpdateNotificationRequest(BaseModel):
    changes_description: str

class CancellationNotificationRequest(BaseModel):
    cancellation_reason: str

class AddParticipantsRequest(BaseModel):
    emails: List[str] = Field(default_factory=list)

# Initialize services after database connection
meeting_service = None
metadata_service = None
user_service = None

async def process_email_reply(meeting_id: str, from_email: str, action: str, payload: str | None):
    # Basic placeholder actions: record metadata; real logic can update meetings
    metadata_key = f"reply:{meeting_id}:{from_email}:{datetime.utcnow().isoformat()}"
    await metadata_service.create_metadata(
        key=metadata_key,
        value={"action": action, "payload": payload},
        metadata_type="email_reply",
        description="Email reply processed"
    )


reply_listener: EmailReplyListener | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    print("Starting Meeting Scheduler Backend...")
    await MongoDB.connect_to_mongo()
    
    # Initialize services after database connection
    global meeting_service, metadata_service, user_service
    meeting_service = MeetingService()
    metadata_service = MetadataService()
    user_service = UserService()
    global reply_listener
    reply_listener = EmailReplyListener(process_email_reply)
    await reply_listener.start()
    
    yield
    print("Shutting down Meeting Scheduler Backend...")
    if reply_listener:
        await reply_listener.stop()
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

# Mock authentication function that doesn't require a token
async def get_current_user():
    return {"user_id": "mock_user", "email": "user@example.com"}

@app.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "timestamp": datetime.utcnow().isoformat(),
        "service": "meeting-scheduler-backend"
    }

@app.get("/api/meetings", response_model=List[Meeting])
async def get_meetings():
    """Get all meetings for the current user"""
    return await meeting_service.get_all_meetings()

@app.post("/api/meetings", response_model=Meeting)
async def create_meeting(meeting_data: MeetingCreate):
    """Create a new meeting"""
    # Validate that end time is after start time
    if meeting_data.end_time <= meeting_data.start_time:
        raise HTTPException(status_code=400, detail="End time must be after start time. Please choose an end time later than the start.")
    # Enforce minimum meeting duration of 5 minutes
    from datetime import timedelta
    if (meeting_data.end_time - meeting_data.start_time) < timedelta(minutes=5):
        raise HTTPException(status_code=400, detail="Meeting duration must be at least 5 minutes. Extend the end time or move the start time earlier.")

    # Create meeting in DB first
    meeting = await meeting_service.create_meeting(meeting_data, meeting_data.metadata)

    # Attempt to create a real Google Meet link if user connected Google
    try:
        current = await get_current_user()
        user = await user_service.get_user(current["email"]) if user_service else None
        if not user:
            # Auto-create user record if not exists
            user = await user_service.create_user(current["email"], current.get("user_id", "user"))

        prefs = user.preferences if user else {}
        creds = prefs.get("google_credentials")
        location_type = (meeting.metadata or {}).get("location_type", "online")
        if creds and location_type == "online":
            attendees = [p.email for p in meeting.participants]
            timezone = os.getenv("DEFAULT_TIMEZONE", "UTC")
            from functools import partial
            create_fn = partial(
                create_event_with_meet,
                creds,
                title=meeting.title,
                description=meeting.description,
                start_time=meeting.start_time,
                end_time=meeting.end_time,
                attendees=attendees,
                timezone=timezone,
            )
            created = await anyio.to_thread.run_sync(create_fn)
            # Update meeting metadata with real Meet URL and Google event info
            new_meta = dict(meeting.metadata or {})
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

@app.get("/api/meetings/{meeting_id}", response_model=Meeting)
async def get_meeting(meeting_id: str):
    """Get a specific meeting by ID"""
    meeting = await meeting_service.get_meeting(meeting_id)
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")

    if meeting.status == "completed" or meeting.end_time <= datetime.utcnow():
        raise HTTPException(status_code=400, detail="Cannot generate event for a completed meeting.")
    return meeting

@app.put("/api/meetings/{meeting_id}", response_model=Meeting)
async def update_meeting(meeting_id: str, meeting_update: MeetingUpdate):
    """Update a meeting"""
    # Validate new times against current meeting to ensure min duration and proper ordering
    current_meeting = await meeting_service.get_meeting(meeting_id)
    if not current_meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")

    if current_meeting.status == "completed" or current_meeting.end_time <= datetime.utcnow():
        raise HTTPException(status_code=400, detail="Completed meetings cannot be modified.")

    # Determine proposed start/end times using provided values or existing
    proposed_start = meeting_update.start_time or current_meeting.start_time
    proposed_end = meeting_update.end_time or current_meeting.end_time

    if proposed_end <= proposed_start:
        raise HTTPException(status_code=400, detail="End time must be after start time. Please choose an end time later than the start.")
    from datetime import timedelta
    if (proposed_end - proposed_start) < timedelta(minutes=5):
        raise HTTPException(status_code=400, detail="Meeting duration must be at least 5 minutes. Extend the end time or move the start time earlier.")

    # If timing changed and no explicit status provided, mark as rescheduled for clarity
    time_changed = (
        (meeting_update.start_time and meeting_update.start_time != current_meeting.start_time)
        or (meeting_update.end_time and meeting_update.end_time != current_meeting.end_time)
    )
    if time_changed and meeting_update.status is None:
        meeting_update.status = "rescheduled"

    meeting = await meeting_service.update_meeting(meeting_id, meeting_update)
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")

    # Sync changes to Google Calendar if event exists or create one if needed for online meetings
    try:
        current = await get_current_user()
        user = await user_service.get_user(current["email"]) if user_service else None
        prefs = user.preferences if user else {}
        creds = prefs.get("google_credentials")
        if creds:
            timezone = os.getenv("DEFAULT_TIMEZONE", "UTC")
            google_event_id = (meeting.metadata or {}).get("google_event_id")

            if not google_event_id and (meeting.metadata or {}).get("location_type", "online") == "online":
                # Create an event now
                from functools import partial
                attendees = [p.email for p in meeting.participants]
                create_fn = partial(
                    create_event_with_meet,
                    creds,
                    title=meeting.title,
                    description=meeting.description,
                    start_time=meeting.start_time,
                    end_time=meeting.end_time,
                    attendees=attendees,
                    timezone=timezone,
                )
                created = await anyio.to_thread.run_sync(create_fn)
                meta = dict(meeting.metadata or {})
                meta["meeting_platform"] = "google_meet"
                if created.meet_url:
                    meta["meeting_url"] = created.meet_url
                if created.event_id:
                    meta["google_event_id"] = created.event_id
                if created.html_link:
                    meta["google_event_link"] = created.html_link
                meeting = await meeting_service.update_meeting_metadata(str(meeting.id), meta) or meeting
            else:
                # Update existing event with new details and attendees
                if google_event_id:
                    from functools import partial
                    attendees = [p.email for p in meeting.participants]
                    update_fn = partial(
                        update_event,
                        creds,
                        event_id=google_event_id,
                        title=meeting.title,
                        description=meeting.description,
                        start_time=meeting.start_time,
                        end_time=meeting.end_time,
                        timezone=timezone,
                        attendees=attendees,
                        send_updates="all",
                    )
                    await anyio.to_thread.run_sync(update_fn)
    except Exception as e:
        print(f"Google Calendar sync on update failed: {e}")

    return meeting

@app.delete("/api/meetings/{meeting_id}")
async def delete_meeting(meeting_id: str):
    """Delete a meeting"""
    success = await meeting_service.delete_meeting(meeting_id)
    if not success:
        raise HTTPException(status_code=404, detail="Meeting not found")
    return {"message": "Meeting deleted successfully"}

@app.post("/api/meetings/{meeting_id}/send-invitation")
async def send_invitation(meeting_id: str):
    """Send invitation for a meeting to all participants"""
    meeting = await meeting_service.get_meeting(meeting_id)
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
    
    # Send invitations to all participants
    results = await notification_service.send_bulk_invitations(meeting)
    
    successful_sends = sum(1 for success in results.values() if success)
    total_participants = len(meeting.participants)
    
    return {
        "message": f"Invitations sent to {successful_sends}/{total_participants} participants",
        "results": results
    }

@app.post("/api/meetings/{meeting_id}/send-reminder")
async def send_reminder(meeting_id: str):
    """Send reminder for a meeting to all participants"""
    meeting = await meeting_service.get_meeting(meeting_id)
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
    
    # Send reminders to all participants
    results = await notification_service.send_bulk_reminders(meeting, hours_before=1)
    
    successful_sends = sum(1 for success in results.values() if success)
    total_participants = len(meeting.participants)
    
    return {
        "message": f"Reminders sent to {successful_sends}/{total_participants} participants",
        "results": results
    }

@app.post("/api/meetings/{meeting_id}/send-update")
async def send_update_notification(meeting_id: str, request: UpdateNotificationRequest):
    """Send update notification for a meeting to all participants"""
    meeting = await meeting_service.get_meeting(meeting_id)
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
    
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
async def send_cancellation_notification(meeting_id: str, request: CancellationNotificationRequest):
    """Send cancellation notification for a meeting to all participants"""
    meeting = await meeting_service.get_meeting(meeting_id)
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
    
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
async def generate_meet_link(meeting_id: str):
    """Generate and attach a Google Meet link for a meeting"""
    meeting = await meeting_service.generate_meet_link(meeting_id)
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
    return meeting

@app.post("/api/meetings/{meeting_id}/create-google-event", response_model=Meeting)
async def create_google_event(meeting_id: str):
    """Create a Google Calendar event with a Meet link for this meeting"""
    meeting = await meeting_service.get_meeting(meeting_id)
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")

    current = await get_current_user()
    user = await user_service.get_user(current["email"]) if user_service else None
    if not user:
        raise HTTPException(status_code=400, detail="User not initialized")

    prefs = user.preferences or {}
    creds = prefs.get("google_credentials")
    if not creds:
        raise HTTPException(status_code=400, detail="Google account not connected")

    attendees = [p.email for p in meeting.participants]
    timezone = os.getenv("DEFAULT_TIMEZONE", "UTC")
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
            timezone=timezone,
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
async def add_meeting_participants(meeting_id: str, request: AddParticipantsRequest):
    """Add participants to a meeting and update Google Calendar event if present"""
    if not request.emails:
        raise HTTPException(status_code=400, detail="No emails provided")

    existing_meeting = await meeting_service.get_meeting(meeting_id)
    if not existing_meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")

    if existing_meeting.status == "completed" or existing_meeting.end_time <= datetime.utcnow():
        raise HTTPException(status_code=400, detail="Cannot modify a completed meeting.")

    meeting = await meeting_service.add_participants(meeting_id, request.emails)
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")

    # Try to update Google Calendar attendees if event exists and user connected Google
    google_event_id = (meeting.metadata or {}).get("google_event_id")
    if google_event_id:
        try:
            current = await get_current_user()
            user = await user_service.get_user(current["email"]) if user_service else None
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

@app.get("/api/google/auth-url")
async def get_google_auth_url():
    """Get Google OAuth authorization URL for the current user"""
    current = await get_current_user()
    # Create user if missing
    user = await user_service.get_user(current["email"]) if user_service else None
    if not user:
        user = await user_service.create_user(current["email"], current.get("user_id", "user"))

    # Generate state and store temporarily in user prefs
    import uuid
    state = str(uuid.uuid4())
    prefs = dict(user.preferences or {})
    prefs["google_oauth_state"] = state
    await user_service.update_user_preferences(user.email, prefs)

    try:
        url = generate_auth_url(state)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create auth URL: {e}")
    return {"auth_url": url}

@app.get("/api/google/callback")
async def google_oauth_callback(code: str, state: str | None = None):
    """OAuth callback to exchange authorization code for tokens"""
    current = await get_current_user()
    user = await user_service.get_user(current["email"]) if user_service else None
    if not user:
        raise HTTPException(status_code=400, detail="User not initialized")

    expected_state = (user.preferences or {}).get("google_oauth_state")
    if expected_state and state and state != expected_state:
        raise HTTPException(status_code=400, detail="Invalid state parameter")

    try:
        creds_dict = exchange_code_for_tokens(code)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Token exchange failed: {e}")

    # Store tokens in user preferences
    prefs = dict(user.preferences or {})
    prefs.pop("google_oauth_state", None)
    prefs["google_credentials"] = creds_dict
    updated = await user_service.update_user_preferences(user.email, prefs)
    if not updated:
        raise HTTPException(status_code=500, detail="Failed to save Google credentials")
    return {"status": "connected"}

@app.post("/api/metadata", response_model=Metadata)
async def create_metadata(
    key: str,
    value: Any,
    metadata_type: str,
    description: Optional[str] = None
):
    """Create metadata entry"""
    return await metadata_service.create_metadata(key, value, metadata_type, description)

@app.get("/api/metadata/{key}", response_model=Metadata)
async def get_metadata(key: str):
    """Get metadata by key"""
    metadata = await metadata_service.get_metadata(key)
    if not metadata:
        raise HTTPException(status_code=404, detail="Metadata not found")
    return metadata

@app.get("/api/metadata", response_model=List[Metadata])
async def get_all_metadata():
    """Get all metadata"""
    return await metadata_service.get_all_metadata()

@app.put("/api/metadata/{key}", response_model=Metadata)
async def update_metadata(
    key: str,
    value: Any,
    metadata_type: str,
    description: Optional[str] = None
):
    """Update metadata"""
    metadata = await metadata_service.update_metadata(key, value, metadata_type, description)
    if not metadata:
        raise HTTPException(status_code=404, detail="Metadata not found")
    return metadata

@app.delete("/api/metadata/{key}")
async def delete_metadata(key: str):
    """Delete metadata by key"""
    success = await metadata_service.delete_metadata(key)
    if not success:
        raise HTTPException(status_code=404, detail="Metadata not found")
    return {"message": "Metadata deleted successfully"}

@app.put("/api/meetings/{meeting_id}/metadata")
async def update_meeting_metadata(
    meeting_id: str,
    metadata: Dict[str, Any]
):
    """Update meeting metadata"""
    meeting = await meeting_service.update_meeting_metadata(meeting_id, metadata)
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
    return meeting

@app.exception_handler(404)
async def not_found_handler(request, exc):
    return JSONResponse(
        status_code=404,
        content={"error": "Resource not found"}
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
