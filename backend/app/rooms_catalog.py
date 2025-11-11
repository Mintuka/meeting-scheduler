from __future__ import annotations

from typing import Any, Dict, List, Optional

ROOMS_CATALOG: List[Dict[str, Any]] = [
    {
        "id": "atlas-huddle",
        "name": "Atlas Huddle Room",
        "capacity": 4,
        "location": "HQ · 5th Floor · West Wing",
        "features": ["Whiteboard", "4K Display", "Video conferencing"],
        "notes": "Great for quick stand-ups or pairing sessions.",
    },
    {
        "id": "orion-boardroom",
        "name": "Orion Boardroom",
        "capacity": 12,
        "location": "HQ · 8th Floor · Executive Suite",
        "features": ["Dual displays", "Poly conference bar", "Speakerphone", "Glass wall"],
        "notes": "Best for leadership reviews and client presentations.",
    },
    {
        "id": "luna-lab",
        "name": "Luna Collaboration Lab",
        "capacity": 8,
        "location": "Innovation Hub · 2nd Floor",
        "features": ["Interactive display", "Ceiling mics", "Floor-to-ceiling whiteboards"],
        "notes": "Optimized for design sprints and workshops.",
    },
    {
        "id": "terra-forum",
        "name": "Terra Forum",
        "capacity": 20,
        "location": "HQ · 1st Floor · Event Center",
        "features": ["Stage lighting", "Motorized shades", "Wireless presentation", "Assistive listening"],
        "notes": "Ideal for all-hands, training, or customer demos.",
    },
    {
        "id": "nova-focus",
        "name": "Nova Focus Room",
        "capacity": 2,
        "location": "HQ · 6th Floor · Quiet Zone",
        "features": ["Acoustic panels", "27\" display"],
        "notes": "Perfect for interviews or private syncs.",
    },
]


def list_rooms() -> List[Dict[str, Any]]:
    return ROOMS_CATALOG


def get_room_by_id(room_id: str) -> Optional[Dict[str, Any]]:
    for room in ROOMS_CATALOG:
        if room["id"] == room_id:
            return room
    return None
