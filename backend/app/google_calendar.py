from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Optional
import os
from uuid import uuid4
from datetime import datetime

from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from google_auth_oauthlib.flow import Flow


SCOPES = [
    "https://www.googleapis.com/auth/calendar.events",
]


def _client_config_from_env() -> Dict[str, Any]:
    client_id = os.getenv("GOOGLE_CLIENT_ID")
    client_secret = os.getenv("GOOGLE_CLIENT_SECRET")
    redirect_uri = os.getenv("GOOGLE_REDIRECT_URI")
    if not client_id or not client_secret or not redirect_uri:
        raise RuntimeError("Google OAuth env vars not configured: GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI")
    return {
        "web": {
            "client_id": client_id,
            "project_id": os.getenv("GOOGLE_PROJECT_ID", "meeting-scheduler"),
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
            "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
            "client_secret": client_secret,
            "redirect_uris": [redirect_uri],
        }
    }


def generate_auth_url(state: Optional[str] = None) -> str:
    flow = Flow.from_client_config(_client_config_from_env(), scopes=SCOPES)
    flow.redirect_uri = os.getenv("GOOGLE_REDIRECT_URI")
    # Note: Exclude include_granted_scopes to avoid Google rejecting 'True' value.
    auth_url, _ = flow.authorization_url(
        access_type="offline",
        prompt="consent",
        state=state,
    )
    return auth_url


def exchange_code_for_tokens(code: str) -> Dict[str, Any]:
    flow = Flow.from_client_config(_client_config_from_env(), scopes=SCOPES)
    flow.redirect_uri = os.getenv("GOOGLE_REDIRECT_URI")
    flow.fetch_token(code=code)
    creds = flow.credentials
    return credentials_to_dict(creds)


def credentials_to_dict(creds: Credentials) -> Dict[str, Any]:
    return {
        "token": creds.token,
        "refresh_token": creds.refresh_token,
        "token_uri": creds.token_uri,
        "client_id": creds.client_id,
        "client_secret": creds.client_secret,
        "scopes": list(creds.scopes or SCOPES),
        "expiry": creds.expiry.isoformat() if creds.expiry else None,
    }


def dict_to_credentials(data: Dict[str, Any]) -> Credentials:
    return Credentials(
        token=data.get("token"),
        refresh_token=data.get("refresh_token"),
        token_uri=data.get("token_uri", "https://oauth2.googleapis.com/token"),
        client_id=data.get("client_id"),
        client_secret=data.get("client_secret"),
        scopes=data.get("scopes", SCOPES),
    )


@dataclass
class CreatedEvent:
    event_id: str
    html_link: Optional[str]
    meet_url: Optional[str]


def create_event_with_meet(
    creds_dict: Dict[str, Any],
    *,
    title: str,
    description: str,
    start_time: datetime,
    end_time: datetime,
    attendees: List[str],
    timezone: str = "UTC",
    send_updates: str = "all",
) -> CreatedEvent:
    creds = dict_to_credentials(creds_dict)
    service = build("calendar", "v3", credentials=creds)

    body = {
        "summary": title,
        "description": description,
        "start": {"dateTime": start_time.isoformat(), "timeZone": timezone},
        "end": {"dateTime": end_time.isoformat(), "timeZone": timezone},
        "attendees": [{"email": e} for e in attendees],
        "conferenceData": {
            "createRequest": {
                "requestId": str(uuid4()),
                "conferenceSolutionKey": {"type": "hangoutsMeet"},
            }
        },
    }

    created = (
        service.events()
        .insert(
            calendarId="primary",
            body=body,
            conferenceDataVersion=1,
            sendUpdates=send_updates,
        )
        .execute()
    )

    entry_points = created.get("conferenceData", {}).get("entryPoints", [])
    meet_url = next((e.get("uri") for e in entry_points if e.get("entryPointType") == "video"), None)
    meet_url = meet_url or created.get("hangoutLink")

    return CreatedEvent(
        event_id=created.get("id"),
        html_link=created.get("htmlLink"),
        meet_url=meet_url,
    )


def update_event_attendees(
    creds_dict: Dict[str, Any],
    *,
    event_id: str,
    attendees: List[str],
    send_updates: str = "all",
) -> Dict[str, Any]:
    """Update attendees for an existing Google Calendar event.

    Returns the updated event resource.
    """
    creds = dict_to_credentials(creds_dict)
    service = build("calendar", "v3", credentials=creds)

    body = {"attendees": [{"email": e} for e in attendees]}
    updated = (
        service.events()
        .patch(
            calendarId="primary",
            eventId=event_id,
            body=body,
            sendUpdates=send_updates,
        )
        .execute()
    )
    return updated


def update_event(
    creds_dict: Dict[str, Any],
    *,
    event_id: str,
    title: Optional[str] = None,
    description: Optional[str] = None,
    start_time: Optional[datetime] = None,
    end_time: Optional[datetime] = None,
    timezone: str = "UTC",
    attendees: Optional[List[str]] = None,
    send_updates: str = "all",
) -> Dict[str, Any]:
    """Patch an existing Google Calendar event with provided fields."""
    creds = dict_to_credentials(creds_dict)
    service = build("calendar", "v3", credentials=creds)

    body: Dict[str, Any] = {}
    if title is not None:
        body["summary"] = title
    if description is not None:
        body["description"] = description
    if start_time is not None:
        body.setdefault("start", {})["dateTime"] = start_time.isoformat()
        body["start"]["timeZone"] = timezone
    if end_time is not None:
        body.setdefault("end", {})["dateTime"] = end_time.isoformat()
        body["end"]["timeZone"] = timezone
    if attendees is not None:
        body["attendees"] = [{"email": e} for e in attendees]

    if not body:
        return service.events().get(calendarId="primary", eventId=event_id).execute()

    updated = (
        service.events()
        .patch(
            calendarId="primary",
            eventId=event_id,
            body=body,
            sendUpdates=send_updates,
        )
        .execute()
    )
    return updated
