from datetime import datetime, timedelta
from typing import Optional, Dict, Any
import os
from jose import jwt, JWTError
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
import httpx

# JWT secret key (should be in environment variables)
JWT_SECRET_KEY = os.getenv("JWT_SECRET_KEY", "your-secret-key-change-in-production")
JWT_ALGORITHM = "HS256"
JWT_EXPIRATION_HOURS = 24 * 7  # 7 days

def create_access_token(data: Dict[str, Any]) -> str:
    """Create a JWT access token"""
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(hours=JWT_EXPIRATION_HOURS)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, JWT_SECRET_KEY, algorithm=JWT_ALGORITHM)
    return encoded_jwt

def verify_token(token: str) -> Optional[Dict[str, Any]]:
    """Verify and decode a JWT token"""
    try:
        payload = jwt.decode(token, JWT_SECRET_KEY, algorithms=[JWT_ALGORITHM])
        return payload
    except (JWTError, Exception):
        return None

async def get_google_user_info(access_token: str) -> Dict[str, Any]:
    """Get user info from Google using access token"""
    async with httpx.AsyncClient() as client:
        response = await client.get(
            "https://www.googleapis.com/oauth2/v2/userinfo",
            headers={"Authorization": f"Bearer {access_token}"}
        )
        if response.status_code == 200:
            return response.json()
        raise Exception(f"Failed to get user info: {response.status_code}")

def get_user_info_from_token(token: str) -> Dict[str, Any]:
    """Extract user info from token"""
    payload = verify_token(token)
    if payload:
        return {
            "email": payload.get("email"),
            "name": payload.get("name"),
            "picture": payload.get("picture"),
            "user_id": payload.get("sub")
        }
    return None

