import smtplib
import ssl
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.mime.base import MIMEBase
from email import encoders
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional
import os
import logging
from jinja2 import Template
from .models import Meeting, Participant

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class EmailNotificationService:
    def __init__(self):
        # SMTP configuration
        self.smtp_server = os.getenv("SMTP_SERVER", "smtp.gmail.com")
        self.smtp_port = int(os.getenv("SMTP_PORT", "587"))
        self.smtp_username = os.getenv("SMTP_USERNAME")
        self.smtp_password = os.getenv("SMTP_PASSWORD")
        self.from_email = os.getenv("FROM_EMAIL", self.smtp_username or "noreply@example.com")
        self.app_name = os.getenv("APP_NAME", "Meeting Scheduler")
        
        if not self.smtp_username or not self.smtp_password:
            logger.warning("SMTP credentials not configured. Email notifications will not be sent.")
        
        # Email templates
        self.templates = {
            "meeting_invitation": self._get_meeting_invitation_template(),
            "meeting_reminder": self._get_meeting_reminder_template(),
            "meeting_update": self._get_meeting_update_template(),
            "meeting_cancellation": self._get_meeting_cancellation_template()
        }
        
        logger.info(f"Email service initialized using SMTP {self.smtp_server}:{self.smtp_port} with from_email: {self.from_email}")

    def _get_meeting_invitation_template(self) -> Template:
        return Template("""
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Meeting Invitation</title>
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #f8f9fa; padding: 20px; border-radius: 5px; margin-bottom: 20px; }
        .meeting-details { background: #e9ecef; padding: 15px; border-radius: 5px; margin: 20px 0; }
        .participants { margin: 20px 0; }
        .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #dee2e6; font-size: 12px; color: #6c757d; }
        .button { display: inline-block; padding: 10px 20px; background: #007bff; color: white; text-decoration: none; border-radius: 5px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h2>📅 Meeting Invitation</h2>
            <p>You have been invited to a meeting</p>
        </div>
        
        <h3>{{ meeting.title }}</h3>
        <p>{{ meeting.description }}</p>
        
        <div class="meeting-details">
            <h4>Meeting Details:</h4>
            <p><strong>Date:</strong> {{ meeting_date }}</p>
            <p><strong>Time:</strong> {{ meeting_time }}</p>
            <p><strong>Duration:</strong> {{ duration }} minutes</p>
            {% if meeting.metadata and meeting.metadata.meeting_url %}
            <p><strong>Join Link:</strong> <a class="button" href="{{ meeting.metadata.meeting_url }}">Join Google Meet</a></p>
            {% endif %}
        </div>
        
        <div class="participants">
            <h4>Participants:</h4>
            <ul>
            {% for participant in meeting.participants %}
                <li>{{ participant.name }} ({{ participant.email }})</li>
            {% endfor %}
            </ul>
        </div>
        
        <p>Please respond to this invitation to confirm your attendance.</p>
        
        <div class="footer">
            <p>This invitation was sent by {{ app_name }}</p>
            <p>If you have any questions, please contact the meeting organizer.</p>
        </div>
    </div>
</body>
</html>
        """)

    def _get_meeting_reminder_template(self) -> Template:
        return Template("""
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Meeting Reminder</title>
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #fff3cd; padding: 20px; border-radius: 5px; margin-bottom: 20px; }
        .meeting-details { background: #e9ecef; padding: 15px; border-radius: 5px; margin: 20px 0; }
        .reminder { background: #d1ecf1; padding: 15px; border-radius: 5px; margin: 20px 0; }
        .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #dee2e6; font-size: 12px; color: #6c757d; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h2>⏰ Meeting Reminder</h2>
            <p>Your meeting is coming up soon!</p>
        </div>
        
        <h3>{{ meeting.title }}</h3>
        <p>{{ meeting.description }}</p>
        
        <div class="meeting-details">
            <h4>Meeting Details:</h4>
            <p><strong>Date:</strong> {{ meeting_date }}</p>
            <p><strong>Time:</strong> {{ meeting_time }}</p>
            <p><strong>Duration:</strong> {{ duration }} minutes</p>
            {% if meeting.metadata and meeting.metadata.meeting_url %}
            <p><strong>Join Link:</strong> <a href="{{ meeting.metadata.meeting_url }}">Join Google Meet</a></p>
            {% endif %}
        </div>
        
        <div class="reminder">
            <h4>⏰ Reminder:</h4>
            <p>This meeting starts in {{ time_until_meeting }}.</p>
            <p>Please make sure you're prepared and join on time.</p>
        </div>
        
        <div class="footer">
            <p>This reminder was sent by {{ app_name }}</p>
        </div>
    </div>
</body>
</html>
        """)

    def _get_meeting_update_template(self) -> Template:
        return Template("""
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Meeting Update</title>
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #d4edda; padding: 20px; border-radius: 5px; margin-bottom: 20px; }
        .meeting-details { background: #e9ecef; padding: 15px; border-radius: 5px; margin: 20px 0; }
        .changes { background: #fff3cd; padding: 15px; border-radius: 5px; margin: 20px 0; }
        .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #dee2e6; font-size: 12px; color: #6c757d; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h2>📝 Meeting Update</h2>
            <p>Your meeting details have been updated</p>
        </div>
        
        <h3>{{ meeting.title }}</h3>
        <p>{{ meeting.description }}</p>
        
        <div class="meeting-details">
            <h4>Updated Meeting Details:</h4>
            <p><strong>Date:</strong> {{ meeting_date }}</p>
            <p><strong>Time:</strong> {{ meeting_time }}</p>
            <p><strong>Duration:</strong> {{ duration }} minutes</p>
            {% if meeting.metadata and meeting.metadata.meeting_url %}
            <p><strong>Join Link:</strong> <a href="{{ meeting.metadata.meeting_url }}">Join Google Meet</a></p>
            {% endif %}
        </div>
        
        <div class="changes">
            <h4>Changes Made:</h4>
            <p>{{ changes_description }}</p>
        </div>
        
        <div class="footer">
            <p>This update was sent by {{ app_name }}</p>
        </div>
    </div>
</body>
</html>
        """)

    def _get_meeting_cancellation_template(self) -> Template:
        return Template("""
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Meeting Cancelled</title>
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #f8d7da; padding: 20px; border-radius: 5px; margin-bottom: 20px; }
        .meeting-details { background: #e9ecef; padding: 15px; border-radius: 5px; margin: 20px 0; }
        .cancellation { background: #f8d7da; padding: 15px; border-radius: 5px; margin: 20px 0; }
        .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #dee2e6; font-size: 12px; color: #6c757d; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h2>❌ Meeting Cancelled</h2>
            <p>Your meeting has been cancelled</p>
        </div>
        
        <h3>{{ meeting.title }}</h3>
        <p>{{ meeting.description }}</p>
        
        <div class="meeting-details">
            <h4>Original Meeting Details:</h4>
            <p><strong>Date:</strong> {{ meeting_date }}</p>
            <p><strong>Time:</strong> {{ meeting_time }}</p>
            <p><strong>Duration:</strong> {{ duration }} minutes</p>
        </div>
        
        <div class="cancellation">
            <h4>❌ Cancellation Notice:</h4>
            <p>{{ cancellation_reason }}</p>
        </div>
        
        <div class="footer">
            <p>This cancellation notice was sent by {{ app_name }}</p>
        </div>
    </div>
</body>
</html>
        """)

    async def send_email(self, to_email: str, subject: str, html_content: str, text_content: str = None) -> bool:
        """Send an email using SMTP"""
        try:
            if not self.smtp_username or not self.smtp_password:
                logger.warning("SMTP credentials not configured. Skipping email send.")
                return False

            msg = MIMEMultipart('alternative')
            msg['Subject'] = subject
            msg['From'] = self.from_email
            msg['To'] = to_email

            # Add text and HTML parts
            if text_content:
                text_part = MIMEText(text_content, 'plain')
                msg.attach(text_part)
            
            html_part = MIMEText(html_content, 'html')
            msg.attach(html_part)

            # Create secure connection with server and send email
            context = ssl.create_default_context()
            with smtplib.SMTP(self.smtp_server, self.smtp_port) as server:
                server.starttls(context=context)
                server.login(self.smtp_username, self.smtp_password)
                server.send_message(msg)

            logger.info(f"Email sent successfully via SMTP to {to_email}")
            return True

        except Exception as e:
            logger.error(f"Failed to send email via SMTP to {to_email}: {str(e)}")
            return False

    async def send_meeting_invitation(self, meeting: Meeting, participant: Participant) -> bool:
        """Send meeting invitation to a participant"""
        try:
            meeting_date = meeting.start_time.strftime("%A, %B %d, %Y")
            meeting_time = f"{meeting.start_time.strftime('%I:%M %p')} - {meeting.end_time.strftime('%I:%M %p')}"
            
            html_content = self.templates["meeting_invitation"].render(
                meeting=meeting,
                meeting_date=meeting_date,
                meeting_time=meeting_time,
                duration=meeting.duration,
                app_name=self.app_name
            )
            
            # Include reply token for correlation in subject
            subject = f"[MS-{meeting.id}] Meeting Invitation: {meeting.title}"
            
            return await self.send_email(participant.email, subject, html_content)
            
        except Exception as e:
            logger.error(f"Failed to send meeting invitation: {str(e)}")
            return False

    async def send_meeting_reminder(self, meeting: Meeting, participant: Participant, hours_before: int = 1) -> bool:
        """Send meeting reminder to a participant"""
        try:
            meeting_date = meeting.start_time.strftime("%A, %B %d, %Y")
            meeting_time = f"{meeting.start_time.strftime('%I:%M %p')} - {meeting.end_time.strftime('%I:%M %p')}"
            
            # Calculate time until meeting
            now = datetime.utcnow()
            time_until = meeting.start_time - now
            hours = int(time_until.total_seconds() // 3600)
            minutes = int((time_until.total_seconds() % 3600) // 60)
            
            if hours > 0:
                time_until_meeting = f"{hours} hour{'s' if hours != 1 else ''}"
            else:
                time_until_meeting = f"{minutes} minute{'s' if minutes != 1 else ''}"
            
            html_content = self.templates["meeting_reminder"].render(
                meeting=meeting,
                meeting_date=meeting_date,
                meeting_time=meeting_time,
                duration=meeting.duration,
                time_until_meeting=time_until_meeting,
                app_name=self.app_name
            )
            
            subject = f"[MS-{meeting.id}] Reminder: {meeting.title} starts in {time_until_meeting}"
            
            return await self.send_email(participant.email, subject, html_content)
            
        except Exception as e:
            logger.error(f"Failed to send meeting reminder: {str(e)}")
            return False

    async def send_meeting_update(self, meeting: Meeting, participant: Participant, changes_description: str) -> bool:
        """Send meeting update notification to a participant"""
        try:
            meeting_date = meeting.start_time.strftime("%A, %B %d, %Y")
            meeting_time = f"{meeting.start_time.strftime('%I:%M %p')} - {meeting.end_time.strftime('%I:%M %p')}"
            
            html_content = self.templates["meeting_update"].render(
                meeting=meeting,
                meeting_date=meeting_date,
                meeting_time=meeting_time,
                duration=meeting.duration,
                changes_description=changes_description,
                app_name=self.app_name
            )
            
            subject = f"[MS-{meeting.id}] Meeting Updated: {meeting.title}"
            
            return await self.send_email(participant.email, subject, html_content)
            
        except Exception as e:
            logger.error(f"Failed to send meeting update: {str(e)}")
            return False

    async def send_meeting_cancellation(self, meeting: Meeting, participant: Participant, cancellation_reason: str) -> bool:
        """Send meeting cancellation notification to a participant"""
        try:
            meeting_date = meeting.start_time.strftime("%A, %B %d, %Y")
            meeting_time = f"{meeting.start_time.strftime('%I:%M %p')} - {meeting.end_time.strftime('%I:%M %p')}"
            
            html_content = self.templates["meeting_cancellation"].render(
                meeting=meeting,
                meeting_date=meeting_date,
                meeting_time=meeting_time,
                duration=meeting.duration,
                cancellation_reason=cancellation_reason,
                app_name=self.app_name
            )
            
            subject = f"[MS-{meeting.id}] Meeting Cancelled: {meeting.title}"
            
            return await self.send_email(participant.email, subject, html_content)
            
        except Exception as e:
            logger.error(f"Failed to send meeting cancellation: {str(e)}")
            return False

    async def send_bulk_invitations(self, meeting: Meeting) -> Dict[str, bool]:
        """Send invitations to all meeting participants"""
        results = {}
        for participant in meeting.participants:
            results[participant.email] = await self.send_meeting_invitation(meeting, participant)
        return results

    async def send_bulk_reminders(self, meeting: Meeting, hours_before: int = 1) -> Dict[str, bool]:
        """Send reminders to all meeting participants"""
        results = {}
        for participant in meeting.participants:
            results[participant.email] = await self.send_meeting_reminder(meeting, participant, hours_before)
        return results

# Global notification service instance
notification_service = EmailNotificationService()
