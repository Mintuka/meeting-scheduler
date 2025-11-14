import os
import json
import logging
from typing import Dict, Any, Optional, List
from datetime import datetime, timedelta
from dateutil import parser as date_parser
import httpx

logger = logging.getLogger(__name__)


class AIService:
    """Service for handling AI-powered conversational scheduling using LLM APIs."""

    def __init__(self):
        self.provider = os.getenv("AI_PROVIDER", "gemini").lower()
        self.api_key = os.getenv("AI_API_KEY") or os.getenv("GEMINI_API_KEY")
        self.model = os.getenv("AI_MODEL", "gemini-pro")
        self.base_url = os.getenv("AI_BASE_URL")  # For custom endpoints
        
        if not self.api_key:
            logger.warning("AI_API_KEY or GEMINI_API_KEY not configured. Conversational scheduling will be disabled.")
    
    async def parse_scheduling_request(
        self,
        user_message: str,
        user_email: str,
        user_timezone: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Parse a natural language scheduling request into structured meeting data.
        
        Returns a dictionary with:
        - title: str
        - description: str
        - participants: List[str] (email addresses)
        - start_time: Optional[datetime]
        - end_time: Optional[datetime]
        - duration_minutes: Optional[int]
        - preferred_date: Optional[datetime]
        - location_type: str ("online" or "onsite")
        - room_id: Optional[str]
        - metadata: Dict[str, Any]
        - requires_clarification: bool
        - clarification_message: Optional[str]
        """
        if not self.api_key:
            raise ValueError("AI service not configured. Please set AI_API_KEY environment variable.")
        
        try:
            if self.provider == "gemini":
                return await self._parse_with_gemini(user_message, user_email, user_timezone)
            elif self.provider == "openai":
                return await self._parse_with_openai(user_message, user_email, user_timezone)
            elif self.provider == "anthropic":
                return await self._parse_with_anthropic(user_message, user_email, user_timezone)
            else:
                raise ValueError(f"Unsupported AI provider: {self.provider}")
        except Exception as e:
            logger.error(f"Error parsing scheduling request: {e}")
            raise
    
    async def _parse_with_openai(
        self,
        user_message: str,
        user_email: str,
        user_timezone: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Parse using OpenAI API."""
        base_url = self.base_url or "https://api.openai.com/v1"
        
        system_prompt = self._get_system_prompt(user_timezone)
        
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_message}
        ]
        
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                f"{base_url}/chat/completions",
                headers={
                    "Authorization": f"Bearer {self.api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": self.model,
                    "messages": messages,
                    "temperature": 0.3,
                    "response_format": {"type": "json_object"},
                },
            )
            response.raise_for_status()
            result = response.json()
            
            content = result["choices"][0]["message"]["content"]
            parsed = json.loads(content)
            
            # Post-process the parsed data
            return self._post_process_parsed_data(parsed, user_timezone)
    
    async def _parse_with_gemini(
        self,
        user_message: str,
        user_email: str,
        user_timezone: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Parse using Google Gemini API."""
        base_url = self.base_url or f"https://generativelanguage.googleapis.com/v1/models/{self.model}:generateContent"
        
        system_prompt = self._get_system_prompt(user_timezone)
        full_prompt = f"{system_prompt}\n\nUser message: {user_message}\n\nPlease respond with only valid JSON matching the structure specified above."
        
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                f"{base_url}?key={self.api_key}",
                headers={
                    "Content-Type": "application/json",
                },
                json={
                    "contents": [{
                        "parts": [{
                            "text": full_prompt
                        }]
                    }],
                    "generationConfig": {
                        "temperature": 0.3,
                        "maxOutputTokens": 2000,
                    },
                },
            )
            response.raise_for_status()
            result = response.json()
            
            if "candidates" not in result or not result["candidates"]:
                raise ValueError("No response from Gemini API")
            
            content = result["candidates"][0]["content"]["parts"][0]["text"]
            # Extract JSON from response
            parsed = self._extract_json_from_text(content)
            
            # Post-process the parsed data
            return self._post_process_parsed_data(parsed, user_timezone)
    
    async def _parse_with_anthropic(
        self,
        user_message: str,
        user_email: str,
        user_timezone: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Parse using Anthropic Claude API."""
        base_url = self.base_url or "https://api.anthropic.com/v1"
        
        system_prompt = self._get_system_prompt(user_timezone)
        
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                f"{base_url}/messages",
                headers={
                    "x-api-key": self.api_key,
                    "anthropic-version": "2023-06-01",
                    "Content-Type": "application/json",
                },
                json={
                    "model": self.model,
                    "system": system_prompt,
                    "messages": [
                        {"role": "user", "content": user_message}
                    ],
                    "max_tokens": 2000,
                    "temperature": 0.3,
                },
            )
            response.raise_for_status()
            result = response.json()
            
            content = result["content"][0]["text"]
            # Anthropic doesn't enforce JSON mode, so we need to extract JSON
            parsed = self._extract_json_from_text(content)
            
            # Post-process the parsed data
            return self._post_process_parsed_data(parsed, user_timezone)
    
    def _get_system_prompt(self, user_timezone: Optional[str] = None) -> str:
        """Generate the system prompt for the LLM."""
        tz_info = f"User's timezone: {user_timezone or 'UTC'}. " if user_timezone else ""
        current_time = datetime.now().isoformat()
        
        return f"""You are an intelligent meeting scheduling assistant. Your job is to parse natural language meeting requests and extract structured information.

Current time: {current_time}
{tz_info}

Extract the following information from the user's message:
1. Meeting title (required)
2. Description (optional, can be empty string)
3. Participants (list of email addresses, required)
4. Start time (ISO 8601 format, optional if not specified)
5. End time (ISO 8601 format, optional if not specified)
6. Duration in minutes (optional, infer from start/end if provided)
7. Preferred date (ISO 8601 format, optional - use if user says "tomorrow", "next week", etc. but no specific time)
8. Location type: "online" or "onsite" (default: "online")
9. Room ID (optional, only if location_type is "onsite" and user specifies a room)

IMPORTANT RULES:
- If the user doesn't specify a time, set requires_clarification to true and provide a clarification_message
- If participants are mentioned by name but no email, try to infer email from name (name@example.com), but set requires_clarification to true
- If the user says "tomorrow", "next Monday", etc., calculate the actual date based on current time
- Duration should be in minutes (e.g., "30 minutes" = 30, "1 hour" = 60)
- If both start_time and end_time are provided, calculate duration automatically
- If only duration is provided, set requires_clarification to true asking for preferred time
- Always return valid JSON with all fields

Return a JSON object with this exact structure:
{{
    "title": "string",
    "description": "string",
    "participants": ["email1@example.com", "email2@example.com"],
    "start_time": "ISO8601 datetime or null",
    "end_time": "ISO8601 datetime or null",
    "duration_minutes": integer or null,
    "preferred_date": "ISO8601 date or null",
    "location_type": "online" or "onsite",
    "room_id": "string or null",
    "metadata": {{}},
    "requires_clarification": boolean,
    "clarification_message": "string or null"
}}"""
    
    def _extract_json_from_text(self, text: str) -> Dict[str, Any]:
        """Extract JSON from text that might contain markdown or extra text."""
        # Try to find JSON in code blocks
        import re
        json_match = re.search(r'```(?:json)?\s*(\{.*?\})\s*```', text, re.DOTALL)
        if json_match:
            return json.loads(json_match.group(1))
        
        # Try to find JSON object directly
        json_match = re.search(r'\{.*\}', text, re.DOTALL)
        if json_match:
            try:
                return json.loads(json_match.group(0))
            except json.JSONDecodeError:
                pass
        
        # Last resort: try parsing the whole text
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            logger.error(f"Failed to extract JSON from: {text}")
            raise ValueError("Failed to parse AI response as JSON")
    
    def _post_process_parsed_data(
        self,
        parsed: Dict[str, Any],
        user_timezone: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Post-process the parsed data to ensure consistency and handle timezones."""
        from zoneinfo import ZoneInfo
        from datetime import timezone as dt_timezone
        
        result = {
            "title": parsed.get("title", "").strip(),
            "description": parsed.get("description", "").strip(),
            "participants": parsed.get("participants", []),
            "start_time": None,
            "end_time": None,
            "duration_minutes": parsed.get("duration_minutes"),
            "preferred_date": None,
            "location_type": parsed.get("location_type", "online"),
            "room_id": parsed.get("room_id"),
            "metadata": parsed.get("metadata", {}),
            "requires_clarification": parsed.get("requires_clarification", False),
            "clarification_message": parsed.get("clarification_message"),
        }
        
        # Parse datetime strings
        tz = ZoneInfo(user_timezone) if user_timezone else dt_timezone.utc
        
        if parsed.get("start_time"):
            try:
                dt = date_parser.isoparse(parsed["start_time"])
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=tz)
                result["start_time"] = dt.astimezone(dt_timezone.utc)
            except Exception as e:
                logger.warning(f"Failed to parse start_time: {e}")
        
        if parsed.get("end_time"):
            try:
                dt = date_parser.isoparse(parsed["end_time"])
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=tz)
                result["end_time"] = dt.astimezone(dt_timezone.utc)
            except Exception as e:
                logger.warning(f"Failed to parse end_time: {e}")
        
        if parsed.get("preferred_date"):
            try:
                dt = date_parser.isoparse(parsed["preferred_date"])
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=tz)
                result["preferred_date"] = dt.astimezone(dt_timezone.utc)
            except Exception as e:
                logger.warning(f"Failed to parse preferred_date: {e}")
        
        # Calculate duration if start and end are provided
        if result["start_time"] and result["end_time"]:
            duration = (result["end_time"] - result["start_time"]).total_seconds() / 60
            result["duration_minutes"] = int(duration)
        
        # Validate required fields
        if not result["title"]:
            result["requires_clarification"] = True
            result["clarification_message"] = "Please provide a meeting title."
        
        if not result["participants"]:
            result["requires_clarification"] = True
            if not result["clarification_message"]:
                result["clarification_message"] = "Please specify at least one participant."
            else:
                result["clarification_message"] += " Also, please specify at least one participant."
        
        return result


# Global AI service instance
ai_service = AIService()

