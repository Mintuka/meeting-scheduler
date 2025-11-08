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
from app.models import Meeting, MeetingCreate, MeetingUpdate, Metadata, Event, EventCreate, EventUpdate, Poll, PollCreate, PollVote
from app.services import MeetingService, MetadataService, UserService, EventService, PollService
from app.google_calendar import (
    generate_auth_url,
    exchange_code_for_tokens,
    create_event_with_meet,
    update_event_attendees,
    update_event,
    AUTH_SCOPES,
)
from app.auth import create_access_token, verify_token, get_google_user_info
import anyio
from app.notification_service import notification_service
from app.email_reply_listener import EmailReplyListener
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi import Depends

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
event_service = None

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
    global meeting_service, metadata_service, user_service, event_service, poll_service
    meeting_service = MeetingService()
    metadata_service = MetadataService()
    user_service = UserService()
    event_service = EventService()
    poll_service = PollService()
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

# Security scheme for JWT tokens
security = HTTPBearer(auto_error=False)

async def get_current_user(credentials: Optional[HTTPAuthorizationCredentials] = None):
    """Get current user from JWT token"""
    if not credentials:
        return None
    token = credentials.credentials
    payload = verify_token(token)
    if payload:
        return {
            "user_id": payload.get("sub"),
            "email": payload.get("email"),
            "name": payload.get("name"),
            "picture": payload.get("picture")
        }
    return None

@app.get("/")
async def root():
    """Root endpoint"""
    return {"message": "Meeting Scheduler API", "version": "1.0.0"}

@app.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "timestamp": datetime.utcnow().isoformat(),
        "service": "meeting-scheduler-backend"
    }

@app.get("/api/meetings", response_model=List[Meeting])
async def get_meetings(credentials: Optional[HTTPAuthorizationCredentials] = Depends(security)):
    """Get all meetings for the current user"""
    user = await get_current_user(credentials)
    user_email = user.get("email") if user else None
    
    # If authenticated, filter by user email (meetings where user is a participant)
    # If not authenticated, return empty list (or you could return all meetings for dev)
    if not user_email:
        return []  # Or raise HTTPException(status_code=401, detail="Not authenticated")
    
    return await meeting_service.get_all_meetings(user_email=user_email)

@app.post("/api/meetings", response_model=Meeting)
async def create_meeting(meeting_data: MeetingCreate, credentials: Optional[HTTPAuthorizationCredentials] = Depends(security)):
    """Create a new meeting"""
    # Get authenticated user
    user = await get_current_user(credentials)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated. Please sign in to create meetings.")
    
    user_email = user.get("email")
    if not user_email:
        raise HTTPException(status_code=401, detail="User email not found")
    
    # Validate that end time is after start time
    if meeting_data.end_time <= meeting_data.start_time:
        raise HTTPException(status_code=400, detail="End time must be after start time. Please choose an end time later than the start.")
    # Enforce minimum meeting duration of 5 minutes
    from datetime import timedelta
    if (meeting_data.end_time - meeting_data.start_time) < timedelta(minutes=5):
        raise HTTPException(status_code=400, detail="Meeting duration must be at least 5 minutes. Extend the end time or move the start time earlier.")

    # Ensure the creator is included in participants if not already
    # participants is a list of email strings
    # Prepend creator to ensure they're first (used for poll creation permission)
    if user_email not in meeting_data.participants:
        meeting_data.participants.insert(0, user_email)
    else:
        # If creator is already in list, move them to first position
        meeting_data.participants.remove(user_email)
        meeting_data.participants.insert(0, user_email)

    # Create meeting in DB first
    meeting = await meeting_service.create_meeting(meeting_data, meeting_data.metadata)

    # Attempt to create a real Google Meet link if user connected Google
    try:
        # For now, skip Google Calendar integration if no authenticated user
        # This can be enhanced later to use request headers
        user = None

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
async def get_meeting(meeting_id: str, credentials: Optional[HTTPAuthorizationCredentials] = Depends(security)):
    """Get a specific meeting by ID"""
    user = await get_current_user(credentials)
    user_email = user.get("email") if user else None
    
    meeting = await meeting_service.get_meeting(meeting_id)
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")

    # Check if user is a participant
    if user_email:
        participant_emails = [p.email for p in meeting.participants]
        if user_email not in participant_emails:
            raise HTTPException(status_code=403, detail="You don't have access to this meeting")
    else:
        raise HTTPException(status_code=401, detail="Not authenticated")

    if meeting.status == "completed" or meeting.end_time <= datetime.utcnow():
        raise HTTPException(status_code=400, detail="Cannot generate event for a completed meeting.")
    return meeting

