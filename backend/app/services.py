from datetime import datetime
from typing import List, Optional, Dict, Any
from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorCollection
import uuid
from .database import get_meetings_collection, get_metadata_collection, get_users_collection
from .models import Meeting, MeetingCreate, MeetingUpdate, Metadata, User

class MeetingService:
    def __init__(self):
        self.collection: AsyncIOMotorCollection = get_meetings_collection()

    async def create_meeting(self, meeting_data: MeetingCreate, metadata: Optional[Dict[str, Any]] = None) -> Meeting:
        """Create a new meeting with metadata"""
        from datetime import timedelta
        
        participants = [
            {
                "id": str(uuid.uuid4()),
                "name": email.split('@')[0],
                "email": email,
                "availability": []
            }
            for email in meeting_data.participants
        ]
        
        start_time = meeting_data.preferred_date.replace(
            hour=9, minute=0, second=0, microsecond=0
        )
        end_time = start_time + timedelta(minutes=meeting_data.duration)
        
        meeting_doc = {
            "title": meeting_data.title,
            "description": meeting_data.description,
            "participants": participants,
            "start_time": start_time,
            "end_time": end_time,
            "duration": meeting_data.duration,
            "status": "scheduled",
            "created_at": datetime.utcnow(),
            "updated_at": datetime.utcnow(),
            "metadata": metadata or {}
        }
        
        result = await self.collection.insert_one(meeting_doc)
        meeting_doc["_id"] = result.inserted_id
        return Meeting(**meeting_doc)

    async def get_meeting(self, meeting_id: str) -> Optional[Meeting]:
        """Get a meeting by ID"""
        try:
            meeting_doc = await self.collection.find_one({"_id": ObjectId(meeting_id)})
            if meeting_doc:
                return Meeting(**meeting_doc)
            return None
        except Exception:
            return None

    async def get_all_meetings(self) -> List[Meeting]:
        """Get all meetings"""
        meetings = []
        cursor = self.collection.find({})
        async for meeting_doc in cursor:
            meetings.append(Meeting(**meeting_doc))
        return meetings

    async def update_meeting(self, meeting_id: str, update_data: MeetingUpdate) -> Optional[Meeting]:
        """Update a meeting"""
        try:
            update_dict = update_data.dict(exclude_unset=True)
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
