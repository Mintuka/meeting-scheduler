#!/bin/bash

echo "🧪 Testing Notification Service"
echo "================================"

# Test 1: Health Check
echo "1. Testing health endpoint..."
curl -s http://localhost:8000/health | jq .

# Test 2: Create a meeting
echo -e "\n2. Creating a test meeting..."
MEETING_ID=$(curl -s -X POST http://localhost:8000/api/meetings \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Notification Test Meeting",
    "description": "Testing the notification service",
    "participants": ["test1@example.com", "test2@example.com"],
    "start_time": "2025-09-05T14:00:00Z",
    "end_time": "2025-09-05T15:00:00Z"
  }' | jq -r '._id')

echo "Meeting created with ID: $MEETING_ID"

# Test 3: Send invitation
echo -e "\n3. Testing invitation sending..."
curl -s -X POST http://localhost:8000/api/meetings/$MEETING_ID/send-invitation | jq .

# Test 4: Send reminder
echo -e "\n4. Testing reminder sending..."
curl -s -X POST http://localhost:8000/api/meetings/$MEETING_ID/send-reminder | jq .

# Test 5: Send update notification
echo -e "\n5. Testing update notification..."
curl -s -X POST http://localhost:8000/api/meetings/$MEETING_ID/send-update \
  -H "Content-Type: application/json" \
  -d '{"changes_description": "Meeting time has been updated"}' | jq .

# Test 6: Send cancellation notification
echo -e "\n6. Testing cancellation notification..."
curl -s -X POST http://localhost:8000/api/meetings/$MEETING_ID/send-cancellation \
  -H "Content-Type: application/json" \
  -d '{"cancellation_reason": "Meeting cancelled due to scheduling conflict"}' | jq .

echo -e "\n✅ Notification service test completed!"
echo "📧 Note: Email sending will fail without proper SMTP credentials"
echo "🌐 Frontend is available at: http://localhost:3000"
echo "🔧 Backend API is available at: http://localhost:8000"
