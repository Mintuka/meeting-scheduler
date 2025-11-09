from datetime import datetime
from typing import List, Optional, Dict, Any, Annotated
from pydantic import BaseModel, Field, BeforeValidator
from bson import ObjectId
import uuid

def validate_object_id(v):
    if isinstance(v, ObjectId):
        return v
    if isinstance(v, str):
        if ObjectId.is_valid(v):
            return ObjectId(v)
        raise ValueError("Invalid ObjectId string")
    raise ValueError("Invalid ObjectId")

PyObjectId = Annotated[ObjectId, BeforeValidator(validate_object_id)]

class MongoModel(BaseModel):
    id: Optional[PyObjectId] = Field(default_factory=ObjectId, alias="_id")
    
    model_config = {
        "populate_by_name": True,
        "arbitrary_types_allowed": True,
        "json_encoders": {ObjectId: str}
    }

class TimeSlot(BaseModel):
    start: datetime
    end: datetime
    is_available: bool = True

class Participant(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    email: str
    availability: List[TimeSlot] = []

class Meeting(MongoModel):
    title: str
    description: str
    participants: List[Participant]
    start_time: datetime
    end_time: datetime
    duration: int
    status: str = "scheduled"
    organizer_email: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
    metadata: Dict[str, Any] = Field(default_factory=dict)

class MeetingCreate(BaseModel):
    title: str
    description: str
    participants: List[str]  # List of email addresses
    start_time: datetime
    end_time: datetime
    preferred_date: Optional[datetime] = None
    metadata: Optional[Dict[str, Any]] = None

class MeetingUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None
    status: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None
    # Optional: replace participants list with these email addresses
    participants_emails: Optional[List[str]] = None

class Metadata(MongoModel):
    key: str
    value: Any
    type: str
    description: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

class User(MongoModel):
    email: str
    name: str
    google_sub: Optional[str] = None
    picture: Optional[str] = None
    calendars: Dict[str, Any] = Field(default_factory=dict)
    preferences: Dict[str, Any] = Field(default_factory=dict)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
    last_login_at: Optional[datetime] = None


class PollOption(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    start_time: datetime
    end_time: datetime
    votes: int = 0


class PollVote(BaseModel):
    option_id: str
    voter_email: str
    voted_at: datetime = Field(default_factory=datetime.utcnow)


class Poll(MongoModel):
    meeting_id: str
    organizer_email: str
    options: List[PollOption]
    votes: List[PollVote] = Field(default_factory=list)
    status: str = Field(default="open")  # open | closed
    deadline: Optional[datetime] = None
    winning_option_id: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class Room(BaseModel):
    id: str
    name: str
    capacity: int
    location: str
    features: List[str] = Field(default_factory=list)
    notes: Optional[str] = None


class RoomAvailability(BaseModel):
    id: str
    name: str
    capacity: int
    location: str
    features: List[str] = Field(default_factory=list)
    notes: Optional[str] = None
    is_available: bool
    conflicts: List[Dict[str, Any]] = Field(default_factory=list)
