import React, { useState, useEffect, useMemo } from 'react';
import { Calendar, Plus, Clock, LogOut } from 'lucide-react';
import { Meeting, Poll } from '../types';
import { MeetingForm } from './MeetingForm';
import { Modal } from './Modal';
import { EditMeetingForm } from './EditMeetingForm';
import { AISchedulerService } from '../services/AISchedulerService';
import { notificationService } from '../services/NotificationService';
import { useAuth } from '../context/AuthContext';
import { CalendarView } from './CalendarView';

export const Dashboard: React.FC = () => {
  const { user, isLoading: authLoading, loginWithGoogle, logout } = useAuth();
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [pollSummaries, setPollSummaries] = useState<Record<string, Poll | null>>({});
  const [showForm, setShowForm] = useState(false);
  const [editMeeting, setEditMeeting] = useState<Meeting | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(() => new Date());
  const [calendarEvents, setCalendarEvents] = useState<any[]>([]);

  useEffect(() => {
    if (user) {
      loadMeetings();
      loadCalendar();
    } else {
      setMeetings([]);
      setCalendarEvents([]);
      setIsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(new Date());
    }, 30_000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const pollIds = Array.from(
      new Set(
        meetings
          .map((meeting) => meeting.metadata?.poll_id)
          .filter((id): id is string => Boolean(id))
      )
    );
    const missing = pollIds.filter((id) => pollSummaries[id] === undefined);
    if (missing.length === 0) {
      return;
    }
    missing.forEach(async (pollId) => {
      try {
        const poll = await AISchedulerService.getPoll(pollId);
        setPollSummaries((prev) => ({ ...prev, [pollId]: poll }));
      } catch (error) {
        console.error('Error loading poll details:', error);
        setPollSummaries((prev) => ({ ...prev, [pollId]: null }));
      }
    });
  }, [meetings, pollSummaries]);

  const loadMeetings = async () => {
    try {
      setIsLoading(true);
      setError(null);
      if (!user) {
        setMeetings([]);
        return;
      }
      const fetchedMeetings = await AISchedulerService.getMeetings();
      setMeetings(fetchedMeetings);
    } catch (err) {
      console.error('Error loading meetings:', err);
      const errorMessage = 'Failed to load meetings. Please try again.';
      setError(errorMessage);
      notificationService.error('Load Error', errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  const loadCalendar = async () => {
    if (!user) return;
    try {
      const now = new Date();
      const upcoming = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      const events = await AISchedulerService.getCalendarEvents(now, upcoming);
      setCalendarEvents(events?.map(event => ({ ...event, source: 'calendar' })) || []);
    } catch (error) {
      console.error('Error loading calendar events:', error);
    }
  };

  const handleMeetingCreated = (
    meeting: Meeting,
    meta: { isPollOnly: boolean; participantCount: number; createdPoll?: Poll | null }
  ) => {
    setMeetings(prev => [meeting, ...prev]);
    setShowForm(false);
    const { isPollOnly, participantCount, createdPoll } = meta;
    const shouldShowSummary = !(isPollOnly && !createdPoll);
    if (shouldShowSummary) {
      let summaryTitle: string;
      let summaryMessage: string;
      if (isPollOnly) {
        summaryTitle = 'Poll invitations sent';
        summaryMessage = `Participants will vote on the proposed options for “${meeting.title}”.`;
      } else if (createdPoll) {
        summaryTitle = 'Meeting scheduled + poll sent';
        summaryMessage = `Invitations and poll links were sent to ${participantCount} participants for “${meeting.title}”.`;
      } else {
        summaryTitle = 'Meeting scheduled';
        summaryMessage = `Invitations were sent to ${participantCount} participants for “${meeting.title}”.`;
      }
      notificationService.success(summaryTitle, summaryMessage);
    }
    loadCalendar();
  };

  const handleMeetingUpdated = (updatedMeeting: Meeting, message: string = 'Meeting details have been updated') => {
    setMeetings(prev => prev.map(m => m.id === updatedMeeting.id ? updatedMeeting : m));
    setCurrentTime(new Date());
    notificationService.meetingUpdated(updatedMeeting, message);
    loadCalendar();
    if (updatedMeeting.metadata?.poll_id) {
      setPollSummaries(prev => {
        const next = { ...prev };
        delete next[updatedMeeting.metadata!.poll_id as string];
        return next;
      });
    }
  };

  const handleMeetingDeleted = async (meetingId: string) => {
    try {
      const meetingToDelete = meetings.find(m => m.id === meetingId);
      await AISchedulerService.deleteMeeting(meetingId);
      setMeetings(prev => prev.filter(m => m.id !== meetingId));
      if (meetingToDelete) {
        notificationService.meetingDeleted(meetingToDelete.title);
        if (meetingToDelete.metadata?.poll_id) {
          setPollSummaries(prev => {
            const next = { ...prev };
            delete next[meetingToDelete.metadata!.poll_id as string];
            return next;
          });
        }
      }
      await loadCalendar();
    } catch (error) {
      console.error('Error deleting meeting:', error);
      const errorMessage = 'Failed to delete meeting. Please try again.';
      notificationService.error('Delete Error', errorMessage);
    }
  };

  const upcomingMeetings = meetings.filter(m => m.startTime > currentTime).length;
  const runningMeetings = meetings.filter((m: Meeting) => m.startTime <= currentTime && m.endTime > currentTime).length;

  const meetingGoogleEventIds = useMemo(
    () =>
      meetings
        .map((meeting) => meeting.metadata?.google_event_id)
        .filter((id): id is string => Boolean(id)),
    [meetings]
  );

  const filteredCalendarEvents = useMemo(() => {
    if (meetingGoogleEventIds.length === 0) {
      return calendarEvents;
    }
    const idSet = new Set(meetingGoogleEventIds);
    return calendarEvents.filter((event) => {
      const eventId: string | undefined = event.id || event.eventId;
      if (!eventId) return true;
      return !idSet.has(eventId);
    });
  }, [calendarEvents, meetingGoogleEventIds]);

  if (authLoading || (isLoading && user)) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading meetings...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center text-center px-4">
        <Calendar className="h-12 w-12 text-blue-600 mb-4" />
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Welcome to Meeting Scheduler</h1>
        <p className="text-gray-600 mb-6 max-w-xl">
          Connect your Google account to view your calendar, coordinate with teammates, and create polls when schedules conflict.
        </p>
        <button
          onClick={loginWithGoogle}
          className="px-6 py-3 bg-blue-600 text-white rounded-md hover:bg-blue-700"
        >
          Sign in with Google
        </button>
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
              <h1 className="text-2xl font-bold text-gray-900">Meeting Scheduler</h1>
            </div>
            <div className="flex items-center space-x-4">
              {user && (
                <div className="hidden sm:flex items-center space-x-2 pr-4 border-r border-gray-200">
                  {user.picture ? (
                    <img src={user.picture} alt={user.name} className="h-8 w-8 rounded-full object-cover" />
                  ) : (
                    <div className="h-8 w-8 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-sm font-semibold">
                      {user.name?.charAt(0) || user.email?.charAt(0)}
                    </div>
                  )}
                  <div className="text-left">
                    <p className="text-sm font-medium text-gray-900">{user.name}</p>
                    <p className="text-xs text-gray-500">{user.email}</p>
                  </div>
                </div>
              )}
              <button
                onClick={logout}
                className="flex items-center px-3 py-2 text-gray-600 hover:text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 rounded-md"
              >
                <LogOut className="h-5 w-5 mr-2" />
                Sign out
              </button>
              <button
                onClick={() => {
                  loadMeetings();
                  loadCalendar();
                }}
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
          {/* <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center">
              <Users className="h-8 w-8 text-green-600 mr-3" />
              <div>
                <p className="text-sm font-medium text-gray-600">Total Participants</p>
                <p className="text-2xl font-bold text-gray-900">{totalParticipants}</p>
              </div>
            </div>
          </div> */}
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
          <CalendarView
            events={[
              ...meetings.map((meeting) => ({
                id: `meeting-${meeting.id}`,
                summary: meeting.title,
                start: { dateTime: meeting.startTime.toISOString() },
                end: { dateTime: meeting.endTime.toISOString() },
                location:
                  meeting.metadata?.location_type === 'onsite'
                    ? meeting.metadata?.room_location || meeting.metadata?.room_name
                    : meeting.metadata?.meeting_url,
                meeting,
                source: 'meeting',
              })),
              ...filteredCalendarEvents,
            ]}
            currentTime={currentTime}
            pollSummaries={pollSummaries}
            onEditMeeting={setEditMeeting}
            onDeleteMeeting={(meeting) => handleMeetingDeleted(meeting.id)}
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

      {/* Edit Meeting Modal */}
      <Modal
        isOpen={!!editMeeting}
        onClose={() => setEditMeeting(null)}
        title={editMeeting ? `Edit: ${editMeeting.title}` : 'Edit Meeting'}
      >
        {editMeeting && (
          <EditMeetingForm
            meeting={editMeeting}
            onClose={() => setEditMeeting(null)}
            onUpdated={(m, message) => {
              handleMeetingUpdated(m, message);
              setEditMeeting(null);
            }}
          />
        )}
      </Modal>
    </div>
  );
};
