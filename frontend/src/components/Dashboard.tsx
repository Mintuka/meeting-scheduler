import React, { useState, useEffect } from 'react';
import { Calendar, Plus, Users, Clock, LogIn } from 'lucide-react';
import { Meeting, Event } from '../types';
import { MeetingForm } from './MeetingForm';
import { MeetingList } from './MeetingList';
import { EventForm } from './EventForm';
import { EventList } from './EventList';
import { Modal } from './Modal';
import { EditMeetingForm } from './EditMeetingForm';
import { EditEventForm } from './EditEventForm';
import { UserProfileDropdown } from './UserProfileDropdown';
import { AISchedulerService } from '../services/AISchedulerService';
import { notificationService } from '../services/NotificationService';
import { authService, User as AuthUser } from '../services/AuthService';

type TabType = 'meetings' | 'events';

export const Dashboard: React.FC = () => {
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [showEventForm, setShowEventForm] = useState(false);
  const [editMeeting, setEditMeeting] = useState<Meeting | null>(null);
  const [editEvent, setEditEvent] = useState<Event | null>(null);
  const [isLoading, setIsLoading] = useState(false); // Start as false, only true when loading data for authenticated user
  const [error, setError] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(() => new Date());
  const [activeTab, setActiveTab] = useState<TabType>('meetings');
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true); // Only true during initial auth check

  useEffect(() => {
    // Check for OAuth callback token in URL
    const urlParams = new URLSearchParams(window.location.search);
    const token = urlParams.get('token');
    const email = urlParams.get('email');
    const name = urlParams.get('name');
    const authError = urlParams.get('error');

    if (token && email && name) {
      // Store token and user from OAuth callback
      const picture = urlParams.get('picture') || undefined;
      authService.setToken(token);
      authService.setUser({ email, name, picture });
      setUser({ email, name, picture });
      // Clean up URL
      window.history.replaceState({}, document.title, window.location.pathname);
      notificationService.success('Login Successful', 'You have been successfully logged in.');
    } else if (authError) {
      const message = urlParams.get('message') || 'Authentication failed';
      notificationService.error('Authentication Error', message);
      // Clean up URL
      window.history.replaceState({}, document.title, window.location.pathname);
    } else if (urlParams.get('calendar_connected') === 'true') {
      notificationService.success('Calendar Connected', 'Google Calendar has been successfully connected.');
      // Clean up URL
      window.history.replaceState({}, document.title, window.location.pathname);
    } else if (urlParams.get('error') === 'calendar_connect') {
      const message = urlParams.get('message') || 'Failed to connect Google Calendar';
      notificationService.error('Calendar Connection Error', message);
      // Clean up URL
      window.history.replaceState({}, document.title, window.location.pathname);
    }

    // Check if user is already authenticated
    checkAuth();
  }, []);

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

  const loadEvents = async () => {
    // Only load events if user is authenticated
    if (!user) {
      setEvents([]);
      return;
    }
    
    try {
      setError(null);
      
      const fetchedEvents = await AISchedulerService.getEvents();
      setEvents(fetchedEvents || []);
    } catch (err: any) {
      console.error('Error loading events:', err);
      const errorMessage = err.message || 'Failed to load events. Please try again.';
      
      // Don't show error if user is not authenticated or if it's a 401
      if (errorMessage.includes('401') || errorMessage.includes('Not authenticated')) {
        setEvents([]);
        return;
      }
      
      setError(errorMessage);
      notificationService.error('Load Error', errorMessage);
      setEvents([]);
    }
  };

  const handleMeetingCreated = (meeting: Meeting) => {
    setMeetings(prev => [meeting, ...prev]);
    setShowForm(false);
    notificationService.meetingCreated(meeting);
  };

  const handleMeetingUpdated = (updatedMeeting: Meeting, message: string = 'Meeting details have been updated') => {
    setMeetings(prev => prev.map(m => m.id === updatedMeeting.id ? updatedMeeting : m));
    setCurrentTime(new Date());
    notificationService.meetingUpdated(updatedMeeting, message);
  };

  const handleMeetingDeleted = async (meetingId: string) => {
    try {
      const meetingToDelete = meetings.find(m => m.id === meetingId);
      await AISchedulerService.deleteMeeting(meetingId);
      setMeetings(prev => prev.filter(m => m.id !== meetingId));
      if (meetingToDelete) {
        notificationService.meetingDeleted(meetingToDelete.title);
      }
    } catch (error) {
      console.error('Error deleting meeting:', error);
      const errorMessage = 'Failed to delete meeting. Please try again.';
      notificationService.error('Delete Error', errorMessage);
    }
  };

  const handleEventCreated = (event: Event) => {
    setEvents(prev => [event, ...prev]);
    setShowEventForm(false);
    notificationService.success('Event Created', `Event "${event.title}" has been created successfully.`);
  };

  const handleEventUpdated = (updatedEvent: Event, message: string = 'Event details have been updated') => {
    setEvents(prev => prev.map(e => e.id === updatedEvent.id ? updatedEvent : e));
    setCurrentTime(new Date());
    notificationService.success('Event Updated', message);
  };

  const handleEventDeleted = async (eventId: string) => {
    try {
      const eventToDelete = events.find(e => e.id === eventId);
      await AISchedulerService.deleteEvent(eventId);
      setEvents(prev => prev.filter(e => e.id !== eventId));
      if (eventToDelete) {
        notificationService.info('Event Deleted', `Event "${eventToDelete.title}" has been deleted`);
      }
    } catch (error) {
      console.error('Error deleting event:', error);
      const errorMessage = 'Failed to delete event. Please try again.';
      notificationService.error('Delete Error', errorMessage);
    }
  };

  const totalParticipants = meetings.reduce((total, meeting) => total + meeting.participants.length, 0);
  const upcomingMeetings = meetings.filter(m => m.startTime > currentTime).length;
  const runningMeetings = meetings.filter((m: Meeting) => m.startTime <= currentTime && m.endTime > currentTime).length;
  const upcomingEvents = events.filter(e => e.startTime > currentTime).length;
  const runningEvents = events.filter((e: Event) => e.startTime <= currentTime && e.endTime > currentTime).length;
  const totalEvents = events.length;
  const completedEvents = events.filter(e => e.endTime <= currentTime).length;

  // Only show loading spinner if auth is loading OR if user is authenticated and data is loading
  // Don't show loading if user is not authenticated (should show zeros immediately)
  if (isAuthLoading || (user && isLoading)) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">{isAuthLoading ? 'Checking authentication...' : 'Loading data...'}</p>
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
              {!isAuthLoading && (
                <>
                  {user ? (
                    <>
                      <button
                        onClick={() => AISchedulerService.connectGoogle()}
                        className="flex items-center px-3 py-2 text-green-700 bg-green-100 hover:bg-green-200 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500"
                      >
                        Connect Google Calendar
                      </button>
                      <button
                        onClick={() => {
                          loadMeetings();
                          loadEvents();
                        }}
                        className="flex items-center px-3 py-2 text-gray-600 hover:text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 rounded-md"
                      >
                        <Clock className="h-5 w-5 mr-2" />
                        Refresh
                      </button>
                      {activeTab === 'events' ? (
                        <button
                          onClick={() => setShowEventForm(true)}
                          className="flex items-center px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-purple-500"
                        >
                          <Plus className="h-5 w-5 mr-2" />
                          New Event
                        </button>
                      ) : (
                        <button
                          onClick={() => setShowForm(!showForm)}
                          className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        >
                          <Plus className="h-5 w-5 mr-2" />
                          New Meeting
                        </button>
                      )}
                      <UserProfileDropdown user={user} onLogout={handleLogout} />
                    </>
                  ) : (
                    <button
                      onClick={handleSignIn}
                      className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <LogIn className="h-5 w-5 mr-2" />
                      Sign In
                    </button>
                  )}
                </>
              )}
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

      {/* Stats - Always show, but will show zeros if not authenticated */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className={`grid grid-cols-1 gap-6 mb-8 ${activeTab === 'meetings' ? 'md:grid-cols-4' : 'md:grid-cols-4'}`}>
          {activeTab === 'meetings' ? (
            <>
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
            </>
          ) : (
            <>
              <div className="bg-white rounded-lg shadow p-6">
                <div className="flex items-center">
                  <Calendar className="h-8 w-8 text-purple-600 mr-3" />
                  <div>
                    <p className="text-sm font-medium text-gray-600">Total Events</p>
                    <p className="text-2xl font-bold text-gray-900">{totalEvents}</p>
                  </div>
                </div>
              </div>
              <div className="bg-white rounded-lg shadow p-6">
                <div className="flex items-center">
                  <Clock className="h-8 w-8 text-yellow-600 mr-3" />
                  <div>
                    <p className="text-sm font-medium text-gray-600">Upcoming Events</p>
                    <p className="text-2xl font-bold text-gray-900">{upcomingEvents}</p>
                  </div>
                </div>
              </div>
              <div className="bg-white rounded-lg shadow p-6">
                <div className="flex items-center">
                  <div className="h-8 w-8 bg-purple-100 rounded-full flex items-center justify-center mr-3">
                    <div className="h-3 w-3 bg-purple-500 rounded-full animate-pulse"></div>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-600">Running Now</p>
                    <p className="text-2xl font-bold text-gray-900">{runningEvents}</p>
                  </div>
                </div>
              </div>
              <div className="bg-white rounded-lg shadow p-6">
                <div className="flex items-center">
                  <div className="h-8 w-8 bg-gray-100 rounded-full flex items-center justify-center mr-3">
                    <svg className="h-5 w-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-600">Completed</p>
                    <p className="text-2xl font-bold text-gray-900">{completedEvents}</p>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Tabs */}
        <div className="bg-white rounded-lg shadow mb-6">
          <div className="border-b border-gray-200">
            <nav className="flex -mb-px" aria-label="Tabs">
              <button
                onClick={() => setActiveTab('meetings')}
                className={`
                  flex-1 py-4 px-6 text-center border-b-2 font-medium text-sm
                  ${activeTab === 'meetings'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }
                  transition-colors duration-200
                `}
              >
                <div className="flex items-center justify-center">
                  <Users className="h-5 w-5 mr-2" />
                  Meetings
                  <span className={`ml-2 py-0.5 px-2 rounded-full text-xs ${activeTab === 'meetings' ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-600'}`}>
                    {meetings.length}
                  </span>
                </div>
              </button>
              <button
                onClick={() => setActiveTab('events')}
                className={`
                  flex-1 py-4 px-6 text-center border-b-2 font-medium text-sm
                  ${activeTab === 'events'
                    ? 'border-purple-500 text-purple-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }
                  transition-colors duration-200
                `}
              >
                <div className="flex items-center justify-center">
                  <Calendar className="h-5 w-5 mr-2" />
                  Events
                  <span className={`ml-2 py-0.5 px-2 rounded-full text-xs ${activeTab === 'events' ? 'bg-purple-100 text-purple-800' : 'bg-gray-100 text-gray-600'}`}>
                    {events.length}
                  </span>
                </div>
              </button>
            </nav>
          </div>
        </div>
      </div>

      {/* Main Content */}
      {!user ? (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="text-center py-12 bg-white rounded-lg shadow">
            <LogIn className="h-12 w-12 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">Please sign in to view meetings and events</h3>
            <p className="text-gray-500 mb-4">Sign in with Google to access your meetings and events</p>
            <button
              onClick={handleSignIn}
              className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <LogIn className="h-5 w-5 mr-2" />
              Sign In with Google
            </button>
          </div>
        </div>
      ) : (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-6">
          <div className="space-y-8">
            {activeTab === 'meetings' ? (
              <MeetingList
                meetings={meetings}
                onMeetingUpdated={(m, message) => {
                  handleMeetingUpdated(m, message);
                }}
                onMeetingDeleted={handleMeetingDeleted}
                onEditMeeting={setEditMeeting}
                currentTime={currentTime}
              />
            ) : (
              <EventList
                events={events}
                onEventUpdated={(e, message) => {
                  handleEventUpdated(e, message);
                }}
                onEventDeleted={handleEventDeleted}
                onEditEvent={setEditEvent}
                currentTime={currentTime}
              />
            )}
          </div>
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

      {/* Event Form Modal */}
      <Modal 
        isOpen={showEventForm} 
        onClose={() => setShowEventForm(false)}
        title="Create New Event"
      >
        <EventForm onEventCreated={handleEventCreated} />
      </Modal>

      {/* Edit Event Modal */}
      <Modal
        isOpen={!!editEvent}
        onClose={() => setEditEvent(null)}
        title={editEvent ? `Edit: ${editEvent.title}` : 'Edit Event'}
      >
        {editEvent && (
          <EditEventForm
            event={editEvent}
            onClose={() => setEditEvent(null)}
            onUpdated={(e, message) => {
              handleEventUpdated(e, message);
              setEditEvent(null);
            }}
          />
        )}
      </Modal>
    </div>
  );
};
