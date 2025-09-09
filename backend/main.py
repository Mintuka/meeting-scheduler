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
from app.notification_service import notification_service
from app.email_reply_listener import EmailReplyListener

# Request models for notification endpoints
class UpdateNotificationRequest(BaseModel):
    changes_description: str

class CancellationNotificationRequest(BaseModel):
    cancellation_reason: str

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
        raise HTTPException(status_code=400, detail="End time must be after start time")
    
    return await meeting_service.create_meeting(meeting_data, meeting_data.metadata)

@app.get("/api/meetings/{meeting_id}", response_model=Meeting)
async def get_meeting(meeting_id: str):
    """Get a specific meeting by ID"""
    meeting = await meeting_service.get_meeting(meeting_id)
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
    return meeting

@app.put("/api/meetings/{meeting_id}", response_model=Meeting)
async def update_meeting(meeting_id: str, meeting_update: MeetingUpdate):
    """Update a meeting"""
    meeting = await meeting_service.update_meeting(meeting_id, meeting_update)
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
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
