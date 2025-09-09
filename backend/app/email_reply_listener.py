import asyncio
import email
import imaplib
import logging
import os
import re
from datetime import datetime
from typing import Optional, Tuple

from dateutil import parser as date_parser

logger = logging.getLogger(__name__)


class EmailReplyListener:
    """Simple IMAP IDLE-like poller to process email replies for actions."""

    def __init__(self, process_reply_callback):
        self.imap_server = os.getenv("IMAP_SERVER", "imap.gmail.com")
        self.imap_port = int(os.getenv("IMAP_PORT", "993"))
        self.username = os.getenv("SMTP_USERNAME")
        self.password = os.getenv("SMTP_PASSWORD")
        self._task: Optional[asyncio.Task] = None
        self._stop = asyncio.Event()
        self.process_reply_callback = process_reply_callback

        if not self.username or not self.password:
            logger.warning("IMAP credentials not configured; reply listener disabled.")

    async def start(self):
        if not self.username or not self.password:
            return
        if self._task is None or self._task.done():
            self._stop.clear()
            self._task = asyncio.create_task(self._run_loop())

    async def stop(self):
        if self._task and not self._task.done():
            self._stop.set()
            await self._task

    async def _run_loop(self):
        logger.info("Starting email reply listener loop")
        while not self._stop.is_set():
            try:
                await self._poll_once()
            except Exception as exc:
                logger.error(f"Reply listener error: {exc}")
            # Poll every 60 seconds
            try:
                await asyncio.wait_for(self._stop.wait(), timeout=60)
            except asyncio.TimeoutError:
                pass

    async def _poll_once(self):
        mail = imaplib.IMAP4_SSL(self.imap_server, self.imap_port)
        try:
            mail.login(self.username, self.password)
            mail.select('INBOX')

            # Search unseen emails that likely are replies to our messages
            status, data = mail.search(None, '(UNSEEN SUBJECT "[MS-")')
            if status != 'OK':
                return

            for num in data[0].split():
                status, msg_data = mail.fetch(num, '(RFC822)')
                if status != 'OK':
                    continue
                raw_email = msg_data[0][1]
                message = email.message_from_bytes(raw_email)

                subject = message.get('Subject', '')
                from_email = email.utils.parseaddr(message.get('From', ''))[1]
                meeting_id = self._extract_meeting_id(subject)
                action, action_payload = self._parse_action_from_body(message)

                if meeting_id and action:
                    try:
                        await self.process_reply_callback(meeting_id, from_email, action, action_payload)
                    except Exception as cb_exc:
                        logger.error(f"Failed processing reply callback: {cb_exc}")

                # Mark as seen
                mail.store(num, '+FLAGS', '\\Seen')
        finally:
            try:
                mail.logout()
            except Exception:
                pass

    def _extract_meeting_id(self, subject: str) -> Optional[str]:
        match = re.search(r"\[MS-([a-fA-F0-9\-]+)\]", subject)
        return match.group(1) if match else None

    def _parse_action_from_body(self, msg) -> Tuple[Optional[str], Optional[str]]:
        # Extract the first text/plain part
        body_text = None
        if msg.is_multipart():
            for part in msg.walk():
                content_type = part.get_content_type()
                content_disposition = str(part.get("Content-Disposition", ""))
                if content_type == 'text/plain' and 'attachment' not in content_disposition:
                    charset = part.get_content_charset() or 'utf-8'
                    body_text = part.get_payload(decode=True).decode(charset, errors='ignore')
                    break
        else:
            charset = msg.get_content_charset() or 'utf-8'
            body_text = msg.get_payload(decode=True).decode(charset, errors='ignore')

        if not body_text:
            return None, None

        text = body_text.strip().lower()
        # Very simple command parsing from email replies
        # Examples:
        #   accept
        #   decline
        #   reschedule: 2025-09-01 15:00
        #   reschedule to tomorrow 3pm
        if text.startswith('accept'):
            return 'accept', None
        if text.startswith('decline'):
            return 'decline', None
        if text.startswith('reschedule'):
            # Try to parse a datetime after the keyword
            candidate = text.replace('reschedule', '').replace('to', '').strip(': ').strip()
            try:
                dt = date_parser.parse(candidate, fuzzy=True)
                return 'reschedule', dt.isoformat()
            except Exception:
                return 'reschedule', candidate

        return None, None


