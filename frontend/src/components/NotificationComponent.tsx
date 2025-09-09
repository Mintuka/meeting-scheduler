import React, { useEffect, useState } from 'react';
import { notificationService, Notification } from '../services/NotificationService';
import './NotificationComponent.css';

interface NotificationComponentProps {
  position?: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left';
  maxNotifications?: number;
}

export const NotificationComponent: React.FC<NotificationComponentProps> = ({
  position = 'top-right',
  maxNotifications = 5
}) => {
  const [notifications, setNotifications] = useState<Notification[]>([]);

  useEffect(() => {
    const unsubscribe = notificationService.subscribe(setNotifications);
    return unsubscribe;
  }, []);

  const handleRemove = (id: string) => {
    notificationService.removeNotification(id);
  };

  const handleMarkAsRead = (id: string) => {
    notificationService.markAsRead(id);
  };

  const handleAction = (notification: Notification) => {
    if (notification.action) {
      notification.action.onClick();
      handleRemove(notification.id);
    }
  };

  const getNotificationIcon = (type: Notification['type']) => {
    switch (type) {
      case 'success':
        return '✅';
      case 'error':
        return '❌';
      case 'warning':
        return '⚠️';
      case 'info':
        return 'ℹ️';
      default:
        return '📢';
    }
  };

  const getNotificationClass = (type: Notification['type']) => {
    return `notification notification-${type}`;
  };

  const formatTime = (timestamp: Date) => {
    const now = new Date();
    const diff = now.getTime() - timestamp.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return `${days}d ago`;
  };

  const displayedNotifications = notifications.slice(0, maxNotifications);

  return (
    <div className={`notification-container notification-${position}`}>
      {displayedNotifications.map((notification) => (
        <div
          key={notification.id}
          className={`${getNotificationClass(notification.type)} ${notification.read ? 'read' : 'unread'}`}
          onClick={() => handleMarkAsRead(notification.id)}
        >
          <div className="notification-header">
            <span className="notification-icon">
              {getNotificationIcon(notification.type)}
            </span>
            <span className="notification-title">{notification.title}</span>
            <button
              className="notification-close"
              onClick={(e) => {
                e.stopPropagation();
                handleRemove(notification.id);
              }}
            >
              ×
            </button>
          </div>
          
          <div className="notification-message">
            {notification.message}
          </div>
          
          <div className="notification-footer">
            <span className="notification-time">
              {formatTime(notification.timestamp)}
            </span>
            
            {notification.action && (
              <button
                className="notification-action"
                onClick={(e) => {
                  e.stopPropagation();
                  handleAction(notification);
                }}
              >
                {notification.action.label}
              </button>
            )}
          </div>
        </div>
      ))}
      
      {notifications.length > maxNotifications && (
        <div className="notification-more">
          <button
            className="notification-more-btn"
            onClick={() => notificationService.markAllAsRead()}
          >
            Mark all as read ({notifications.length - maxNotifications} more)
          </button>
        </div>
      )}
    </div>
  );
};

export default NotificationComponent;
