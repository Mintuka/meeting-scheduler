#!/usr/bin/env python3
"""
Database initialization script for Meeting Scheduler
Creates sample metadata and initializes the database
"""

import asyncio
import os
import sys
from datetime import datetime

sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from app.database import MongoDB
from app.services import MetadataService

async def initialize_database():
    """Initialize the database with sample metadata"""
    try:
        await MongoDB.connect_to_mongo()
        print("✅ Connected to MongoDB")
        
        metadata_service = MetadataService()
        
        sample_metadata = [
            {
                "key": "app_version",
                "value": "1.0.0",
                "type": "string",
                "description": "Current application version"
            },
            {
                "key": "max_meeting_duration",
                "value": 480,
                "type": "number",
                "description": "Maximum meeting duration in minutes"
            },
            {
                "key": "default_meeting_duration",
                "value": 60,
                "type": "number",
                "description": "Default meeting duration in minutes"
            },
            {
                "key": "business_hours",
                "value": {
                    "start": "09:00",
                    "end": "17:00",
                    "timezone": "UTC"
                },
                "type": "object",
                "description": "Default business hours for scheduling"
            },
            {
                "key": "supported_timezones",
                "value": ["UTC", "EST", "PST", "GMT", "CET"],
                "type": "array",
                "description": "Supported timezones for meetings"
            },
            {
                "key": "email_notifications_enabled",
                "value": True,
                "type": "boolean",
                "description": "Whether email notifications are enabled"
            },
            {
                "key": "ai_scheduling_enabled",
                "value": True,
                "type": "boolean",
                "description": "Whether AI-powered scheduling is enabled"
            },
            {
                "key": "max_participants",
                "value": 50,
                "type": "number",
                "description": "Maximum number of participants per meeting"
            },
            {
                "key": "meeting_types",
                "value": ["one-on-one", "team", "client", "interview", "presentation"],
                "type": "array",
                "description": "Available meeting types"
            },
            {
                "key": "reminder_intervals",
                "value": [15, 30, 60, 1440],
                "type": "array",
                "description": "Available reminder intervals in minutes"
            }
        ]
        
        created_count = 0
        for metadata_item in sample_metadata:
            try:
                await metadata_service.create_metadata(
                    key=metadata_item["key"],
                    value=metadata_item["value"],
                    metadata_type=metadata_item["type"],
                    description=metadata_item["description"]
                )
                created_count += 1
                print(f"✅ Created metadata: {metadata_item['key']}")
            except Exception as e:
                print(f"⚠️  Failed to create metadata {metadata_item['key']}: {e}")
        
        print(f"\n🎉 Database initialization complete!")
        print(f"📊 Created {created_count} metadata entries")
        
        print("\n📋 Current metadata:")
        all_metadata = await metadata_service.get_all_metadata()
        for metadata in all_metadata:
            print(f"  • {metadata.key}: {metadata.value} ({metadata.type})")
        
    except Exception as e:
        print(f"❌ Database initialization failed: {e}")
        raise
    finally:
        await MongoDB.close_mongo_connection()

if __name__ == "__main__":
    print("🚀 Initializing Meeting Scheduler Database...")
    asyncio.run(initialize_database())
