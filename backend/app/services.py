from datetime import datetime, timezone
from typing import List, Optional, Dict, Any
from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorCollection
from pymongo import ReturnDocument
import uuid
import logging
from .database import get_meetings_collection, get_metadata_collection, get_users_collection, get_polls_collection
from .meet_link import generate_google_meet_link
from .google_calendar import create_event_with_meet
from .models import Meeting, MeetingCreate, MeetingUpdate, Metadata, User, Poll, PollOption, PollVote
from .rooms_catalog import ROOMS_CATALOG, get_room_by_id

logger = logging.getLogger(__name__)

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
                    {"$set": {"status": new_status, "updated_at": datetime.now(timezone.utc)}}
                )
                meeting.status = new_status
                meeting.updated_at = datetime.now(timezone.utc)
        except Exception:
            # If status sync fails, return meeting as-is without blocking request
            pass
        return meeting

    def _determine_status(self, meeting: Meeting) -> str:
        if meeting.status == "cancelled":
            return "cancelled"
        if meeting.status == "polling":
            return "polling"

        now = datetime.now(timezone.utc)
        if meeting.start_time <= now < meeting.end_time:
            return "running"
        if now >= meeting.end_time:
            return "completed"

        # Preserve explicit statuses when upcoming
        if meeting.status in {"rescheduled", "confirmed"}:
            return meeting.status

        return "scheduled"

    async def create_meeting(
        self,
        meeting_data: MeetingCreate,
        metadata: Optional[Dict[str, Any]] = None,
        organizer_email: Optional[str] = None,
    ) -> Meeting:
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
        location_type = meta.get("location_type", "online")

        if location_type == "onsite":
            room_id = meta.get("room_id")
            await self._ensure_room_available(room_id, meeting_data.start_time, meeting_data.end_time)
            room = get_room_by_id(room_id)
            if room:
                meta.update(
                    {
                        "room_name": room["name"],
                        "room_capacity": room["capacity"],
                        "room_location": room["location"],
                        "room_features": room.get("features", []),
                        "room_notes": room.get("notes"),
                    }
                )
        else:
            # Clean up any stray onsite properties when forcing online meetings
            for key in ("room_id", "room_name", "room_capacity", "room_location", "room_features", "room_notes"):
                meta.pop(key, None)

        meta["location_type"] = location_type

        status = "polling" if meta.get("poll_pending") else "scheduled"
        meeting_doc = {
            "title": meeting_data.title,
            "description": meeting_data.description,
            "participants": participants,
            "start_time": meeting_data.start_time,
            "end_time": meeting_data.end_time,
            "duration": duration,
            "status": status,
            "organizer_email": organizer_email,
            "created_at": datetime.now(timezone.utc),
            "updated_at": datetime.now(timezone.utc),
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

    async def get_all_meetings(self, user_email: Optional[str] = None) -> List[Meeting]:
        """Get all meetings the user organizes or participates in."""
        query: Dict[str, Any] = {}
        if user_email:
            query = {
                "$or": [
                    {"organizer_email": user_email},
                    {"participants.email": user_email},
                ]
            }

        meetings: List[Meeting] = []
        cursor = self.collection.find(query)
        async for meeting_doc in cursor:
            meeting = Meeting(**meeting_doc)
            meetings.append(await self._sync_meeting_status(meeting))
        return meetings

    async def update_meeting(self, meeting_id: str, update_data: MeetingUpdate) -> Optional[Meeting]:
        """Update a meeting"""
        try:
            existing_doc = await self.collection.find_one({"_id": ObjectId(meeting_id)})
            if not existing_doc:
                return None
            existing = Meeting(**existing_doc)

            update_dict = update_data.model_dump(exclude_unset=True)
            participants_emails = update_dict.pop("participants_emails", None)
            if participants_emails is not None:
                update_dict["participants"] = [
                    {
                        "id": str(uuid.uuid4()),
                        "name": email.split('@')[0],
                        "email": email,
                        "availability": []
                    }
                    for email in participants_emails
                ]

            start = update_dict.get("start_time", existing.start_time)
            end = update_dict.get("end_time", existing.end_time)
            if "start_time" in update_dict or "end_time" in update_dict:
                duration = int((end - start).total_seconds() / 60)
                update_dict["duration"] = duration

            # Merge metadata (existing + incoming)
            existing_meta = dict(existing.metadata or {})
            incoming_meta = update_dict.get("metadata")
            if incoming_meta is not None:
                merged_meta = {**existing_meta, **incoming_meta}
            else:
                merged_meta = dict(existing_meta)

            location_type = merged_meta.get("location_type", existing_meta.get("location_type", "online"))
            if location_type == "onsite":
                room_id = merged_meta.get("room_id") or existing_meta.get("room_id")
                await self._ensure_room_available(room_id, start, end, exclude_meeting_id=meeting_id)
                room = get_room_by_id(room_id) if room_id else None
                if room:
                    merged_meta.update(
                        {
                            "room_id": room_id,
                            "room_name": room["name"],
                            "room_capacity": room["capacity"],
                            "room_location": room["location"],
                            "room_features": room.get("features", []),
                            "room_notes": room.get("notes"),
                        }
                    )
            else:
                for key in ("room_id", "room_name", "room_capacity", "room_location", "room_features", "room_notes"):
                    merged_meta.pop(key, None)

            merged_meta["location_type"] = location_type
            update_dict["metadata"] = merged_meta
            update_dict["updated_at"] = datetime.now(timezone.utc)
            
            result = await self.collection.update_one(
                {"_id": ObjectId(meeting_id)},
                {"$set": update_dict}
            )
            
            if result.modified_count > 0:
                return await self.get_meeting(meeting_id)
            return None
        except ValueError:
            raise
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
                        "updated_at": datetime.now(timezone.utc)
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
                {"$set": {"participants": updated_list, "updated_at": datetime.now(timezone.utc)}},
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

    async def find_room_conflicts(
        self,
        room_id: str,
        start_time: datetime,
        end_time: datetime,
        exclude_meeting_id: Optional[str] = None,
    ) -> List[Meeting]:
        query: Dict[str, Any] = {
            "metadata.room_id": room_id,
            "start_time": {"$lt": end_time},
            "end_time": {"$gt": start_time},
        }
        if exclude_meeting_id:
            query["_id"] = {"$ne": ObjectId(exclude_meeting_id)}
        conflicts: List[Meeting] = []
        cursor = self.collection.find(query)
        async for doc in cursor:
            conflicts.append(Meeting(**doc))
        return conflicts

    async def _ensure_room_available(
        self,
        room_id: Optional[str],
        start_time: datetime,
        end_time: datetime,
        exclude_meeting_id: Optional[str] = None,
    ) -> None:
        if not room_id:
            raise ValueError("Select a room for onsite meetings.")
        conflicts = await self.find_room_conflicts(room_id, start_time, end_time, exclude_meeting_id)
        if conflicts:
            room = get_room_by_id(room_id)
            room_name = room["name"] if room else "Selected room"
            conflicting = conflicts[0]
            readable = conflicting.start_time.strftime("%b %d %I:%M %p")
            raise ValueError(f"{room_name} is already reserved ({readable}). Choose another room or time.")

    async def get_rooms_availability(
        self,
        start_time: datetime,
        end_time: datetime,
        exclude_meeting_id: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        availability: List[Dict[str, Any]] = []
        for room in ROOMS_CATALOG:
            conflicts = await self.find_room_conflicts(room["id"], start_time, end_time, exclude_meeting_id)
            availability.append(
                {
                    **room,
                    "is_available": len(conflicts) == 0,
                    "conflicts": [
                        {
                            "meeting_id": str(conflict.id),
                            "title": conflict.title,
                            "start_time": conflict.start_time.isoformat(),
                            "end_time": conflict.end_time.isoformat(),
                        }
                        for conflict in conflicts
                    ],
                }
            )
        return availability

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
            "created_at": datetime.now(timezone.utc),
            "updated_at": datetime.now(timezone.utc)
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
                "updated_at": datetime.now(timezone.utc)
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
            "created_at": datetime.now(timezone.utc),
            "updated_at": datetime.now(timezone.utc)
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

    async def get_user_by_google_sub(self, google_sub: str) -> Optional[User]:
        try:
            user_doc = await self.collection.find_one({"google_sub": google_sub})
            if user_doc:
                return User(**user_doc)
            return None
        except Exception:
            return None

    async def upsert_google_user(
        self,
        *,
        email: str,
        name: str,
        google_sub: str,
        picture: Optional[str],
        credentials: Optional[Dict[str, Any]] = None,
    ) -> User:
        now = datetime.now(timezone.utc)
        update_doc: Dict[str, Any] = {
            "email": email,
            "name": name,
            "google_sub": google_sub,
            "picture": picture,
            "last_login_at": now,
            "updated_at": now,
        }
        if credentials:
            update_doc["preferences.google_credentials"] = credentials

        result = await self.collection.find_one_and_update(
            {"google_sub": google_sub},
            {"$set": update_doc,
             "$setOnInsert": {"created_at": now}},
            upsert=True,
            return_document=ReturnDocument.AFTER
        )
        if result:
            return User(**result)
        # fallback fetch
        return await self.get_user_by_google_sub(google_sub)

    async def update_user_preferences(self, email: str, preferences: Dict[str, Any]) -> Optional[User]:
        """Update user preferences"""
        try:
            result = await self.collection.update_one(
                {"email": email},
                {
                    "$set": {
                        "preferences": preferences,
                        "updated_at": datetime.now(timezone.utc)
                    }
                }
            )
            
            if result.modified_count > 0:
                return await self.get_user(email)
            return None
        except Exception:
            return None


class PollService:
    def __init__(self):
        self.collection: AsyncIOMotorCollection = get_polls_collection()

    @staticmethod
    def _ensure_utc(dt: Optional[datetime]) -> Optional[datetime]:
        if dt is None:
            return None
        if dt.tzinfo is None:
            return dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)

    async def create_poll(
        self,
        meeting_id: str,
        organizer_email: str,
        options: List[Dict[str, Any]],
        deadline: Optional[datetime] = None,
    ) -> Poll:
        poll_doc = {
            "meeting_id": meeting_id,
            "organizer_email": organizer_email,
            "options": [PollOption(**opt).model_dump() for opt in options],
            "votes": [],
            "status": "open",
            "deadline": self._ensure_utc(deadline),
            "created_at": datetime.now(timezone.utc),
            "updated_at": datetime.now(timezone.utc),
        }
        result = await self.collection.insert_one(poll_doc)
        poll_doc["_id"] = result.inserted_id
        return Poll(**poll_doc)

    async def get_poll(self, poll_id: str) -> Optional[Poll]:
        try:
            poll_doc = await self.collection.find_one({"_id": ObjectId(poll_id)})
            if poll_doc:
                return Poll(**poll_doc)
            return None
        except Exception:
            return None

    async def add_vote(self, poll_id: str, option_id: str, voter_email: str) -> Optional[Poll]:
        poll = await self.get_poll(poll_id)
        if not poll:
            return None
        if poll.status != "open":
            raise ValueError("Poll is closed")
        normalized_deadline = self._ensure_utc(poll.deadline)
        if normalized_deadline and datetime.now(timezone.utc) >= normalized_deadline:
            raise ValueError("Poll deadline has passed")
        if normalized_deadline and poll.deadline != normalized_deadline:
            poll.deadline = normalized_deadline

        # Remove any existing vote from this voter
        poll.votes = [vote for vote in poll.votes if vote.voter_email.lower() != voter_email.lower()]
        poll.votes.append(PollVote(option_id=option_id, voter_email=voter_email))

        # Update vote counts
        vote_counts: Dict[str, int] = {}
        for vote in poll.votes:
            vote_counts[vote.option_id] = vote_counts.get(vote.option_id, 0) + 1
        for option in poll.options:
            option.votes = vote_counts.get(option.id, 0)

        poll.updated_at = datetime.now(timezone.utc)
        await self.collection.update_one(
            {"_id": poll.id},
            {"$set": poll.model_dump()}
        )
        return poll

    async def finalize_poll(self, poll_id: str, option_id: Optional[str] = None) -> Optional[Poll]:
        poll = await self.get_poll(poll_id)
        if not poll:
            return None
        if poll.status == "closed":
            return poll

        if option_id is None:
            # Pick option with most votes, tie -> earliest start time
            sorted_options = sorted(
                poll.options,
                key=lambda opt: (-opt.votes, opt.start_time)
            )
            if not sorted_options:
                raise ValueError("No options to finalize")
            option_id = sorted_options[0].id

        poll.status = "closed"
        poll.winning_option_id = option_id
        poll.updated_at = datetime.now(timezone.utc)
        await self.collection.update_one(
            {"_id": poll.id},
            {"$set": poll.model_dump()}
        )
        return poll

    async def finalize_expired_polls(self) -> List[Poll]:
        """Automatically finalize polls whose deadlines have passed."""
        now = datetime.now(timezone.utc)
        query = {
            "status": "open",
            "deadline": {"$ne": None, "$lte": now},
        }
        finalized: List[Poll] = []
        cursor = self.collection.find(query)
        async for poll_doc in cursor:
            poll = Poll(**poll_doc)
            try:
                finalized_poll = await self.finalize_poll(str(poll.id))
                if finalized_poll:
                    finalized.append(finalized_poll)
            except Exception as exc:
                logger.error("Auto finalization failed for poll %s: %s", poll.id, exc)
        return finalized
