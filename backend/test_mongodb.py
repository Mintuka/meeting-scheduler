import pytest
import asyncio
from datetime import datetime
from typing import Dict, Any

from app.database import MongoDB
from app.models import Meeting, MeetingCreate, Metadata
from app.services import MeetingService, MetadataService

@pytest.fixture
async def setup_database():
    """Setup database connection for tests"""
    await MongoDB.connect_to_mongo()
    yield
    await MongoDB.close_mongo_connection()

@pytest.fixture
def sample_meeting_data():
    """Sample meeting data for testing"""
    return MeetingCreate(
        title="Test Meeting",
        description="A test meeting",
        participants=["test@example.com", "user@example.com"],
        duration=60,
        preferred_date=datetime.utcnow(),
        metadata={"test": True, "priority": "high"}
    )

@pytest.fixture
def sample_metadata():
    """Sample metadata for testing"""
    return {
        "key": "test_key",
        "value": "test_value",
        "type": "string",
        "description": "Test metadata"
    }

class TestMongoDBConnection:
    """Test MongoDB connection and basic operations"""
    
    @pytest.mark.asyncio
    async def test_database_connection(self, setup_database):
        """Test that we can connect to MongoDB"""
        assert MongoDB.client is not None
        assert MongoDB.database is not None
        
        result = await MongoDB.client.admin.command('ping')
        assert result['ok'] == 1

class TestMetadataService:
    """Test metadata service operations"""
    
    @pytest.mark.asyncio
    async def test_create_metadata(self, setup_database, sample_metadata):
        """Test creating metadata"""
        metadata_service = MetadataService()
        
        metadata = await metadata_service.create_metadata(
            key=sample_metadata["key"],
            value=sample_metadata["value"],
            metadata_type=sample_metadata["type"],
            description=sample_metadata["description"]
        )
        
        assert metadata is not None
        assert metadata.key == sample_metadata["key"]
        assert metadata.value == sample_metadata["value"]
        assert metadata.type == sample_metadata["type"]
    
    @pytest.mark.asyncio
    async def test_get_metadata(self, setup_database, sample_metadata):
        """Test retrieving metadata"""
        metadata_service = MetadataService()
        
        await metadata_service.create_metadata(
            key=sample_metadata["key"],
            value=sample_metadata["value"],
            metadata_type=sample_metadata["type"],
            description=sample_metadata["description"]
        )
        
        metadata = await metadata_service.get_metadata(sample_metadata["key"])
        
        assert metadata is not None
        assert metadata.key == sample_metadata["key"]
        assert metadata.value == sample_metadata["value"]
    
    @pytest.mark.asyncio
    async def test_get_all_metadata(self, setup_database):
        """Test retrieving all metadata"""
        metadata_service = MetadataService()
        
        await metadata_service.create_metadata("key1", "value1", "string")
        await metadata_service.create_metadata("key2", "value2", "string")
        
        all_metadata = await metadata_service.get_all_metadata()
        
        assert len(all_metadata) >= 2
        keys = [m.key for m in all_metadata]
        assert "key1" in keys
        assert "key2" in keys

class TestMeetingService:
    """Test meeting service operations"""
    
    @pytest.mark.asyncio
    async def test_create_meeting(self, setup_database, sample_meeting_data):
        """Test creating a meeting"""
        meeting_service = MeetingService()
        
        meeting = await meeting_service.create_meeting(
            sample_meeting_data, 
            sample_meeting_data.metadata
        )
        
        assert meeting is not None
        assert meeting.title == sample_meeting_data.title
        assert meeting.description == sample_meeting_data.description
        assert len(meeting.participants) == len(sample_meeting_data.participants)
        assert meeting.metadata == sample_meeting_data.metadata
    
    @pytest.mark.asyncio
    async def test_get_meeting(self, setup_database, sample_meeting_data):
        """Test retrieving a meeting"""
        meeting_service = MeetingService()
        
        created_meeting = await meeting_service.create_meeting(
            sample_meeting_data, 
            sample_meeting_data.metadata
        )
        
        meeting = await meeting_service.get_meeting(str(created_meeting.id))
        
        assert meeting is not None
        assert meeting.title == sample_meeting_data.title
        assert meeting.id == created_meeting.id
    
    @pytest.mark.asyncio
    async def test_get_all_meetings(self, setup_database, sample_meeting_data):
        """Test retrieving all meetings"""
        meeting_service = MeetingService()
        
        await meeting_service.create_meeting(sample_meeting_data, {})
        
        second_meeting_data = MeetingCreate(
            title="Second Meeting",
            description="Another test meeting",
            participants=["user2@example.com"],
            duration=30,
            preferred_date=datetime.utcnow(),
            metadata={"test": False}
        )
        await meeting_service.create_meeting(second_meeting_data, {})
        
        all_meetings = await meeting_service.get_all_meetings()
        
        assert len(all_meetings) >= 2
        titles = [m.title for m in all_meetings]
        assert "Test Meeting" in titles
        assert "Second Meeting" in titles

if __name__ == "__main__":
    pytest.main([__file__, "-v"])
