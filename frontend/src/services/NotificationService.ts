import { Meeting } from '../types';

export interface Notification {
  id: string;
  type: 'success' | 'error' | 'warning' | 'info';
  title: string;
  message: string;
  timestamp: Date;
  read: boolean;
  action?: {
    label: string;
    onClick: () => void;
  };
}

export interface MeetingNotification {
  meetingId: string;
  type: 'invitation' | 'reminder' | 'update' | 'cancellation';
  title: string;
  message: string;
  timestamp: Date;
}

class NotificationService {
  private notifications: Notification[] = [];
  private listeners: ((notifications: Notification[]) => void)[] = [];

  // Add a notification
  addNotification(notification: Omit<Notification, 'id' | 'timestamp' | 'read'>): string {
    const id = Math.random().toString(36).substr(2, 9);
    const newNotification: Notification = {
      ...notification,
      id,
      timestamp: new Date(),
      read: false,
    };

    this.notifications.unshift(newNotification);
    this.notifyListeners();
    
    // Auto-remove success notifications after 5 seconds
    if (notification.type === 'success') {
      setTimeout(() => {
        this.removeNotification(id);
      }, 5000);
    }

    return id;
  }

  // Remove a notification
  removeNotification(id: string): void {
    this.notifications = this.notifications.filter(n => n.id !== id);
    this.notifyListeners();
  }

  // Mark notification as read
  markAsRead(id: string): void {
    const notification = this.notifications.find(n => n.id === id);
    if (notification) {
      notification.read = true;
      this.notifyListeners();
    }
  }

  // Mark all notifications as read
  markAllAsRead(): void {
    this.notifications.forEach(n => n.read = true);
    this.notifyListeners();
  }

  // Get all notifications
  getNotifications(): Notification[] {
    return [...this.notifications];
  }

  // Get unread notifications count
  getUnreadCount(): number {
    return this.notifications.filter(n => !n.read).length;
  }

  // Subscribe to notification changes
  subscribe(listener: (notifications: Notification[]) => void): () => void {
    this.listeners.push(listener);
    listener(this.notifications); // Initial call

    // Return unsubscribe function
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  private notifyListeners(): void {
    this.listeners.forEach(listener => listener([...this.notifications]));
  }

  // Convenience methods for common notification types
  success(title: string, message: string, action?: Notification['action']): string {
    return this.addNotification({ type: 'success', title, message, action });
  }

  error(title: string, message: string, action?: Notification['action']): string {
    return this.addNotification({ type: 'error', title, message, action });
  }

  warning(title: string, message: string, action?: Notification['action']): string {
    return this.addNotification({ type: 'warning', title, message, action });
  }

  info(title: string, message: string, action?: Notification['action']): string {
    return this.addNotification({ type: 'info', title, message, action });
  }

  // Meeting-specific notification methods
  meetingInvitationSent(meeting: Meeting): string {
    return this.success(
      'Invitations Sent',
      `Meeting invitations sent to ${meeting.participants.length} participants for "${meeting.title}"`,
      {
        label: 'View Meeting',
        onClick: () => {
          // Navigate to meeting details
          window.location.href = `/meetings/${meeting.id}`;
        }
      }
    );
  }

  meetingReminderSent(meeting: Meeting): string {
    return this.success(
      'Reminders Sent',
      `Reminders sent to ${meeting.participants.length} participants for "${meeting.title}"`,
      {
        label: 'View Meeting',
        onClick: () => {
          window.location.href = `/meetings/${meeting.id}`;
        }
      }
    );
  }

  meetingUpdated(meeting: Meeting, changes: string): string {
    // Use success so it auto-dismisses after a short time
    return this.success(
      'Meeting Updated',
      `Meeting "${meeting.title}" has been updated: ${changes}`
    );
  }

  meetingCancelled(meeting: Meeting, reason: string): string {
    return this.warning(
      'Meeting Cancelled',
      `Meeting "${meeting.title}" has been cancelled: ${reason}`,
      {
        label: 'View Details',
        onClick: () => {
          window.location.href = `/meetings/${meeting.id}`;
        }
      }
    );
  }

  meetingCreated(meeting: Meeting): string {
    return this.success(
      'Meeting Created',
      `Meeting "${meeting.title}" has been successfully created`,
      {
        label: 'Send Invitations',
        onClick: () => {
          // This would trigger the invitation sending
          console.log('Send invitations for meeting:', meeting.id);
        }
      }
    );
  }

  meetingDeleted(meetingTitle: string): string {
    return this.info(
      'Meeting Deleted',
      `Meeting "${meetingTitle}" has been deleted`
    );
  }

  // Error notifications for common operations
  failedToSendInvitations(meeting: Meeting, error: string): string {
    return this.error(
      'Failed to Send Invitations',
      `Could not send invitations for "${meeting.title}": ${error}`,
      {
        label: 'Retry',
        onClick: () => {
          console.log('Retry sending invitations for meeting:', meeting.id);
        }
      }
    );
  }

  failedToCreateMeeting(error: string): string {
    return this.error(
      'Failed to Create Meeting',
      `Could not create meeting: ${error}`,
      {
        label: 'Try Again',
        onClick: () => {
          // This would typically reopen the form
          console.log('Retry creating meeting');
        }
      }
    );
  }

  // Clear all notifications
  clearAll(): void {
    this.notifications = [];
    this.notifyListeners();
  }

  // Clear notifications by type
  clearByType(type: Notification['type']): void {
    this.notifications = this.notifications.filter(n => n.type !== type);
    this.notifyListeners();
  }
}

// Export singleton instance
export const notificationService = new NotificationService();
