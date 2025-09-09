# Notification Service

This document describes the notification service implementation for the Meeting Scheduler application.

## Overview

The notification service provides both email notifications and real-time UI notifications for meeting-related events.

## Features

### Email Notifications
- **Meeting Invitations**: Send invitations to all participants when a meeting is created
- **Meeting Reminders**: Send reminders before meetings start
- **Meeting Updates**: Notify participants when meeting details change
- **Meeting Cancellations**: Inform participants when meetings are cancelled

### UI Notifications
- **Real-time notifications**: Instant feedback for user actions
- **Different types**: Success, error, warning, and info notifications
- **Auto-dismiss**: Success notifications automatically disappear after 5 seconds
- **Action buttons**: Notifications can include clickable actions
- **Read/unread status**: Track notification state

## Backend Implementation

### Email Service (`backend/app/notification_service.py`)

The `EmailNotificationService` class handles all email notifications:

```python
from app.notification_service import notification_service

# Send invitation to all participants
await notification_service.send_bulk_invitations(meeting)

# Send reminder to all participants
await notification_service.send_bulk_reminders(meeting, hours_before=1)

# Send update notification
await notification_service.send_meeting_update(meeting, participant, "Meeting time changed")

# Send cancellation notification
await notification_service.send_meeting_cancellation(meeting, participant, "Meeting cancelled due to conflict")
```

### Email Templates

The service includes professional HTML email templates for:
- Meeting invitations with meeting details and participant list
- Meeting reminders with countdown timer
- Meeting updates with change descriptions
- Meeting cancellations with reason

### API Endpoints

New notification endpoints have been added to `backend/main.py`:

- `POST /api/meetings/{meeting_id}/send-invitation` - Send invitations to all participants
- `POST /api/meetings/{meeting_id}/send-reminder` - Send reminders to all participants
- `POST /api/meetings/{meeting_id}/send-update` - Send update notifications
- `POST /api/meetings/{meeting_id}/send-cancellation` - Send cancellation notifications

## Frontend Implementation

### Notification Service (`frontend/src/services/NotificationService.ts`)

The `NotificationService` class manages UI notifications:

```typescript
import { notificationService } from '../services/NotificationService';

// Show success notification
notificationService.success('Meeting Created', 'Your meeting has been scheduled');

// Show error notification
notificationService.error('Error', 'Failed to create meeting');

// Meeting-specific notifications
notificationService.meetingCreated(meeting);
notificationService.meetingInvitationSent(meeting);
notificationService.meetingReminderSent(meeting);
notificationService.meetingUpdated(meeting, 'Time changed');
notificationService.meetingCancelled(meeting, 'Conflict detected');
```

### Notification Component (`frontend/src/components/NotificationComponent.tsx`)

A React component that displays notifications in the UI:

- **Positioning**: Configurable position (top-right, top-left, bottom-right, bottom-left)
- **Max notifications**: Limit the number of displayed notifications
- **Auto-dismiss**: Success notifications disappear automatically
- **Action buttons**: Clickable actions within notifications
- **Responsive design**: Works on mobile and desktop
- **Dark mode support**: Automatic dark mode detection

### Integration

The notification service is integrated into the main application:

1. **Dashboard**: Shows notifications for meeting operations
2. **MeetingList**: Includes buttons for sending invitations and reminders
3. **AISchedulerService**: Updated to use notification endpoints

## Configuration

### Email Configuration

Set up email notifications by configuring environment variables:

```bash
# Email settings
SMTP_SERVER=smtp.gmail.com
SMTP_PORT=587
SMTP_USERNAME=your-email@gmail.com
SMTP_PASSWORD=your-app-password
FROM_EMAIL=your-email@gmail.com
APP_NAME=Meeting Scheduler
```

**Note**: For Gmail, you need to:
1. Enable 2-Step Verification
2. Generate an App Password
3. Use the App Password instead of your regular password

### Dependencies

Add the required dependencies:

```bash
# Backend
pip install jinja2

# Frontend (already included)
npm install lucide-react
```

## Usage Examples

### Sending Meeting Invitations

```typescript
// Frontend
const handleCreateMeeting = async (formData) => {
  try {
    const meeting = await AISchedulerService.createMeeting(formData);
    await AISchedulerService.sendMeetingInvitation(meeting);
    notificationService.meetingInvitationSent(meeting);
  } catch (error) {
    notificationService.failedToSendInvitations(meeting, error.message);
  }
};
```

### Sending Reminders

```typescript
// Frontend
const handleSendReminder = async (meeting) => {
  try {
    await AISchedulerService.sendReminder(meeting.id);
    notificationService.meetingReminderSent(meeting);
  } catch (error) {
    notificationService.error('Reminder Error', 'Failed to send reminder');
  }
};
```

### Backend Email Sending

```python
# Backend
@app.post("/api/meetings/{meeting_id}/send-invitation")
async def send_invitation(meeting_id: str):
    meeting = await meeting_service.get_meeting(meeting_id)
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
    
    results = await notification_service.send_bulk_invitations(meeting)
    successful_sends = sum(1 for success in results.values() if success)
    
    return {
        "message": f"Invitations sent to {successful_sends}/{len(meeting.participants)} participants",
        "results": results
    }
```

## Customization

### Email Templates

You can customize email templates by modifying the template methods in `EmailNotificationService`:

```python
def _get_meeting_invitation_template(self) -> Template:
    return Template("""
    <!DOCTYPE html>
    <html>
    <head>
        <title>Meeting Invitation</title>
        <style>
            /* Your custom CSS */
        </style>
    </head>
    <body>
        <!-- Your custom HTML -->
    </body>
    </html>
    """)
```

### Notification Styling

Customize notification appearance by modifying `frontend/src/components/NotificationComponent.css`:

```css
.notification-success {
  border-left-color: #28a745;
  background: linear-gradient(135deg, #d4edda 0%, #c3e6cb 100%);
}

.notification-error {
  border-left-color: #dc3545;
  background: linear-gradient(135deg, #f8d7da 0%, #f5c6cb 100%);
}
```

## Testing

### Email Testing

For development, you can use services like:
- **Mailtrap**: For testing email delivery
- **Gmail SMTP**: For production use
- **SendGrid**: For high-volume email sending

### UI Testing

Test notifications by triggering different actions:
1. Create a meeting → Success notification
2. Send invitation → Success notification
3. Delete meeting → Info notification
4. Trigger error → Error notification

## Security Considerations

1. **SMTP Credentials**: Store email credentials securely using environment variables
2. **Rate Limiting**: Implement rate limiting for email sending endpoints
3. **Email Validation**: Validate email addresses before sending
4. **Content Security**: Sanitize email content to prevent injection attacks

## Future Enhancements

1. **Push Notifications**: Add browser push notifications
2. **SMS Notifications**: Integrate SMS service for urgent notifications
3. **Notification Preferences**: Allow users to configure notification settings
4. **Email Templates**: Add more email template options
5. **Scheduling**: Add scheduled reminder sending
6. **Analytics**: Track notification delivery and engagement