@app.put("/api/meetings/{meeting_id}", response_model=Meeting)
async def update_meeting(meeting_id: str, meeting_update: MeetingUpdate, credentials: Optional[HTTPAuthorizationCredentials] = Depends(security)):
    """Update a meeting"""
    user = await get_current_user(credentials)
    user_email = user.get("email") if user else None
    if not user_email:
        raise HTTPException(status_code=401, detail="Not authenticated")
    
    # Validate new times against current meeting to ensure min duration and proper ordering
    current_meeting = await meeting_service.get_meeting(meeting_id)
    if not current_meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")

    # Check if user is a participant
    participant_emails = [p.email for p in current_meeting.participants]
    if user_email not in participant_emails:
        raise HTTPException(status_code=403, detail="You don't have permission to update this meeting")

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
async def delete_meeting(meeting_id: str, credentials: Optional[HTTPAuthorizationCredentials] = Depends(security)):
    """Delete a meeting"""
    user = await get_current_user(credentials)
    user_email = user.get("email") if user else None
    if not user_email:
        raise HTTPException(status_code=401, detail="Not authenticated")
    
    meeting = await meeting_service.get_meeting(meeting_id)
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
    
    # Check if user is a participant (allow any participant to delete for now)
    # In production, you might want to restrict this to the creator only
    participant_emails = [p.email for p in meeting.participants]
    if user_email not in participant_emails:
        raise HTTPException(status_code=403, detail="You don't have permission to delete this meeting")
    
    success = await meeting_service.delete_meeting(meeting_id)
    if not success:
        raise HTTPException(status_code=404, detail="Meeting not found")
    return {"message": "Meeting deleted successfully"}

@app.post("/api/meetings/{meeting_id}/send-invitation")
async def send_invitation(meeting_id: str, credentials: Optional[HTTPAuthorizationCredentials] = Depends(security)):
    """Send invitation for a meeting to all participants"""
    user = await get_current_user(credentials)
    user_email = user.get("email") if user else None
    if not user_email:
        raise HTTPException(status_code=401, detail="Not authenticated")
    
    meeting = await meeting_service.get_meeting(meeting_id)
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
    
    # Check if user is a participant
    participant_emails = [p.email for p in meeting.participants]
    if user_email not in participant_emails:
        raise HTTPException(status_code=403, detail="You don't have permission to send invitations for this meeting")
    
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
async def get_google_auth_url(credentials: Optional[HTTPAuthorizationCredentials] = Depends(security)):
    """Get Google OAuth authorization URL for the current user"""
    current = await get_current_user(credentials)
    if not current:
        raise HTTPException(status_code=401, detail="Not authenticated. Please sign in first.")
    
    # Create user if missing
    user = await user_service.get_user(current["email"]) if user_service else None
    if not user:
        user = await user_service.create_user(current["email"], current.get("name", "user"))

    # Generate state with user email for easier lookup in callback
    import uuid
    state = f"calendar_{current['email']}_{str(uuid.uuid4())}"
    prefs = dict(user.preferences or {})
    prefs["google_oauth_state"] = state
    await user_service.update_user_preferences(user.email, prefs)

    try:
        redirect_uri = os.getenv("GOOGLE_REDIRECT_URI", "http://localhost:8000/api/google/callback")
        url = generate_auth_url(state, redirect_uri=redirect_uri)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create auth URL: {e}")
    return {"auth_url": url}

