import os
import json
import logging
import re
from typing import Dict, Any, Optional, List
from datetime import datetime, timedelta
from dateutil import parser as date_parser
import httpx
from zoneinfo import ZoneInfo
from datetime import timezone as dt_timezone

logger = logging.getLogger(__name__)


class ConversationalAIService:
    """Service for handling conversational AI that asks all meeting form questions."""

    def __init__(self):
        self.api_key = os.getenv("AI_API_KEY") or os.getenv("GEMINI_API_KEY")
        self.model = os.getenv("AI_MODEL", "gemini-pro")
        
        if not self.api_key:
            logger.warning("AI_API_KEY or GEMINI_API_KEY not configured. Conversational scheduling will be disabled.")
    
    async def process_message(
        self,
        user_message: str,
        conversation_history: List[Dict[str, str]],
        user_email: str,
        user_timezone: Optional[str] = None,
        collected_data: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """
        Process a user message in a conversational flow, asking questions one by one.
        
        Returns:
        - response_message: str - The AI's response/question
        - collected_data: Dict - The data collected so far
        - is_complete: bool - Whether all required information has been collected
        - meeting_data: Optional[Dict] - The final meeting data if complete
        """
        if not self.api_key:
            raise ValueError("AI service not configured. Please set AI_API_KEY or GEMINI_API_KEY environment variable.")
        
        if collected_data is None:
            collected_data = {}
        
        # Determine what information we still need
        required_fields = {
            "title": "What is the title of the meeting?",
            "description": "What is the description of the meeting?",
            "participants": "Who should attend this meeting? Please provide email addresses.",
            "preferredDate": "What date would you like to schedule this meeting?",
            "durationMinutes": "How long should the meeting be (in minutes)?",
            "locationType": "Should this be an online meeting (Google Meet) or onsite meeting?",
        }
        
        # Check what we have
        missing_fields = []
        for field, question in required_fields.items():
            if field not in collected_data or not collected_data[field]:
                missing_fields.append((field, question))
        
        # Try to extract data from user message FIRST, before calling AI
        # This helps prevent loops by capturing information immediately
        extracted_data = self._extract_data_from_response("", user_message)
        
        # If we're missing the first field and user message seems to answer it, extract more aggressively
        if missing_fields and len(missing_fields) > 0:
            first_missing_field = missing_fields[0][0]
            # If user message is short and doesn't contain other details, it's likely answering the first question
            if first_missing_field == "title" and not extracted_data.get("title"):
                # If message is short and doesn't look like other fields, treat as title
                if len(user_message.split()) < 15 and \
                   not re.search(r'\d+\s*(?:minutes?|hours?)', user_message.lower()) and \
                   '@' not in user_message and \
                   not re.search(r'\b(?:tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b', user_message.lower()):
                    extracted_data["title"] = user_message.strip()
            elif first_missing_field == "description" and not extracted_data.get("description"):
                # If message is longer, it might be a description
                if len(user_message.split()) > 10:
                    extracted_data["description"] = user_message.strip()
        
        # Merge extracted data with collected data BEFORE building prompt
        for key, value in extracted_data.items():
            if value is not None and value != "":
                collected_data[key] = value
        
        # Re-check missing fields after extraction
        missing_fields = []
        for field, question in required_fields.items():
            if field not in collected_data or not collected_data[field]:
                missing_fields.append((field, question))
        
        # Build conversation context
        system_prompt = self._build_system_prompt(user_email, user_timezone, collected_data, missing_fields)
        
        # Build conversation history for context
        conversation_context = conversation_history[-10:]  # Last 10 messages for context
        
        # Call Gemini API
        try:
            response = await self._call_gemini(system_prompt, user_message, conversation_context)
            
            # Try to extract structured data from the response again (in case AI mentioned something)
            additional_extracted = self._extract_data_from_response(response, user_message)
            
            # Merge any additional extracted data
            for key, value in additional_extracted.items():
                if value is not None and value != "":
                    collected_data[key] = value
            
            # Check if we have all required fields
            is_complete = all(
                field in collected_data and collected_data[field] 
                for field in required_fields.keys()
            )
            
            # If we have date and duration but not start/end time, we need to ask for time
            if is_complete and "startTime" not in collected_data and "preferredTime" not in collected_data:
                # Ask for the time
                response = response + "\n\nWhat time would you like to schedule this meeting? (e.g., '2pm', '10:00 AM', '14:30')"
                is_complete = False
            elif "preferredTime" in collected_data and "startTime" not in collected_data:
                # Try to parse the preferred time
                try:
                    time_str = str(collected_data["preferredTime"])
                    collected_data["startTime"] = time_str
                    # Remove preferredTime to avoid confusion
                    if "preferredTime" in collected_data:
                        del collected_data["preferredTime"]
                except:
                    pass
            
            # Prepare meeting data if complete
            meeting_data = None
            if is_complete and "startTime" in collected_data:
                meeting_data = self._prepare_meeting_data(collected_data, user_timezone)
            
            return {
                "response_message": response,
                "collected_data": collected_data,
                "is_complete": is_complete,
                "meeting_data": meeting_data,
            }
        except Exception as e:
            logger.error(f"Error processing conversational message: {e}", exc_info=True)
            return {
                "response_message": f"I encountered an error: {str(e)}. Could you please try again?",
                "collected_data": collected_data,
                "is_complete": False,
                "meeting_data": None,
            }
    
    def _build_system_prompt(
        self,
        user_email: str,
        user_timezone: Optional[str],
        collected_data: Dict[str, Any],
        missing_fields: List[tuple],
    ) -> str:
        """Build the system prompt for the conversational AI."""
        tz_info = f"User's timezone: {user_timezone or 'UTC'}. " if user_timezone else ""
        current_time = datetime.now().isoformat()
        
        collected_info = ""
        if collected_data:
            collected_info = "\n\nInformation collected so far:\n"
            for key, value in collected_data.items():
                collected_info += f"- {key}: {value}\n"
        
        missing_info = ""
        if missing_fields:
            missing_info = "\n\nInformation still needed:\n"
            for field, question in missing_fields:
                missing_info += f"- {field}: {question}\n"
        
        return f"""You are a friendly meeting scheduling assistant. Your job is to help users schedule meetings by asking questions one at a time in a natural, conversational way.

Current time: {current_time}
{tz_info}
User email: {user_email}

{collected_info}
{missing_info}

CRITICAL INSTRUCTIONS:
1. Be conversational and friendly
2. Ask ONE question at a time based on what's missing - start with the first missing field in this order: title, description, participants, preferredDate, durationMinutes, locationType, then time
3. When the user provides information, you MUST:
   - Acknowledge it clearly (e.g., "Got it! I've noted the title as '[title]'")
   - Immediately move to the next missing question
   - NEVER ask the same question again if the user has already provided the answer
4. Extract information from the user's CURRENT message:
   - If they provide a title, extract it (even if it's just a few words)
   - If they provide a description, extract it
   - If they provide participants (emails), extract them
   - If they provide a date, extract and convert it
   - If they provide a time, extract it
   - If they provide duration, extract and convert to minutes
   - If they mention location type, extract "online" or "onsite"
5. For dates: "tomorrow" = next day, "next Monday" = next Monday, "December 15th" = 2024-12-15
6. For times: "2pm", "10:00 AM", "14:00", "2:30 PM" - store as provided
7. For duration: "30 minutes" = 30, "1 hour" = 60, "2 hours" = 120
8. IMPORTANT: If the user's message contains information for a field that's missing, acknowledge it and mark it as collected, then ask the NEXT missing question. Do NOT ask about information the user has already provided.

When you have all the information, summarize the meeting details and ask: "Does this look correct? Should I schedule this meeting?"

Be concise and helpful. Don't ask multiple questions at once."""
    
    async def _call_gemini(
        self,
        system_prompt: str,
        user_message: str,
        conversation_history: List[Dict[str, str]],
    ) -> str:
        """Call the Gemini API."""
        # Use the correct Gemini API endpoint - try v1 first, fallback to v1beta
        base_url = f"https://generativelanguage.googleapis.com/v1/models/{self.model}:generateContent"
        
        # Build conversation context - Gemini API format
        contents = []
        
        # Add system instruction in the first user message
        system_user_message = f"{system_prompt}\n\nConversation history:\n"
        
        # Add conversation history
        for msg in conversation_history:
            role = msg.get("role", "user")
            content = msg.get("content", "")
            if role == "user":
                system_user_message += f"User: {content}\n"
            else:
                system_user_message += f"Assistant: {content}\n"
        
        system_user_message += f"\nCurrent user message: {user_message}"
        
        # Gemini API expects contents array with parts
        contents = [{
            "parts": [{"text": system_user_message}]
        }]
        
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                f"{base_url}?key={self.api_key}",
                headers={
                    "Content-Type": "application/json",
                },
                json={
                    "contents": contents,
                    "generationConfig": {
                        "temperature": 0.7,
                        "maxOutputTokens": 1000,
                    },
                },
            )
            if response.status_code != 200:
                try:
                    error_data = response.json()
                    error_msg = error_data.get("error", {}).get("message", f"HTTP {response.status_code}")
                except:
                    error_msg = f"HTTP {response.status_code}"
                logger.error(f"Gemini API error {response.status_code}: {error_msg}")
                raise ValueError(f"Gemini API returned {response.status_code}: {error_msg}")
            
            response.raise_for_status()
            result = response.json()
            
            if "candidates" not in result or not result["candidates"]:
                error_msg = result.get("error", {}).get("message", "No response from Gemini API")
                logger.error(f"Gemini API response error: {result}")
                raise ValueError(f"Gemini API error: {error_msg}")
            
            return result["candidates"][0]["content"]["parts"][0]["text"]
    
    def _extract_data_from_response(
        self,
        ai_response: str,
        user_message: str,
    ) -> Dict[str, Any]:
        """Try to extract structured data from the user's message."""
        extracted = {}
        user_msg_lower = user_message.lower()
        
        # Try to extract title - if the message is short and doesn't contain other meeting details, it's likely a title
        # Also look for patterns like "meeting about X", "call for Y", "schedule a meeting for X"
        if len(user_message.split()) < 20:  # Short messages are likely titles
            # Check if it doesn't contain other meeting details
            if not re.search(r'\d+\s*(?:minutes?|hours?|mins?|hrs?)', user_msg_lower) and \
               not re.search(r'\b\d{1,2}[:/]\d{2}\b|\b\d{1,2}\s*(?:am|pm)\b', user_msg_lower) and \
               not re.search(r'\b(?:tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|january|february|march|april|may|june|july|august|september|october|november|december)\b', user_msg_lower) and \
               '@' not in user_message:
                # Likely a title
                extracted["title"] = user_message.strip()
        
        # Try to extract title from patterns
        title_patterns = [
            r'(?:meeting|call|session|conference)\s+(?:about|for|on|regarding)\s+(.+)',
            r'schedule\s+(?:a\s+)?(?:meeting|call)\s+(?:about|for|on|regarding)?\s*(.+)',
            r'(.+?)\s+(?:meeting|call)',
        ]
        for pattern in title_patterns:
            match = re.search(pattern, user_message, re.IGNORECASE)
            if match:
                potential_title = match.group(1).strip()
                # Clean up common phrases
                potential_title = re.sub(r'^(?:a|an|the)\s+', '', potential_title, flags=re.IGNORECASE)
                if len(potential_title) > 3 and len(potential_title) < 100:
                    extracted["title"] = potential_title
                    break
        
        # Try to extract description - longer messages might be descriptions
        if len(user_message.split()) > 15 and "description" not in extracted:
            # Check if it contains meeting details that suggest it's a description
            if re.search(r'\b(?:discuss|review|plan|meet|talk|about)\b', user_msg_lower):
                extracted["description"] = user_message.strip()
        
        # Try to extract participants (email addresses)
        email_pattern = r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b'
        emails = re.findall(email_pattern, user_message)
        if emails:
            extracted["participants"] = emails
        
        # Try to extract date
        date_patterns = [
            (r'\b(tomorrow)\b', lambda: (datetime.now() + timedelta(days=1)).strftime('%Y-%m-%d')),
            (r'\b(today)\b', lambda: datetime.now().strftime('%Y-%m-%d')),
            (r'\bnext\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b', lambda m: self._get_next_weekday(m.group(1))),
            (r'\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})(?:st|nd|rd|th)?', lambda m: self._parse_month_day(m.group(1), m.group(2))),
            (r'\b(\d{4})-(\d{1,2})-(\d{1,2})\b', lambda m: f"{m.group(1)}-{m.group(2).zfill(2)}-{m.group(3).zfill(2)}"),
        ]
        for pattern, converter in date_patterns:
            match = re.search(pattern, user_msg_lower)
            if match:
                try:
                    if callable(converter):
                        if pattern.startswith(r'\b(tomorrow)'):
                            extracted["preferredDate"] = converter()
                        elif pattern.startswith(r'\b(today)'):
                            extracted["preferredDate"] = converter()
                        else:
                            extracted["preferredDate"] = converter(match)
                    else:
                        extracted["preferredDate"] = converter
                except:
                    pass
                break
        
        # Try to extract time
        time_patterns = [
            (r'\b(\d{1,2}):(\d{2})\s*(am|pm)\b', lambda m: f"{int(m.group(1)) + (12 if m.group(3).lower() == 'pm' and int(m.group(1)) != 12 else (-12 if m.group(3).lower() == 'am' and int(m.group(1)) == 12 else 0))}:{m.group(2)}"),
            (r'\b(\d{1,2})\s*(am|pm)\b', lambda m: f"{int(m.group(1)) + (12 if m.group(2).lower() == 'pm' and int(m.group(1)) != 12 else (-12 if m.group(2).lower() == 'am' and int(m.group(1)) == 12 else 0))}:00"),
            (r'\b(\d{1,2}):(\d{2})\b', lambda m: f"{m.group(1)}:{m.group(2)}"),
        ]
        for pattern, converter in time_patterns:
            match = re.search(pattern, user_msg_lower)
            if match:
                try:
                    extracted["startTime"] = converter(match)
                except:
                    pass
                break
        
        # Try to extract duration
        duration_patterns = [
            (r'(\d+)\s*(?:minutes?|mins?|min)\b', lambda m: int(m.group(1))),
            (r'(\d+)\s*(?:hours?|hrs?|h)\b', lambda m: int(m.group(1)) * 60),
            (r'(\d+)\s*(?:hour|hr)\b', lambda m: int(m.group(1)) * 60),
        ]
        for pattern, converter in duration_patterns:
            match = re.search(pattern, user_msg_lower)
            if match:
                extracted["durationMinutes"] = converter(match)
                break
        
        # Try to extract location type
        if re.search(r'\bonline\b|\bgoogle meet\b|\bvideo call\b|\bzoom\b|\bvirtual\b', user_msg_lower):
            extracted["locationType"] = "online"
        elif re.search(r'\bonsite\b|\bin person\b|\bphysical\b|\broom\b|\boffice\b', user_msg_lower):
            extracted["locationType"] = "onsite"
        
        return extracted
    
    def _get_next_weekday(self, weekday_name: str) -> str:
        """Get the date of the next occurrence of a weekday."""
        weekdays = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
        target_day = weekdays.index(weekday_name.lower())
        today = datetime.now()
        days_ahead = target_day - today.weekday()
        if days_ahead <= 0:
            days_ahead += 7
        return (today + timedelta(days=days_ahead)).strftime('%Y-%m-%d')
    
    def _parse_month_day(self, month_name: str, day: str) -> str:
        """Parse a month name and day into a date string."""
        months = {
            'january': 1, 'february': 2, 'march': 3, 'april': 4, 'may': 5, 'june': 6,
            'july': 7, 'august': 8, 'september': 9, 'october': 10, 'november': 11, 'december': 12
        }
        month_num = months.get(month_name.lower(), datetime.now().month)
        year = datetime.now().year
        try:
            return f"{year}-{month_num:02d}-{int(day):02d}"
        except:
            return datetime.now().strftime('%Y-%m-%d')
    
    def _prepare_meeting_data(
        self,
        collected_data: Dict[str, Any],
        user_timezone: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Prepare the final meeting data structure."""
        tz = ZoneInfo(user_timezone) if user_timezone else dt_timezone.utc
        
        # Parse date
        preferred_date = None
        if "preferredDate" in collected_data:
            try:
                preferred_date = date_parser.parse(collected_data["preferredDate"])
                if preferred_date.tzinfo is None:
                    preferred_date = preferred_date.replace(tzinfo=tz)
            except:
                pass
        
        # Parse time
        start_time = None
        end_time = None
        duration_minutes = collected_data.get("durationMinutes", 60)
        
        if "startTime" in collected_data and preferred_date:
            try:
                # Try to parse the time
                time_str = str(collected_data["startTime"]).strip()
                
                # Try using dateutil parser first (handles most formats)
                try:
                    # Combine date string and time string
                    date_str = preferred_date.strftime("%Y-%m-%d")
                    combined_str = f"{date_str} {time_str}"
                    parsed_dt = date_parser.parse(combined_str, default=preferred_date)
                    if parsed_dt.tzinfo is None:
                        parsed_dt = parsed_dt.replace(tzinfo=tz)
                    start_time = parsed_dt
                except:
                    # Fallback to manual parsing
                    # Handle formats like "2pm", "14:00", "10:00 AM"
                    if ":" in time_str:
                        parts = time_str.split(":")
                        hour_str = parts[0].strip()
                        minute_str = parts[1].strip()
                        # Remove AM/PM from minute string if present
                        minute_str = re.sub(r'[^\d]', '', minute_str)
                        hour = int(re.sub(r'[^\d]', '', hour_str))
                        minute = int(minute_str) if minute_str else 0
                        
                        # Handle AM/PM
                        if "PM" in time_str.upper() and hour < 12:
                            hour += 12
                        if "AM" in time_str.upper() and hour == 12:
                            hour = 0
                        
                        start_time = preferred_date.replace(hour=hour, minute=minute, second=0, microsecond=0)
                    else:
                        # Try to parse as hour only
                        hour_str = re.sub(r'[^\d]', '', time_str)
                        if hour_str:
                            hour = int(hour_str)
                            if "PM" in time_str.upper() and hour < 12:
                                hour += 12
                            if "AM" in time_str.upper() and hour == 12:
                                hour = 0
                            start_time = preferred_date.replace(hour=hour, minute=0, second=0, microsecond=0)
                
                if start_time:
                    end_time = start_time + timedelta(minutes=duration_minutes)
            except Exception as e:
                logger.warning(f"Failed to parse time: {e}")
        
        return {
            "title": collected_data.get("title", ""),
            "description": collected_data.get("description", ""),
            "participants": collected_data.get("participants", []),
            "start_time": start_time.astimezone(dt_timezone.utc).isoformat() if start_time else None,
            "end_time": end_time.astimezone(dt_timezone.utc).isoformat() if end_time else None,
            "duration_minutes": duration_minutes,
            "preferred_date": preferred_date.astimezone(dt_timezone.utc).isoformat() if preferred_date else None,
            "location_type": collected_data.get("locationType", "online"),
            "room_id": collected_data.get("roomId"),
        }


# Global conversational AI service instance
conversational_ai_service = ConversationalAIService()

