import pytest
from fastapi.testclient import TestClient
from main import app

client = TestClient(app)

def test_health_check():
    """Test the health check endpoint"""
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "healthy"
    assert "timestamp" in data
    assert data["service"] == "meeting-scheduler-backend"

def test_get_meetings():
    """Test getting meetings endpoint"""
    response = client.get("/api/meetings")
    assert response.status_code == 401

def test_create_meeting():
    """Test creating a meeting endpoint"""
    meeting_data = {
        "title": "Test Meeting",
        "description": "A test meeting",
        "participants": ["test@example.com"],
        "duration": 60,
        "preferred_date": "2024-01-15T09:00:00"
    }
    response = client.post("/api/meetings", json=meeting_data)
    assert response.status_code == 401

def test_api_documentation():
    """Test that API documentation is available"""
    response = client.get("/docs")
    assert response.status_code == 200

def test_openapi_schema():
    """Test that OpenAPI schema is available"""
    response = client.get("/openapi.json")
    assert response.status_code == 200
