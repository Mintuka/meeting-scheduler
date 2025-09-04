import React, { useState } from 'react';
import { format } from 'date-fns';
import { Calendar, Clock, Users, Mail, Edit, Trash2, RefreshCw } from 'lucide-react';
import { Meeting } from '../types';
import { AISchedulerService } from '../services/AISchedulerService';

interface MeetingListProps {
  meetings: Meeting[];
  onMeetingUpdated: (meeting: Meeting) => void;
  onMeetingDeleted: (meetingId: string) => void;
}

export const MeetingList: React.FC<MeetingListProps> = ({
  meetings,
  onMeetingUpdated,
  onMeetingDeleted
}) => {
  const [reschedulingMeeting, setReschedulingMeeting] = useState<string | null>(null);

  const handleReschedule = async (meeting: Meeting) => {
    setReschedulingMeeting(meeting.id);
    try {
      const newTimeSlot = {
        start: new Date(meeting.startTime.getTime() + 24 * 60 * 60 * 1000),
        end: new Date(meeting.endTime.getTime() + 24 * 60 * 60 * 1000),
        isAvailable: true
      };
      
      const updatedMeeting = await AISchedulerService.rescheduleMeeting(meeting, newTimeSlot);
      onMeetingUpdated(updatedMeeting);
    } catch (error) {
      console.error('Error rescheduling meeting:', error);
      alert('Failed to reschedule meeting');
    } finally {
      setReschedulingMeeting(null);
    }
  };

  const handleSendReminder = async (meeting: Meeting) => {
    try {
      await AISchedulerService.sendReminder(meeting.id);
      alert('Reminder sent successfully!');
    } catch (error) {
      console.error('Error sending reminder:', error);
      alert('Failed to send reminder');
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
      {meetings.map((meeting) => (
        <div key={meeting.id} className="bg-white rounded-lg shadow-md p-6 border border-gray-200">
          <div className="flex justify-between items-start mb-4">
            <div>
              <h3 className="text-lg font-semibold text-gray-900 mb-1">{meeting.title}</h3>
              <p className="text-gray-600 text-sm mb-2">{meeting.description}</p>
              <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getStatusColor(meeting.status)}`}>
                {meeting.status.charAt(0).toUpperCase() + meeting.status.slice(1)}
              </span>
            </div>
            <div className="flex space-x-2">
              <button
                onClick={() => handleReschedule(meeting)}
                disabled={reschedulingMeeting === meeting.id}
                className="p-2 text-blue-600 hover:bg-blue-50 rounded-md disabled:opacity-50"
                title="Reschedule"
              >
                {reschedulingMeeting === meeting.id ? (
                  <RefreshCw className="h-4 w-4 animate-spin" />
                ) : (
                  <Edit className="h-4 w-4" />
                )}
              </button>
              <button
                onClick={() => onMeetingDeleted(meeting.id)}
                className="p-2 text-red-600 hover:bg-red-50 rounded-md"
                title="Delete"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            <div className="flex items-center text-sm text-gray-600">
              <Calendar className="h-4 w-4 mr-2" />
              <span>{format(meeting.startTime, 'MMM dd, yyyy')}</span>
            </div>
            <div className="flex items-center text-sm text-gray-600">
              <Clock className="h-4 w-4 mr-2" />
              <span>
                {format(meeting.startTime, 'h:mm a')} - {format(meeting.endTime, 'h:mm a')}
              </span>
            </div>
            <div className="flex items-center text-sm text-gray-600">
              <Users className="h-4 w-4 mr-2" />
              <span>{meeting.participants.length} participants</span>
            </div>
          </div>

          <div className="border-t border-gray-200 pt-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center text-sm text-gray-600">
                <Mail className="h-4 w-4 mr-2" />
                <span>Participants:</span>
              </div>
              <button
                onClick={() => handleSendReminder(meeting)}
                className="text-sm text-blue-600 hover:text-blue-800 font-medium"
              >
                Send Reminder
              </button>
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
      ))}
    </div>
  );
};