@app.get("/api/auth/google/login-url")
async def get_google_login_url():
    """Get Google OAuth login URL for user authentication"""
    import uuid
    state = f"auth_{str(uuid.uuid4())}"  # Prefix with "auth_" to identify auth flow
    # Use the existing redirect URI from environment
    redirect_uri = os.getenv("GOOGLE_REDIRECT_URI", "http://localhost:8000/api/google/callback")
    try:
        url = generate_auth_url(state, scopes=AUTH_SCOPES, redirect_uri=redirect_uri)
        return {"auth_url": url, "state": state}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create login URL: {e}")


@app.get("/api/auth/me")
async def get_current_user_info(credentials: Optional[HTTPAuthorizationCredentials] = Depends(security)):
    """Get current authenticated user info"""
    user = await get_current_user(credentials)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return user

@app.post("/api/auth/logout")
async def logout():
    """Logout endpoint (client should remove token)"""
    return {"message": "Logged out successfully"}

@app.get("/api/google/callback")
async def google_oauth_callback(code: str = None, state: str = None, error: str = None):
    """OAuth callback to exchange authorization code for tokens - handles both auth and calendar flows"""
    from fastapi.responses import RedirectResponse
    from fastapi import Request
    
    frontend_url = os.getenv("FRONTEND_URL", "http://localhost:3000")
    redirect_uri = os.getenv("GOOGLE_REDIRECT_URI", "http://localhost:8000/api/google/callback")
    
    # Handle OAuth errors from Google
    if error:
        error_message = f"OAuth error: {error}"
        return RedirectResponse(url=f"{frontend_url}?error=auth_failed&message={error_message}")
    
    # Check if code is provided
    if not code:
        return RedirectResponse(url=f"{frontend_url}?error=auth_failed&message=No authorization code provided")
    
    # Check if this is an authentication flow (state starts with "auth_")
    is_auth_flow = state and state.startswith("auth_")
    
    try:
        if is_auth_flow:
            # Authentication flow - exchange code for user token
            creds_dict = exchange_code_for_tokens(code, scopes=AUTH_SCOPES, redirect_uri=redirect_uri)
            
            # Get user info from Google
            access_token = creds_dict.get("token")
            if not access_token:
                return RedirectResponse(url=f"{frontend_url}?error=auth_failed&message=No access token received")
            
            user_info = await get_google_user_info(access_token)
            
            # Create or update user in database
            email = user_info.get("email")
            name = user_info.get("name", email.split("@")[0])
            picture = user_info.get("picture")
            google_id = user_info.get("id")
            
            user = await user_service.get_user(email) if user_service else None
            if not user:
                user = await user_service.create_user(email, name)
            
            # Store Google credentials in user preferences
            prefs = dict(user.preferences or {})
            prefs["google_credentials"] = creds_dict
            prefs["google_id"] = google_id
            prefs["picture"] = picture
            await user_service.update_user_preferences(email, prefs)
            
            # Create JWT token
            token_data = {
                "sub": str(user.id),
                "email": email,
                "name": name,
                "picture": picture
            }
            access_token_jwt = create_access_token(token_data)
            
            # Redirect to frontend with token in URL
            import urllib.parse
            params = {
                'token': access_token_jwt,
                'email': email,
                'name': name,
            }
            if picture:
                params['picture'] = picture
            query_string = urllib.parse.urlencode(params)
            return RedirectResponse(url=f"{frontend_url}/?{query_string}")
        else:
            # Calendar connection flow - look up user by stored state
            # Find user with matching google_oauth_state in preferences
            if not state:
                return RedirectResponse(url=f"{frontend_url}?error=calendar_connect&message=No state parameter provided")
            
            # Find user by state stored in preferences
            user = None
            if user_service:
                # This is a simplified lookup - in production, you might want to store state->user mapping separately
                # For now, we'll try to find a user with this state in their preferences
                # Note: This requires iterating through users, which is not efficient for large databases
                # A better approach would be to store state in a separate collection or cache
                try:
                    # Since we can't easily query by nested field in preferences, 
                    # we'll store the user email in the state itself for calendar connections
                    # Format: "calendar_{email}_{uuid}"
                    if state.startswith("calendar_"):
                        parts = state.split("_", 2)
                        if len(parts) >= 3:
                            user_email = parts[1]
                            user = await user_service.get_user(user_email)
                    else:
                        # Fallback: try to find user with this state (less efficient)
                        # For now, return error asking user to reconnect
                        return RedirectResponse(url=f"{frontend_url}?error=calendar_connect&message=Unable to identify user. Please try connecting again.")
                except Exception as e:
                    return RedirectResponse(url=f"{frontend_url}?error=calendar_connect&message=Error looking up user: {str(e)}")
            
            if not user:
                return RedirectResponse(url=f"{frontend_url}?error=calendar_connect&message=User not found. Please sign in and try again.")

            expected_state = (user.preferences or {}).get("google_oauth_state")
            if expected_state and state != expected_state:
                return RedirectResponse(url=f"{frontend_url}?error=calendar_connect&message=Invalid state parameter")

            try:
                creds_dict = exchange_code_for_tokens(code, redirect_uri=redirect_uri)
            except Exception as e:
                return RedirectResponse(url=f"{frontend_url}?error=calendar_connect&message=Token exchange failed: {str(e)}")

            # Store tokens in user preferences
            prefs = dict(user.preferences or {})
            prefs.pop("google_oauth_state", None)
            prefs["google_credentials"] = creds_dict
            updated = await user_service.update_user_preferences(user.email, prefs)
            if not updated:
                return RedirectResponse(url=f"{frontend_url}?error=calendar_connect&message=Failed to save Google credentials")
            
            # Redirect back to frontend with success
            return RedirectResponse(url=f"{frontend_url}?calendar_connected=true")
    except Exception as e:
        error_type = "auth_failed" if is_auth_flow else "calendar_connect"
        return RedirectResponse(url=f"{frontend_url}?error={error_type}&message={str(e)}")

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

