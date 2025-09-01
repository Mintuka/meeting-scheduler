from fastapi import FastAPI, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import JSONResponse
from fastapi.security import HTTPBearer
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

meeting_service = MeetingService()
metadata_service = MetadataService()
user_service = UserService()

@asynccontextmanager
async def lifespan(app: FastAPI):
    print("Starting Meeting Scheduler Backend...")
    await MongoDB.connect_to_mongo()
    yield
    print("Shutting down Meeting Scheduler Backend...")
    await MongoDB.close_mongo_connection()

app = FastAPI(
    title="Meeting Scheduler API",
    description="AI-powered meeting scheduling API",
    version="1.0.0",
    lifespan=lifespan
)

security = HTTPBearer()

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

async def get_current_user(token: str = Depends(security)):
    return {"user_id": "mock_user", "email": "user@example.com"}

@app.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "timestamp": datetime.utcnow().isoformat(),
        "service": "meeting-scheduler-backend"
    }

@app.get("/api/meetings", response_model=List[Meeting])
async def get_meetings(current_user: dict = Depends(get_current_user)):
    """Get all meetings for the current user"""
    return await meeting_service.get_all_meetings()

@app.post("/api/meetings", response_model=Meeting)
async def create_meeting(
    meeting_data: MeetingCreate,
    current_user: dict = Depends(get_current_user)
):
    """Create a new meeting"""
    return await meeting_service.create_meeting(meeting_data, meeting_data.metadata)

@app.get("/api/meetings/{meeting_id}", response_model=Meeting)
async def get_meeting(
    meeting_id: str,
    current_user: dict = Depends(get_current_user)
):
    """Get a specific meeting by ID"""
    meeting = await meeting_service.get_meeting(meeting_id)
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
    return meeting

@app.put("/api/meetings/{meeting_id}", response_model=Meeting)
async def update_meeting(
    meeting_id: str,
    meeting_update: MeetingUpdate,
    current_user: dict = Depends(get_current_user)
):
    """Update a meeting"""
    meeting = await meeting_service.update_meeting(meeting_id, meeting_update)
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
    return meeting

@app.delete("/api/meetings/{meeting_id}")
async def delete_meeting(
    meeting_id: str,
    current_user: dict = Depends(get_current_user)
):
    """Delete a meeting"""
    success = await meeting_service.delete_meeting(meeting_id)
    if not success:
        raise HTTPException(status_code=404, detail="Meeting not found")
    return {"message": "Meeting deleted successfully"}

@app.post("/api/meetings/{meeting_id}/send-reminder")
async def send_reminder(
    meeting_id: str,
    current_user: dict = Depends(get_current_user)
):
    """Send reminder for a meeting"""
    meeting = await meeting_service.get_meeting(meeting_id)
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
    
    print(f"Sending reminder for meeting: {meeting.title}")
    return {"message": "Reminder sent successfully"}

@app.post("/api/metadata", response_model=Metadata)
async def create_metadata(
    key: str,
    value: Any,
    metadata_type: str,
    description: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    """Create metadata entry"""
    return await metadata_service.create_metadata(key, value, metadata_type, description)

@app.get("/api/metadata/{key}", response_model=Metadata)
async def get_metadata(
    key: str,
    current_user: dict = Depends(get_current_user)
):
    """Get metadata by key"""
    metadata = await metadata_service.get_metadata(key)
    if not metadata:
        raise HTTPException(status_code=404, detail="Metadata not found")
    return metadata

@app.get("/api/metadata", response_model=List[Metadata])
async def get_all_metadata(current_user: dict = Depends(get_current_user)):
    """Get all metadata"""
    return await metadata_service.get_all_metadata()

@app.put("/api/metadata/{key}", response_model=Metadata)
async def update_metadata(
    key: str,
    value: Any,
    metadata_type: str,
    description: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    """Update metadata"""
    metadata = await metadata_service.update_metadata(key, value, metadata_type, description)
    if not metadata:
        raise HTTPException(status_code=404, detail="Metadata not found")
    return metadata

@app.delete("/api/metadata/{key}")
async def delete_metadata(
    key: str,
    current_user: dict = Depends(get_current_user)
):
    """Delete metadata by key"""
    success = await metadata_service.delete_metadata(key)
    if not success:
        raise HTTPException(status_code=404, detail="Metadata not found")
    return {"message": "Metadata deleted successfully"}

@app.put("/api/meetings/{meeting_id}/metadata")
async def update_meeting_metadata(
    meeting_id: str,
    metadata: Dict[str, Any],
    current_user: dict = Depends(get_current_user)
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
