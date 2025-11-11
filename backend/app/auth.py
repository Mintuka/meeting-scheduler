from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional
import os

from fastapi import HTTPException, Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import jwt, JWTError

from .services import UserService

JWT_SECRET_KEY = os.getenv("JWT_SECRET_KEY", "change-me")
JWT_ALGORITHM = "HS256"
# Default to a 7-day session unless overridden via env (60 min * 24 hours * 7 days)
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", str(60 * 24 * 7)))


def create_access_token(data: Dict[str, Any], expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + (expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES))
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, JWT_SECRET_KEY, algorithm=JWT_ALGORITHM)


security = HTTPBearer(auto_error=False)


async def get_current_user_token(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    user_service: UserService = Depends(lambda: UserService())
):
    if credentials is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
    token = credentials.credentials
    try:
        payload = jwt.decode(token, JWT_SECRET_KEY, algorithms=[JWT_ALGORITHM])
        sub = payload.get("sub")
        if sub is None:
            raise HTTPException(status_code=401, detail="Invalid token")
    except JWTError as exc:
        raise HTTPException(status_code=401, detail="Invalid token") from exc

    user = await user_service.get_user_by_google_sub(sub)
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user


async def get_optional_user_token(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
    user_service: UserService = Depends(lambda: UserService())
):
    if credentials is None:
        return None
    token = credentials.credentials
    try:
        payload = jwt.decode(token, JWT_SECRET_KEY, algorithms=[JWT_ALGORITHM])
        sub = payload.get("sub")
        if sub is None:
            raise HTTPException(status_code=401, detail="Invalid token")
    except JWTError as exc:
        raise HTTPException(status_code=401, detail="Invalid token") from exc

    user = await user_service.get_user_by_google_sub(sub)
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user