# Event endpoints
@app.get("/api/events", response_model=List[Event])
async def get_events(credentials: Optional[HTTPAuthorizationCredentials] = Depends(security)):
    """Get all events for the current user"""
    user = await get_current_user(credentials)
    user_email = user.get("email") if user else None
    
    # If authenticated, filter by user email (events created by user)
    # If not authenticated, return empty list
    if not user_email:
        return []  # Or raise HTTPException(status_code=401, detail="Not authenticated")
    
    return await event_service.get_all_events(user_email=user_email)

@app.post("/api/events", response_model=Event)
async def create_event(event_data: EventCreate, credentials: Optional[HTTPAuthorizationCredentials] = Depends(security)):
    """Create a new event"""
    # Get authenticated user
    user = await get_current_user(credentials)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    
    user_email = user.get("email")
    if not user_email:
        raise HTTPException(status_code=401, detail="User email not found")
    
    # Validate that end time is after start time
    if event_data.end_time <= event_data.start_time:
        raise HTTPException(status_code=400, detail="End time must be after start time")
    # Enforce minimum event duration of 5 minutes
    from datetime import timedelta
    if (event_data.end_time - event_data.start_time) < timedelta(minutes=5):
        raise HTTPException(status_code=400, detail="Event duration must be at least 5 minutes")

    # Create event in DB with creator email
    event = await event_service.create_event(event_data, creator_email=user_email, metadata=event_data.metadata)
    return event

@app.get("/api/events/{event_id}", response_model=Event)
async def get_event(event_id: str, credentials: Optional[HTTPAuthorizationCredentials] = Depends(security)):
    """Get a specific event by ID"""
    user = await get_current_user(credentials)
    user_email = user.get("email") if user else None
    
    event = await event_service.get_event(event_id)
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    
    # Check if user is the creator
    if user_email:
        if event.creator_email != user_email:
            raise HTTPException(status_code=403, detail="You don't have access to this event")
    else:
        raise HTTPException(status_code=401, detail="Not authenticated")
    
    return event

