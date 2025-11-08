import os
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo.errors import ConnectionFailure
from typing import Optional
import logging

logger = logging.getLogger(__name__)

class MongoDB:
    client: Optional[AsyncIOMotorClient] = None
    database = None
    # 
    @classmethod
    async def connect_to_mongo(cls):
        """Create database connection."""
        try:
            mongo_url = os.getenv("MONGODB_URL", "mongodb://localhost:27017")
            database_name = os.getenv("MONGODB_DATABASE", "meeting_scheduler")
            
            cls.client = AsyncIOMotorClient(mongo_url)
            cls.database = cls.client[database_name]
            
            await cls.client.admin.command('ping')
            logger.info("Successfully connected to MongoDB")
            
        except ConnectionFailure as e:
            logger.error(f"Failed to connect to MongoDB: {e}")
            raise
        except Exception as e:
            logger.error(f"Unexpected error connecting to MongoDB: {e}")
            raise

    @classmethod
    async def close_mongo_connection(cls):
        """Close database connection."""
        if cls.client:
            cls.client.close()
            logger.info("MongoDB connection closed")

    @classmethod
    def get_collection(cls, collection_name: str):
        """Get a collection from the database."""
        if cls.database is None:
            raise RuntimeError("Database not initialized. Call connect_to_mongo() first.")
        return cls.database[collection_name]

def get_meetings_collection():
    """Get the meetings collection."""
    return MongoDB.get_collection("meetings")

def get_users_collection():
    """Get the users collection."""
    return MongoDB.get_collection("users")

def get_metadata_collection():
    """Get the metadata collection."""
    return MongoDB.get_collection("metadata")

def get_events_collection():
    """Get the events collection."""
    return MongoDB.get_collection("events")

def get_polls_collection():
    """Get the polls collection."""
    return MongoDB.get_collection("polls")
