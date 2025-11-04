from datetime import datetime
from typing import List, Optional, Dict, Any
from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorCollection
import uuid
from .database import get_meetings_collection, get_metadata_collection, get_users_collection
from .meet_link import generate_google_meet_link
from .google_calendar import create_event_with_meet
from .models import Meeting, MeetingCreate, MeetingUpdate, Metadata, User

class MeetingService:
    def __init__(self):
        self.collection: AsyncIOMotorCollection = get_meetings_collection()

    async def _sync_meeting_status(self, meeting: Meeting) -> Meeting:
        """Ensure the meeting status reflects its current time window."""
        try:
            new_status = self._determine_status(meeting)
            if new_status != meeting.status:
                await self.collection.update_one(
                    {"_id": meeting.id},
                    {"$set": {"status": new_status, "updated_at": datetime.utcnow()}}
                )
                meeting.status = new_status
                meeting.updated_at = datetime.utcnow()
        except Exception:
            # If status sync fails, return meeting as-is without blocking request
            pass
        return meeting

    def _determine_status(self, meeting: Meeting) -> str:
        if meeting.status == "cancelled":
            return "cancelled"

        now = datetime.utcnow()
        if meeting.start_time <= now < meeting.end_time:
            return "running"
        if now >= meeting.end_time:
            return "completed"

        # Preserve explicit statuses when upcoming
        if meeting.status in {"rescheduled", "confirmed"}:
            return meeting.status

        return "scheduled"

    async def create_meeting(self, meeting_data: MeetingCreate, metadata: Optional[Dict[str, Any]] = None) -> Meeting:
        """Create a new meeting with metadata"""
        from datetime import timedelta
        
        # Create participants from email addresses
        participants = [
            {
                "id": str(uuid.uuid4()),
                "name": email.split('@')[0],
                "email": email,
                "availability": []
            }
            for email in meeting_data.participants
        ]
        
        # Calculate duration from start and end times
        duration = int((meeting_data.end_time - meeting_data.start_time).total_seconds() / 60)
        
        # Prepare metadata and mark this as online by default unless specified
        meta: Dict[str, Any] = dict(metadata or {})
        meta.setdefault("location_type", "online")

        meeting_doc = {
            "title": meeting_data.title,
            "description": meeting_data.description,
            "participants": participants,
            "start_time": meeting_data.start_time,
            "end_time": meeting_data.end_time,
            "duration": duration,
            "status": "scheduled",
            "created_at": datetime.utcnow(),
            "updated_at": datetime.utcnow(),
            "metadata": meta
        }
        
        result = await self.collection.insert_one(meeting_doc)
        meeting_doc["_id"] = result.inserted_id
        return Meeting(**meeting_doc)

    async def get_meeting(self, meeting_id: str) -> Optional[Meeting]:
        """Get a meeting by ID"""
        try:
            meeting_doc = await self.collection.find_one({"_id": ObjectId(meeting_id)})
            if meeting_doc:
                meeting = Meeting(**meeting_doc)
                return await self._sync_meeting_status(meeting)
            return None
        except Exception:
            return None

    async def get_all_meetings(self) -> List[Meeting]:
        """Get all meetings"""
        meetings = []
        cursor = self.collection.find({})
        async for meeting_doc in cursor:
            meeting = Meeting(**meeting_doc)
            meetings.append(await self._sync_meeting_status(meeting))
        return meetings

    async def update_meeting(self, meeting_id: str, update_data: MeetingUpdate) -> Optional[Meeting]:
        """Update a meeting"""
        try:
            update_dict = update_data.model_dump(exclude_unset=True)
            participants_emails = update_dict.pop("participants_emails", None)
            if participants_emails is not None:
                # Rebuild participants array from the provided emails
                update_dict["participants"] = [
                    {
                        "id": str(uuid.uuid4()),
                        "name": email.split('@')[0],
                        "email": email,
                        "availability": []
                    }
                    for email in participants_emails
                ]
            # Recalculate duration if start or end time is being changed
            if "start_time" in update_dict or "end_time" in update_dict:
                existing = await self.collection.find_one({"_id": ObjectId(meeting_id)})
                if not existing:
                    return None
                start = update_dict.get("start_time", existing.get("start_time"))
                end = update_dict.get("end_time", existing.get("end_time"))
                # Compute minutes duration (int)
                duration = int((end - start).total_seconds() / 60)
                update_dict["duration"] = duration

            update_dict["updated_at"] = datetime.utcnow()
            
            result = await self.collection.update_one(
                {"_id": ObjectId(meeting_id)},
                {"$set": update_dict}
            )
            
            if result.modified_count > 0:
                return await self.get_meeting(meeting_id)
            return None
        except Exception:
            return None

    async def delete_meeting(self, meeting_id: str) -> bool:
        """Delete a meeting"""
        try:
            result = await self.collection.delete_one({"_id": ObjectId(meeting_id)})
            return result.deleted_count > 0
        except Exception:
            return False

    async def update_meeting_metadata(self, meeting_id: str, metadata: Dict[str, Any]) -> Optional[Meeting]:
        """Update meeting metadata"""
        try:
            result = await self.collection.update_one(
                {"_id": ObjectId(meeting_id)},
                {
                    "$set": {
                        "metadata": metadata,
                        "updated_at": datetime.utcnow()
                    }
                }
            )
            
            if result.modified_count > 0:
                return await self.get_meeting(meeting_id)
            return None
        except Exception:
            return None

    async def add_participants(self, meeting_id: str, emails: List[str]) -> Optional[Meeting]:
        """Add new participants (by email) to a meeting"""
        meeting = await self.get_meeting(meeting_id)
        if not meeting:
            return None

        existing_emails = {p.email for p in meeting.participants}
        to_add = [e for e in emails if e not in existing_emails]
        if not to_add:
            return meeting

        new_participants = [
            {
                "id": str(uuid.uuid4()),
                "name": email.split('@')[0],
                "email": email,
                "availability": []
            }
            for email in to_add
        ]

        updated_list = [p.model_dump() for p in meeting.participants] + new_participants

        try:
            await self.collection.update_one(
                {"_id": ObjectId(meeting_id)},
                {"$set": {"participants": updated_list, "updated_at": datetime.utcnow()}},
            )
            return await self.get_meeting(meeting_id)
        except Exception:
            return None

    async def generate_meet_link(self, meeting_id: str) -> Optional[Meeting]:
        """Generate and attach a Google Meet link for the meeting"""
        meeting = await self.get_meeting(meeting_id)
        if not meeting:
            return None
        meta = dict(meeting.metadata or {})
        meta.setdefault("location_type", "online")
        meta["meeting_platform"] = "google_meet"
        meta["meeting_url"] = meta.get("meeting_url") or generate_google_meet_link()
        return await self.update_meeting_metadata(meeting_id, meta)