@app.put("/api/events/{event_id}", response_model=Event)
async def update_event(event_id: str, event_update: EventUpdate, credentials: Optional[HTTPAuthorizationCredentials] = Depends(security)):
    """Update an event"""
    user = await get_current_user(credentials)
    user_email = user.get("email") if user else None
    if not user_email:
        raise HTTPException(status_code=401, detail="Not authenticated")
    
    # Validate new times against current event to ensure min duration and proper ordering
    current_event = await event_service.get_event(event_id)
    if not current_event:
        raise HTTPException(status_code=404, detail="Event not found")

    # Check if user is the creator
    if current_event.creator_email != user_email:
        raise HTTPException(status_code=403, detail="You don't have permission to update this event")

    if current_event.status == "completed" or current_event.end_time <= datetime.utcnow():
        raise HTTPException(status_code=400, detail="Completed events cannot be modified.")

    # Determine proposed start/end times using provided values or existing
    proposed_start = event_update.start_time or current_event.start_time
    proposed_end = event_update.end_time or current_event.end_time

    if proposed_end <= proposed_start:
        raise HTTPException(status_code=400, detail="End time must be after start time")
    from datetime import timedelta
    if (proposed_end - proposed_start) < timedelta(minutes=5):
        raise HTTPException(status_code=400, detail="Event duration must be at least 5 minutes")

    # If timing changed and no explicit status provided, mark as rescheduled for clarity
    time_changed = (
        (event_update.start_time and event_update.start_time != current_event.start_time)
        or (event_update.end_time and event_update.end_time != current_event.end_time)
    )
    if time_changed and event_update.status is None:
        event_update.status = "rescheduled"

    event = await event_service.update_event(event_id, event_update)
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    return event

@app.delete("/api/events/{event_id}")
async def delete_event(event_id: str, credentials: Optional[HTTPAuthorizationCredentials] = Depends(security)):
    """Delete an event"""
    user = await get_current_user(credentials)
    user_email = user.get("email") if user else None
    if not user_email:
        raise HTTPException(status_code=401, detail="Not authenticated")
    
    event = await event_service.get_event(event_id)
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    
    # Check if user is the creator
    if event.creator_email != user_email:
        raise HTTPException(status_code=403, detail="You don't have permission to delete this event")
    
    success = await event_service.delete_event(event_id)
    if not success:
        raise HTTPException(status_code=404, detail="Event not found")
    return {"message": "Event deleted successfully"}

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

# Poll endpoints
@app.post("/api/meetings/{meeting_id}/polls", response_model=Poll)
async def create_poll(
    meeting_id: str,
    poll_data: PollCreate,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security)
):
    """Create a poll for a meeting (only meeting creator can create polls)"""
    user = await get_current_user(credentials)
    user_email = user.get("email") if user else None
    if not user_email:
        raise HTTPException(status_code=401, detail="Not authenticated")
    
    # Verify meeting exists and user is a participant
    meeting = await meeting_service.get_meeting(meeting_id)
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
    
    participant_emails = [p.email for p in meeting.participants]
    if user_email not in participant_emails:
        raise HTTPException(status_code=403, detail="You must be a participant to create polls")
    
    # Check if user is the meeting creator (first participant is the creator)
    if meeting.participants and meeting.participants[0].email != user_email:
        raise HTTPException(status_code=403, detail="Only the meeting creator can create polls")
    
    # Set meeting_id from URL parameter
    poll_data.meeting_id = meeting_id
    
    # Create poll
    poll = await poll_service.create_poll(poll_data, creator_email=user_email)
    return poll

