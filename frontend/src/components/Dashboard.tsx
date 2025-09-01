import React, { useState } from 'react';
import { Calendar, Plus, Users, Clock } from 'lucide-react';
import { Meeting } from '../types';
import { MeetingForm } from './MeetingForm';
import { MeetingList } from './MeetingList';

export const Dashboard: React.FC = () => {
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [showForm, setShowForm] = useState(false);

  const handleMeetingCreated = (meeting: Meeting) => {
    setMeetings([meeting, ...meetings]);
    setShowForm(false);
  };

  const handleMeetingUpdated = (updatedMeeting: Meeting) => {
    setMeetings(meetings.map(m => m.id === updatedMeeting.id ? updatedMeeting : m));
  };

  const handleMeetingDeleted = (meetingId: string) => {
    setMeetings(meetings.filter(m => m.id !== meetingId));
  };

  const totalParticipants = meetings.reduce((total, meeting) => total + meeting.participants.length, 0);
  const upcomingMeetings = meetings.filter(m => m.startTime > new Date()).length;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-6">
            <div className="flex items-center">
              <Calendar className="h-8 w-8 text-blue-600 mr-3" />
              <h1 className="text-2xl font-bold text-gray-900">AI Meeting Scheduler</h1>
            </div>
            <button
              onClick={() => setShowForm(!showForm)}
              className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <Plus className="h-5 w-5 mr-2" />
              {showForm ? 'Cancel' : 'New Meeting'}
            </button>
          </div>
        </div>
      </header>

      {/* Stats */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center">
              <Calendar className="h-8 w-8 text-blue-600 mr-3" />
              <div>
                <p className="text-sm font-medium text-gray-600">Total Meetings</p>
                <p className="text-2xl font-bold text-gray-900">{meetings.length}</p>
              </div>
            </div>
          </div>
          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center">
              <Users className="h-8 w-8 text-green-600 mr-3" />
              <div>
                <p className="text-sm font-medium text-gray-600">Total Participants</p>
                <p className="text-2xl font-bold text-gray-900">{totalParticipants}</p>
              </div>
            </div>
          </div>
          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center">
              <Clock className="h-8 w-8 text-yellow-600 mr-3" />
              <div>
                <p className="text-sm font-medium text-gray-600">Upcoming</p>
                <p className="text-2xl font-bold text-gray-900">{upcomingMeetings}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Main Content */}
        <div className="space-y-8">
          {showForm && (
            <MeetingForm onMeetingCreated={handleMeetingCreated} />
          )}
          
          <MeetingList
            meetings={meetings}
            onMeetingUpdated={handleMeetingUpdated}
            onMeetingDeleted={handleMeetingDeleted}
          />
        </div>
      </div>
    </div>
  );
};
