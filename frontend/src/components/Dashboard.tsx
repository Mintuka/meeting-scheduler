import React, { useState, useEffect } from 'react';
import { Calendar, Plus, Users, Clock } from 'lucide-react';
import { Meeting } from '../types';
import { MeetingForm } from './MeetingForm';
import { MeetingList } from './MeetingList';
import { Modal } from './Modal';
import { AISchedulerService } from '../services/AISchedulerService';

export const Dashboard: React.FC = () => {
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadMeetings();
  }, []);

  const loadMeetings = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const fetchedMeetings = await AISchedulerService.getMeetings();
      setMeetings(fetchedMeetings);
    } catch (err) {
      console.error('Error loading meetings:', err);
      setError('Failed to load meetings. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleMeetingCreated = (meeting: Meeting) => {
    setMeetings([meeting, ...meetings]);
    setShowForm(false);
  };

  const handleMeetingUpdated = (updatedMeeting: Meeting) => {
    setMeetings(meetings.map(m => m.id === updatedMeeting.id ? updatedMeeting : m));
  };

  const handleMeetingDeleted = async (meetingId: string) => {
    try {
      await AISchedulerService.deleteMeeting(meetingId);
      setMeetings(meetings.filter(m => m.id !== meetingId));
    } catch (error) {
      console.error('Error deleting meeting:', error);
      alert('Failed to delete meeting. Please try again.');
    }
  };

  const totalParticipants = meetings.reduce((total, meeting) => total + meeting.participants.length, 0);
  const upcomingMeetings = meetings.filter(m => m.startTime > new Date()).length;
  const runningMeetings = meetings.filter((m: Meeting) => {
    const now = new Date();
    return m.startTime <= now && m.endTime > now;
  }).length;

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading meetings...</p>
        </div>
      </div>
    );
  }

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
            <div className="flex items-center space-x-4">
              <button
                onClick={loadMeetings}
                className="flex items-center px-3 py-2 text-gray-600 hover:text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 rounded-md"
              >
                <Clock className="h-5 w-5 mr-2" />
                Refresh
              </button>
              <button
                onClick={() => setShowForm(!showForm)}
                className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <Plus className="h-5 w-5 mr-2" />
                New Meeting
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Error Message */}
      {error && (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="bg-red-50 border border-red-200 rounded-md p-4">
            <div className="flex">
              <div className="flex-shrink-0">
                <svg className="h-5 w-5 text-red-400" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                </svg>
              </div>
              <div className="ml-3">
                <p className="text-sm text-red-700">{error}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
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
          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center">
              <div className="h-8 w-8 bg-red-100 rounded-full flex items-center justify-center mr-3">
                <div className="h-3 w-3 bg-red-500 rounded-full animate-pulse"></div>
              </div>
              <div>
                <p className="text-sm font-medium text-gray-600">Running Now</p>
                <p className="text-2xl font-bold text-gray-900">{runningMeetings}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Main Content */}
        <div className="space-y-8">
          <MeetingList
            meetings={meetings}
            onMeetingUpdated={handleMeetingUpdated}
            onMeetingDeleted={handleMeetingDeleted}
          />
        </div>

        {/* Meeting Form Modal */}
        <Modal 
          isOpen={showForm} 
          onClose={() => setShowForm(false)}
          title="Create New Meeting"
        >
          <MeetingForm onMeetingCreated={handleMeetingCreated} />
        </Modal>
      </div>
    </div>
  );
};
