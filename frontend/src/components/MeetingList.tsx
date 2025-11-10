import React, { useState } from 'react';
import { Calendar, Clock, Users, Mail, Edit, Trash2, RefreshCw, Bell, MapPin, Video, ListChecks } from 'lucide-react';
import { Meeting } from '../types';
import { AISchedulerService } from '../services/AISchedulerService';
import { notificationService } from '../services/NotificationService';
import {
  formatDateOnly,
  formatTimeOnly,
  getMeetingTimeZone,
  getTimeZoneAbbreviation,
} from '../utils/timezone';

interface MeetingListProps {
  meetings: Meeting[];
  onMeetingUpdated: (meeting: Meeting, message?: string) => void;
  onMeetingDeleted: (meetingId: string) => void;
  onEditMeeting?: (meeting: Meeting) => void;
  currentTime: Date;
}

export const MeetingList: React.FC<MeetingListProps> = ({
  meetings,
  onMeetingUpdated,
  onMeetingDeleted,
  onEditMeeting,
  currentTime
}) => {
  const [reschedulingMeeting, setReschedulingMeeting] = useState<string | null>(null);

  const computeStatus = (meeting: Meeting): Meeting['status'] => {
    if (meeting.status === 'cancelled') return 'cancelled';
    if (meeting.startTime <= currentTime && meeting.endTime > currentTime) return 'running';
    if (meeting.endTime <= currentTime) return 'completed';
    if (meeting.status === 'rescheduled') return 'rescheduled';
    return meeting.status;
  };

  const handleReschedule = async (meeting: Meeting) => {
    setReschedulingMeeting(meeting.id);
    try {
      const newTimeSlot = {
        start: new Date(meeting.startTime.getTime() + 24 * 60 * 60 * 1000),
        end: new Date(meeting.endTime.getTime() + 24 * 60 * 60 * 1000),
        isAvailable: true
      };
      
      const updatedMeeting = await AISchedulerService.rescheduleMeeting(meeting, newTimeSlot);
      onMeetingUpdated(updatedMeeting, 'Meeting has been rescheduled to tomorrow');
    } catch (error) {
      console.error('Error rescheduling meeting:', error);
      notificationService.error('Reschedule Error', 'Failed to reschedule meeting');
    } finally {
      setReschedulingMeeting(null);
    }
  };

  const handleSendReminder = async (meeting: Meeting) => {
    try {
      await AISchedulerService.sendReminder(meeting.id);
      notificationService.meetingReminderSent(meeting);
    } catch (error) {
      console.error('Error sending reminder:', error);
      notificationService.error('Reminder Error', 'Failed to send reminder');
    }
  };

  const handleSendInvitation = async (meeting: Meeting) => {
    try {
      await AISchedulerService.sendMeetingInvitation(meeting);
      notificationService.meetingInvitationSent(meeting);
    } catch (error) {
      console.error('Error sending invitation:', error);
      notificationService.failedToSendInvitations(meeting, 'Failed to send invitations');
    }
  };

  const getStatusColor = (status: Meeting['status']) => {
    switch (status) {
      case 'scheduled':
        return 'bg-blue-100 text-blue-800';
      case 'confirmed':
        return 'bg-green-100 text-green-800';
      case 'cancelled':
        return 'bg-red-100 text-red-800';
      case 'rescheduled':
        return 'bg-yellow-100 text-yellow-800';
      case 'polling':
        return 'bg-orange-100 text-orange-800';
      case 'running':
        return 'bg-purple-100 text-purple-800';
      case 'completed':
        return 'bg-gray-200 text-gray-700';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  if (meetings.length === 0) {
    return (
      <div className="text-center py-12">
        <Calendar className="h-12 w-12 text-gray-400 mx-auto mb-4" />
        <h3 className="text-lg font-medium text-gray-900 mb-2">No meetings scheduled</h3>
        <p className="text-gray-500">Create your first meeting to get started</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold text-gray-900 mb-4">Scheduled Meetings</h2>
      {meetings.map((meeting) => {
        const effectiveStatus = computeStatus(meeting);
        const isCompleted = effectiveStatus === 'completed';
        const locationType = (meeting.metadata?.location_type as 'online' | 'onsite') || 'online';
        const isOnsite = locationType === 'onsite';
        const locationLabel = isOnsite ? (meeting.metadata?.room_name || 'Onsite room') : 'Google Meet';
        const locationSubtext = isOnsite
          ? meeting.metadata?.room_location || 'Office'
          : meeting.metadata?.meeting_url
          ? 'Link ready'
          : 'Link shared via invitation';
        const pollId = meeting.metadata?.poll_id;
        const meetingTimeZone = getMeetingTimeZone(meeting);
        const dateLabel = formatDateOnly(meeting.startTime, meetingTimeZone);
        const startLabel = formatTimeOnly(meeting.startTime, meetingTimeZone);
        const endLabel = formatTimeOnly(meeting.endTime, meetingTimeZone);
        const tzAbbrev = getTimeZoneAbbreviation(meeting.startTime, meetingTimeZone);
        const isPolling = Boolean(meeting.metadata?.poll_pending) || effectiveStatus === 'polling';
        return (
        <div key={meeting.id} className="bg-white rounded-lg shadow-md p-6 border border-gray-200">
          <div className="flex justify-between items-start mb-4">
            <div>
              <h3 className="text-lg font-semibold text-gray-900 mb-1">{meeting.title}</h3>
              <p className="text-gray-600 text-sm mb-2">{meeting.description}</p>
              <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getStatusColor(effectiveStatus)}`}>
                {effectiveStatus.charAt(0).toUpperCase() + effectiveStatus.slice(1)}
              </span>
              <span
                className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ml-2 ${
                  isOnsite ? 'bg-amber-100 text-amber-800' : 'bg-blue-100 text-blue-800'
                }`}
              >
                {isOnsite ? <MapPin className="h-3 w-3 mr-1" /> : <Video className="h-3 w-3 mr-1" />}
                {locationLabel}
              </span>
              {isPolling && (
                <span className="block text-xs text-orange-700 mt-1">
                  Awaiting poll responses
                </span>
              )}
            </div>
            <div className="flex space-x-2">
              <button onClick={() => handleSendInvitation(meeting)} className="p-2 text-green-600 hover:bg-green-50 rounded-md" title="Send Invitation">
                <Mail className="h-4 w-4" />
              </button>
              <button onClick={() => handleSendReminder(meeting)} className="p-2 text-blue-600 hover:bg-blue-50 rounded-md" title="Send Reminder">
                <Bell className="h-4 w-4" />
              </button>
              <button onClick={() => handleReschedule(meeting)} disabled={reschedulingMeeting === meeting.id} className="p-2 text-blue-600 hover:bg-blue-50 rounded-md disabled:opacity-50" title="Reschedule">
                {reschedulingMeeting === meeting.id ? (
                  <RefreshCw className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
              </button>
              <div className="relative group">
                <button
                  onClick={() => {
                    if (isCompleted || !onEditMeeting) return;
                    onEditMeeting(meeting);
                  }}
                  disabled={isCompleted}
                  className={`p-2 text-gray-700 rounded-md ${isCompleted ? 'opacity-50 cursor-not-allowed' : 'hover:bg-gray-100'}`}
                  title={isCompleted ? 'Completed meetings cannot be edited' : 'Edit Meeting'}
                >
                  <Edit className="h-4 w-4" />
                </button>
                {isCompleted && (
                  <div className="absolute -top-10 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md bg-gray-800 text-white text-xs px-2 py-1 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none shadow-lg">
                    Completed meetings can’t be edited
                  </div>
                )}
              </div>
              {pollId && (
                <button
                  onClick={() => window.open(`/poll/${pollId}`, '_blank', 'noopener')}
                  className="p-2 text-purple-600 hover:bg-purple-50 rounded-md"
                  title="Open poll"
                >
                  <ListChecks className="h-4 w-4" />
                </button>
              )}
              <button onClick={() => onMeetingDeleted(meeting.id)} className="p-2 text-red-600 hover:bg-red-50 rounded-md" title="Delete Meeting">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            <div className="flex items-center text-sm text-gray-600">
              <Calendar className="h-4 w-4 mr-2" />
              <span>{dateLabel}</span>
            </div>
            <div className="flex items-center text-sm text-gray-600">
              <Clock className="h-4 w-4 mr-2" />
              <span>
                {startLabel} – {endLabel} ({tzAbbrev})
              </span>
            </div>
            <div className="flex items-center text-sm text-gray-600">
              <Users className="h-4 w-4 mr-2" />
              <span>{meeting.participants.length} participants</span>
            </div>
            <div className="flex items-center text-sm text-gray-600">
              {isOnsite ? <MapPin className="h-4 w-4 mr-2" /> : <Video className="h-4 w-4 mr-2" />}
              <div className="flex flex-col">
                <span>{locationLabel}</span>
                <span className="text-xs text-gray-500">{locationSubtext}</span>
              </div>
            </div>
          </div>

          {meeting.metadata && meeting.metadata.meeting_url && (
            <div className="mb-4">
              <a
                href={meeting.metadata.meeting_url}
                target="_blank"
                rel="noreferrer"
                className="inline-block px-3 py-2 bg-green-600 text-white rounded-md hover:bg-green-700"
                title="Open Google Meet"
              >
                Join Google Meet
              </a>
            </div>
          )}

          <div className="border-t border-gray-200 pt-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center text-sm text-gray-600">
                <Mail className="h-4 w-4 mr-2" />
                <span>Participants:</span>
              </div>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {meeting.participants.map((participant) => (
                <span
                  key={participant.id}
                  className="inline-flex items-center px-2 py-1 rounded-md text-xs bg-gray-100 text-gray-700"
                >
                  {participant.name} ({participant.email})
                </span>
              ))}
            </div>
          </div>
        </div>
      );
      })}
    </div>
  );
};
