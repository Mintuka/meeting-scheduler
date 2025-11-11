from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List

from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

from .google_calendar import dict_to_credentials


def _build_service(credentials_dict: Dict[str, Any]):
    creds = dict_to_credentials(credentials_dict)
    return build("calendar", "v3", credentials=creds, cache_discovery=False)


def list_events(credentials_dict: Dict[str, Any], time_min: datetime, time_max: datetime) -> List[Dict[str, Any]]:
    service = _build_service(credentials_dict)
    events_service = service.events()
    events: List[Dict[str, Any]] = []
    page_token = None
    while True:
        response = events_service.list(
            calendarId="primary",
            timeMin=time_min.isoformat(),
            timeMax=time_max.isoformat(),
            singleEvents=True,
            orderBy="startTime",
            pageToken=page_token,
        ).execute()
        events.extend(response.get("items", []))
        page_token = response.get("nextPageToken")
        if not page_token:
            break
    return events


def get_free_busy(credentials_dict: Dict[str, Any], time_min: datetime, time_max: datetime) -> List[Dict[str, Any]]:
    service = _build_service(credentials_dict)
    request = {
        "timeMin": time_min.isoformat(),
        "timeMax": time_max.isoformat(),
        "items": [{"id": "primary"}]
    }
    response = service.freebusy().query(body=request).execute()
    calendars = response.get("calendars", {})
    primary = calendars.get("primary") or {}
    return primary.get("busy", [])
