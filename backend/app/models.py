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
    preferences: Dict[str, Any] = Field(default_factory=dict)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
