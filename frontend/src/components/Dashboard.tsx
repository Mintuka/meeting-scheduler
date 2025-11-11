import React, { useState, useEffect, useMemo } from 'react';
import { Calendar, Plus, LogOut } from 'lucide-react';
import { Meeting, Poll } from '../types';
import { MeetingForm } from './MeetingForm';
import { MeetingDetails } from './MeetingDetails';
import { Modal } from './Modal';
import { EditMeetingForm } from './EditMeetingForm';
import { EditEventForm } from './EditEventForm';
import { UserProfileDropdown } from './UserProfileDropdown';
import { AISchedulerService } from '../services/AISchedulerService';
import { notificationService } from '../services/NotificationService';
import { useAuth } from '../context/AuthContext';
import { CalendarView } from './CalendarView';

export const Dashboard: React.FC = () => {
  const { user, isLoading: authLoading, loginWithGoogle, logout } = useAuth();
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [pollSummaries, setPollSummaries] = useState<Record<string, Poll | null>>({});
  const [showForm, setShowForm] = useState(false);
  const [showEventForm, setShowEventForm] = useState(false);
  const [editMeeting, setEditMeeting] = useState<Meeting | null>(null);
  const [viewMeeting, setViewMeeting] = useState<Meeting | null>(null);
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

  // Load meetings and events when user changes
  useEffect(() => {
    if (user) {
      // User is authenticated, fetch data
      loadMeetings();
      loadEvents();
    } else {
      // User is not authenticated, clear data immediately
      setMeetings([]);
      setEvents([]);
      setIsLoading(false); // Make sure loading is false when not authenticated
    }
  }, [user]);

  const checkAuth = async () => {
    try {
      setIsAuthLoading(true);
      const currentUser = authService.getUser();
      const token = authService.getToken();
      
      if (currentUser && token) {
        // Verify token is still valid by fetching user info
        try {
          const userInfo = await authService.getCurrentUser();
          if (userInfo) {
            setUser(userInfo);
          } else {
            // Token invalid, clear auth
            authService.clearAuth();
            setUser(null);
            setMeetings([]);
            setEvents([]);
          }
        } catch (error) {
          // Token validation failed, clear auth
          console.error('Token validation failed:', error);
          authService.clearAuth();
          setUser(null);
          setMeetings([]);
          setEvents([]);
        }
      } else {
        // No user or token, ensure clean state
        setUser(null);
        setMeetings([]);
        setEvents([]);
      }
    } catch (error) {
      console.error('Auth check failed:', error);
      authService.clearAuth();
      setUser(null);
      setMeetings([]);
      setEvents([]);
    } finally {
      setIsAuthLoading(false);
      setIsLoading(false); // Ensure loading is false after auth check
    }
  };

  const handleSignIn = async () => {
    try {
      await authService.signInWithGoogle();
    } catch (error) {
      console.error('Sign in failed:', error);
      notificationService.error('Sign In Error', 'Failed to initiate Google sign in. Please try again.');
    }
  };

  const handleLogout = () => {
    setUser(null);
    notificationService.info('Logged Out', 'You have been successfully logged out.');
  };

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
    // Only load meetings if user is authenticated
    if (!user) {
      setMeetings([]);
      setIsLoading(false);
      return;
    }
    
    try {
      setIsLoading(true);
      setError(null);
      if (!user) {
        setMeetings([]);
        return;
      }
      const fetchedMeetings = await AISchedulerService.getMeetings();
      setMeetings(fetchedMeetings || []);
    } catch (err: any) {
      console.error('Error loading meetings:', err);
      const errorMessage = err.message || 'Failed to load meetings. Please try again.';
      
      // Don't show error if user is not authenticated or if it's a 401
      if (errorMessage.includes('401') || errorMessage.includes('Not authenticated')) {
        setMeetings([]);
        setIsLoading(false);
        return;
      }
      
      setError(errorMessage);
      notificationService.error('Load Error', errorMessage);
      setMeetings([]);
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

  const handleMeetingDeleted = async (meeting: Meeting) => {
    try {
      await AISchedulerService.deleteMeeting(meeting.id);
      setMeetings(prev => prev.filter(m => m.id !== meeting.id));
      const pollId = meeting.metadata?.poll_id;
      if (pollId) {
        setPollSummaries(prev => {
          const next = { ...prev };
          delete next[pollId];
          return next;
        });
      }
      if (viewMeeting?.id === meeting.id) {
        setViewMeeting(null);
      }
      if (editMeeting?.id === meeting.id) {
        setEditMeeting(null);
      }
      const googleEventId = meeting.metadata?.google_event_id;
      if (googleEventId) {
        setCalendarEvents(prev =>
          prev.filter(event => {
            const eventId = event.id || event.eventId;
            return eventId !== googleEventId;
          })
        );
      }
      notificationService.meetingDeleted(meeting.title);
      loadCalendar();
    } catch (error) {
      console.error('Error deleting meeting:', error);
      const errorMessage = 'Failed to delete meeting. Please try again.';
      notificationService.error('Delete Error', errorMessage);
    }
  };

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
          <p className="text-gray-600">{isAuthLoading ? 'Checking authentication...' : 'Loading data...'}</p>
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

  const containerClasses = "w-full max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-10 xl:px-16";

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b border-gray-200">
        <div className={containerClasses}>
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
        <div className={`${containerClasses} py-4`}>
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

      {/* Main Content */}
      <div className={`${containerClasses} py-6`}>
        <div className="min-h-[calc(100vh-200px)] lg:min-h-[calc(100vh-140px)] lg:h-[calc(100vh-140px)]">
          <CalendarView
            className="h-full"
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
            onDeleteMeeting={handleMeetingDeleted}
            onViewMeeting={setViewMeeting}
          />
        </div>
      )}

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

      <Modal
        isOpen={!!viewMeeting}
        onClose={() => setViewMeeting(null)}
        title={viewMeeting ? 'Meeting details' : 'Meeting'}
      >
        {viewMeeting && (
          <MeetingDetails
            meeting={viewMeeting}
            pollSummary={viewMeeting.metadata?.poll_id ? pollSummaries[viewMeeting.metadata.poll_id] : undefined}
            onEdit={(meeting) => {
              setEditMeeting(meeting);
              setViewMeeting(null);
            }}
          />
        )}
      </Modal>
    </div>
  );
};
