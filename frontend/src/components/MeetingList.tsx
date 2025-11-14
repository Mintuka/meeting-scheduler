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
  const [polls, setPolls] = useState<Record<string, Poll[]>>({});
  const [showPollForm, setShowPollForm] = useState<Record<string, boolean>>({});
  const [loadingPolls, setLoadingPolls] = useState<Record<string, boolean>>({});

  const currentUser = authService.getUser();
  const userEmail = currentUser?.email;

  // Check if user is a participant (can vote)
  const isParticipant = (meeting: Meeting) => {
    if (!userEmail) return false;
    return meeting.participants.some(p => p.email === userEmail);
  };

  // Check if user is meeting creator (first participant, can create polls)
  const isMeetingCreator = (meeting: Meeting) => {
    if (!userEmail || meeting.participants.length === 0) return false;
    return meeting.participants[0].email === userEmail;
  };

  const loadPolls = async (meetingId: string) => {
    if (loadingPolls[meetingId]) return;
    
    setLoadingPolls(prev => ({ ...prev, [meetingId]: true }));
    try {
      const meetingPolls = await AISchedulerService.getMeetingPolls(meetingId);
      setPolls(prev => ({ ...prev, [meetingId]: meetingPolls }));
    } catch (error) {
      console.error('Error loading polls:', error);
    } finally {
      setLoadingPolls(prev => ({ ...prev, [meetingId]: false }));
    }
  };

  // Auto-load polls for meetings where user is a participant (only once per meeting)
  useEffect(() => {
    if (!userEmail) return;
    
    meetings.forEach(meeting => {
      const isUserParticipant = meeting.participants.some(p => p.email === userEmail);
      if (isUserParticipant && !polls[meeting.id] && !loadingPolls[meeting.id] && !showPollForm[meeting.id]) {
        loadPolls(meeting.id);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetings.length, userEmail]); // Load when meetings list changes or user changes

  const computeStatus = (meeting: Meeting): Meeting['status'] => {
    if (meeting.status === 'cancelled') return 'cancelled';
    if (meeting.startTime <= currentTime && meeting.endTime > currentTime) return 'running';
    if (meeting.endTime <= currentTime) return 'completed';
    if (meeting.status === 'rescheduled') return 'rescheduled';
    return meeting.status;
  };

  const handleSendReminder = async (meeting: Meeting) => {
    try {
      await AISchedulerService.sendReminder(meeting.id);
      notificationService.meetingReminderSent(meeting);
    } catch (error) {
      console.error('Error sending reminder:', error);
      notificationService.error('Reminder Error', 'Failed to send reminder. Please try again.');
    }
  };

  const handleCreatePoll = async (meetingId: string, pollData: PollCreate) => {
    try {
      const poll = await AISchedulerService.createPoll(meetingId, pollData);
      setPolls(prev => ({
        ...prev,
        [meetingId]: [...(prev[meetingId] || []), poll]
      }));
      setShowPollForm(prev => ({ ...prev, [meetingId]: false }));
      notificationService.success('Poll Created', 'Poll has been created successfully.');
    } catch (error) {
      console.error('Error creating poll:', error);
      notificationService.error('Poll Error', 'Failed to create poll. Please try again.');
    }
  };

  const handleVote = async (pollId: string, optionId: string) => {
    try {
      const updatedPoll = await AISchedulerService.voteOnPoll(pollId, optionId);
      // Find which meeting this poll belongs to
      const meetingId = Object.keys(polls).find(id =>
        polls[id].some(p => p.id === pollId)
      );
      if (meetingId) {
        setPolls(prev => ({
          ...prev,
          [meetingId]: prev[meetingId].map(p => p.id === pollId ? updatedPoll : p)
        }));
      }
    } catch (error) {
      console.error('Error voting on poll:', error);
      notificationService.error('Vote Error', 'Failed to vote. Please try again.');
    }
  };

  const handleClosePoll = async (pollId: string) => {
    try {
      const updatedPoll = await AISchedulerService.closePoll(pollId);
      const meetingId = Object.keys(polls).find(id =>
        polls[id].some(p => p.id === pollId)
      );
      if (meetingId) {
        setPolls(prev => ({
          ...prev,
          [meetingId]: prev[meetingId].map(p => p.id === pollId ? updatedPoll : p)
        }));
      }
      notificationService.success('Poll Closed', 'Poll has been closed.');
    } catch (error) {
      console.error('Error closing poll:', error);
      notificationService.error('Poll Error', 'Failed to close poll. Please try again.');
    }
  };

  const handleDeletePoll = async (pollId: string) => {
    if (!window.confirm('Are you sure you want to delete this poll?')) return;
    
    try {
      await AISchedulerService.deletePoll(pollId);
      const meetingId = Object.keys(polls).find(id =>
        polls[id].some(p => p.id === pollId)
      );
      if (meetingId) {
        setPolls(prev => ({
          ...prev,
          [meetingId]: prev[meetingId].filter(p => p.id !== pollId)
        }));
      }
      notificationService.info('Poll Deleted', 'Poll has been deleted.');
    } catch (error) {
      console.error('Error deleting poll:', error);
      notificationService.error('Poll Error', 'Failed to delete poll. Please try again.');
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
              <button 
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  handleSendReminder(meeting);
                }} 
                className="p-2 text-blue-600 hover:bg-blue-50 rounded-md" 
                title="Send Reminder"
              >
                <Bell className="h-4 w-4" />
              </button>
              <div className="relative group">
                <button
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
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
                    Completed meetings can't be edited
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

          {/* Polls Section */}
          <div className="border-t border-gray-200 pt-4 mt-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center text-sm font-medium text-gray-700">
                <BarChart3 className="h-4 w-4 mr-2" />
                <span>Polls</span>
                {polls[meeting.id] && polls[meeting.id].length > 0 && (
                  <span className="ml-2 px-2 py-0.5 bg-blue-100 text-blue-800 rounded-full text-xs">
                    {polls[meeting.id].length}
                  </span>
                )}
              </div>
              {isMeetingCreator(meeting) && (
                <button
                  onClick={() => {
                    setShowPollForm(prev => ({ ...prev, [meeting.id]: !prev[meeting.id] }));
                    if (!polls[meeting.id] && !loadingPolls[meeting.id]) {
                      loadPolls(meeting.id);
                    }
                  }}
                  className="flex items-center text-sm text-blue-600 hover:text-blue-700"
                >
                  {showPollForm[meeting.id] ? (
                    <>
                      <X className="h-4 w-4 mr-1" />
                      Cancel
                    </>
                  ) : (
                    <>
                      <Plus className="h-4 w-4 mr-1" />
                      Create Poll
                    </>
                  )}
                </button>
              )}
            </div>

            {/* Poll Form */}
            {showPollForm[meeting.id] && (
              <div className="mb-4 p-4 bg-gray-50 rounded-lg border border-gray-200">
                <PollForm
                  meetingId={meeting.id}
                  onSubmit={(pollData) => handleCreatePoll(meeting.id, pollData)}
                  onCancel={() => setShowPollForm(prev => ({ ...prev, [meeting.id]: false }))}
                />
              </div>
            )}

            {/* Load Polls Button - Show for all participants */}
            {!polls[meeting.id] && !showPollForm[meeting.id] && isParticipant(meeting) && (
              <button
                onClick={() => loadPolls(meeting.id)}
                className="text-sm text-blue-600 hover:text-blue-700 mb-3"
              >
                {loadingPolls[meeting.id] ? 'Loading polls...' : 'View Polls'}
              </button>
            )}


            {/* Display Polls */}
            {polls[meeting.id] && polls[meeting.id].length > 0 && (
              <div className="space-y-3">
                {polls[meeting.id].map((poll) => (
                  <PollDisplay
                    key={poll.id}
                    poll={poll}
                    onVote={handleVote}
                    onClose={poll.creatorEmail === userEmail ? handleClosePoll : undefined}
                    onDelete={poll.creatorEmail === userEmail ? handleDeletePoll : undefined}
                  />
                ))}
              </div>
            )}

            {polls[meeting.id] && polls[meeting.id].length === 0 && !showPollForm[meeting.id] && (
              <p className="text-sm text-gray-500">No polls yet. Create one to get started!</p>
            )}
          </div>

          <div className="border-t border-gray-200 pt-4 mt-4">
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