@app.get("/api/meetings/{meeting_id}/polls", response_model=List[Poll])
async def get_meeting_polls(
    meeting_id: str,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security)
):
    """Get all polls for a meeting"""
    user = await get_current_user(credentials)
    user_email = user.get("email") if user else None
    if not user_email:
        raise HTTPException(status_code=401, detail="Not authenticated")
    
    # Verify meeting exists and user is a participant
    meeting = await meeting_service.get_meeting(meeting_id)
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
    
    participant_emails = [p.email for p in meeting.participants]
    if user_email not in participant_emails:
        raise HTTPException(status_code=403, detail="You must be a participant to view polls")
    
    polls = await poll_service.get_polls_for_meeting(meeting_id)
    return polls

@app.get("/api/polls/{poll_id}", response_model=Poll)
async def get_poll(
    poll_id: str,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security)
):
    """Get a specific poll by ID"""
    user = await get_current_user(credentials)
    user_email = user.get("email") if user else None
    if not user_email:
        raise HTTPException(status_code=401, detail="Not authenticated")
    
    poll = await poll_service.get_poll(poll_id)
    if not poll:
        raise HTTPException(status_code=404, detail="Poll not found")
    
    # Verify user is a participant in the meeting
    meeting = await meeting_service.get_meeting(poll.meeting_id)
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
    
    participant_emails = [p.email for p in meeting.participants]
    if user_email not in participant_emails:
        raise HTTPException(status_code=403, detail="You must be a participant to view this poll")
    
    return poll

@app.post("/api/polls/{poll_id}/vote", response_model=Poll)
async def vote_on_poll(
    poll_id: str,
    vote_data: Dict[str, str],
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security)
):
    """Vote on a poll option"""
    user = await get_current_user(credentials)
    user_email = user.get("email") if user else None
    if not user_email:
        raise HTTPException(status_code=401, detail="Not authenticated")
    
    option_id = vote_data.get("option_id")
    if not option_id:
        raise HTTPException(status_code=400, detail="option_id is required")
    
    # Verify poll exists
    poll = await poll_service.get_poll(poll_id)
    if not poll:
        raise HTTPException(status_code=404, detail="Poll not found")
    
    # Verify user is a participant in the meeting
    meeting = await meeting_service.get_meeting(poll.meeting_id)
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
    
    participant_emails = [p.email for p in meeting.participants]
    if user_email not in participant_emails:
        raise HTTPException(status_code=403, detail="You must be a participant to vote")
    
    # Use authenticated user's email
    updated_poll = await poll_service.vote_on_poll(poll_id, option_id, user_email)
    if not updated_poll:
        raise HTTPException(status_code=400, detail="Failed to vote on poll")
    
    return updated_poll

@app.post("/api/polls/{poll_id}/close", response_model=Poll)
async def close_poll(
    poll_id: str,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security)
):
    """Close a poll (only creator can close)"""
    user = await get_current_user(credentials)
    user_email = user.get("email") if user else None
    if not user_email:
        raise HTTPException(status_code=401, detail="Not authenticated")
    
    poll = await poll_service.get_poll(poll_id)
    if not poll:
        raise HTTPException(status_code=404, detail="Poll not found")
    
    # Only poll creator can close it
    if poll.creator_email != user_email:
        raise HTTPException(status_code=403, detail="Only poll creator can close the poll")
    
    closed_poll = await poll_service.close_poll(poll_id)
    if not closed_poll:
        raise HTTPException(status_code=400, detail="Failed to close poll")
    
    return closed_poll

@app.delete("/api/polls/{poll_id}")
async def delete_poll(
    poll_id: str,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security)
):
    """Delete a poll (only creator can delete)"""
    user = await get_current_user(credentials)
    user_email = user.get("email") if user else None
    if not user_email:
        raise HTTPException(status_code=401, detail="Not authenticated")
    
    poll = await poll_service.get_poll(poll_id)
    if not poll:
        raise HTTPException(status_code=404, detail="Poll not found")
    
    # Only poll creator can delete it
    if poll.creator_email != user_email:
        raise HTTPException(status_code=403, detail="Only poll creator can delete the poll")
    
    success = await poll_service.delete_poll(poll_id)
    if not success:
        raise HTTPException(status_code=404, detail="Poll not found")
    
    return {"message": "Poll deleted successfully"}

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