class MetadataService:
    def __init__(self):
        self.collection: AsyncIOMotorCollection = get_metadata_collection()

    async def create_metadata(self, key: str, value: Any, metadata_type: str, description: Optional[str] = None) -> Metadata:
        """Create metadata entry"""
        metadata_doc = {
            "key": key,
            "value": value,
            "type": metadata_type,
            "description": description,
            "created_at": datetime.utcnow(),
            "updated_at": datetime.utcnow()
        }
        
        result = await self.collection.insert_one(metadata_doc)
        metadata_doc["_id"] = result.inserted_id
        return Metadata(**metadata_doc)

    async def get_metadata(self, key: str) -> Optional[Metadata]:
        """Get metadata by key"""
        try:
            metadata_doc = await self.collection.find_one({"key": key})
            if metadata_doc:
                return Metadata(**metadata_doc)
            return None
        except Exception:
            return None

    async def get_all_metadata(self) -> List[Metadata]:
        """Get all metadata"""
        metadata_list = []
        cursor = self.collection.find({})
        async for metadata_doc in cursor:
            metadata_list.append(Metadata(**metadata_doc))
        return metadata_list

    async def update_metadata(self, key: str, value: Any, metadata_type: str, description: Optional[str] = None) -> Optional[Metadata]:
        """Update metadata"""
        try:
            update_dict = {
                "value": value,
                "type": metadata_type,
                "updated_at": datetime.utcnow()
            }
            if description:
                update_dict["description"] = description
            
            result = await self.collection.update_one(
                {"key": key},
                {"$set": update_dict},
                upsert=True
            )
            
            return await self.get_metadata(key)
        except Exception:
            return None

    async def delete_metadata(self, key: str) -> bool:
        """Delete metadata by key"""
        try:
            result = await self.collection.delete_one({"key": key})
            return result.deleted_count > 0
        except Exception:
            return False

class UserService:
    def __init__(self):
        self.collection: AsyncIOMotorCollection = get_users_collection()

    async def create_user(self, email: str, name: str, preferences: Optional[Dict[str, Any]] = None) -> User:
        """Create a new user"""
        user_doc = {
            "email": email,
            "name": name,
            "preferences": preferences or {},
            "created_at": datetime.utcnow(),
            "updated_at": datetime.utcnow()
        }
        
        result = await self.collection.insert_one(user_doc)
        user_doc["_id"] = result.inserted_id
        return User(**user_doc)

    async def get_user(self, email: str) -> Optional[User]:
        """Get user by email"""
        try:
            user_doc = await self.collection.find_one({"email": email})
            if user_doc:
                return User(**user_doc)
            return None
        except Exception:
            return None

    async def update_user_preferences(self, email: str, preferences: Dict[str, Any]) -> Optional[User]:
        """Update user preferences"""
        try:
            result = await self.collection.update_one(
                {"email": email},
                {
                    "$set": {
                        "preferences": preferences,
                        "updated_at": datetime.utcnow()
                    }
                }
            )
            
            if result.modified_count > 0:
                return await self.get_user(email)
            return None
        except Exception:
            return None
