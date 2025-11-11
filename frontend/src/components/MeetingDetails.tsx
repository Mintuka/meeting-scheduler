import React, { useMemo } from 'react';
import { Calendar, Clock, MapPin, Video, Mail, ExternalLink, Pencil } from 'lucide-react';
import { Meeting, Poll } from '../types';
import {
  formatFriendlyDateTime,
  formatFullRange,
  formatMonthDayTime,
  formatTimeOnly,
  getMeetingTimeZone,
  getTimeZoneAbbreviation,
} from '../utils/timezone';

interface MeetingDetailsProps {
  meeting: Meeting;
  pollSummary?: Poll | null;
  onEdit?: (meeting: Meeting) => void;
}

const avatarColors = [
  'from-blue-100 to-blue-200 text-blue-700',
  'from-purple-100 to-purple-200 text-purple-700',
  'from-green-100 to-green-200 text-green-700',
  'from-pink-100 to-pink-200 text-pink-700',
];

export const MeetingDetails: React.FC<MeetingDetailsProps> = ({ meeting, pollSummary, onEdit }) => {
  const timezone = useMemo(() => getMeetingTimeZone(meeting), [meeting]);
  const locationType = (meeting.metadata?.location_type as 'online' | 'onsite') || 'online';
  const meetingUrl = meeting.metadata?.meeting_url;
  const pollId = meeting.metadata?.poll_id as string | undefined;

  const participants = useMemo(() => {
    const list = [...meeting.participants];
    return list.sort((a, b) => {
      const aIsOrganizer = a.email === meeting.organizerEmail;
      const bIsOrganizer = b.email === meeting.organizerEmail;
      if (aIsOrganizer && !bIsOrganizer) return -1;
      if (!aIsOrganizer && bIsOrganizer) return 1;
      return (a.name || a.email).localeCompare(b.name || b.email);
    });
  }, [meeting.participants, meeting.organizerEmail]);

  const renderStatusBadge = (status: Meeting['status']) => {
    const colors: Record<Meeting['status'], string> = {
      scheduled: 'bg-blue-100 text-blue-800',
      confirmed: 'bg-green-100 text-green-800',
      cancelled: 'bg-red-100 text-red-800',
      rescheduled: 'bg-yellow-100 text-yellow-800',
      running: 'bg-purple-100 text-purple-800',
      completed: 'bg-gray-200 text-gray-700',
      polling: 'bg-orange-100 text-orange-800',
    };
    return (
      <span className={`text-xs font-semibold px-3 py-1 rounded-full ${colors[meeting.status] || 'bg-gray-100 text-gray-700'}`}>
        {meeting.status.charAt(0).toUpperCase() + meeting.status.slice(1)}
      </span>
    );
  };

  const pollOptions = pollSummary?.options ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-gray-900 mb-1">{meeting.title}</h2>
          <p className="text-sm text-gray-600">
            {meeting.description || 'No description provided.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {renderStatusBadge(meeting.status)}
          {onEdit && (
            <button
              type="button"
              onClick={() => onEdit(meeting)}
              className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 bg-blue-50 px-3 py-1.5 rounded-md hover:bg-blue-100"
            >
              <Pencil className="h-3.5 w-3.5" /> Edit
            </button>
          )}
        </div>
      </div>

      <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="rounded-xl border border-gray-100 p-4 bg-gray-50 space-y-3">
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <Clock className="h-4 w-4 text-blue-500" />
            <span>{formatFullRange(meeting.startTime, meeting.endTime, timezone)}</span>
          </div>
          <div className="flex items-center gap-2 text-sm text-gray-600">
            {locationType === 'online' ? (
              <Video className="h-4 w-4 text-blue-500" />
            ) : (
              <MapPin className="h-4 w-4 text-blue-500" />
            )}
            <div>
              <p className="font-medium text-gray-900">
                {locationType === 'online'
                  ? 'Virtual meeting'
                  : meeting.metadata?.room_name || 'Onsite meeting'}
              </p>
              <p className="text-xs text-gray-500">
                {locationType === 'online'
                  ? meeting.metadata?.meeting_platform || 'Google Meet'
                  : meeting.metadata?.room_location || 'Office'}
              </p>
            </div>
          </div>
          {meetingUrl && (
            <a
              href={meetingUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-sm font-semibold text-white bg-blue-600 rounded-md px-3 py-2 hover:bg-blue-700"
            >
              <Video className="h-4 w-4" /> Join meeting
            </a>
          )}
        </div>
        <div className="rounded-xl border border-gray-100 p-4 space-y-2">
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <Calendar className="h-4 w-4 text-blue-500" />
            <span>
              Created {formatFriendlyDateTime(meeting.createdAt, timezone)} (
              {getTimeZoneAbbreviation(meeting.createdAt, timezone)})
            </span>
          </div>
        <div className="flex items-center gap-2 text-sm text-gray-600">
            <Mail className="h-4 w-4 text-blue-500" />
            <span>Organizer: {meeting.organizerEmail || 'You'}</span>
          </div>
        </div>
      </section>

      {pollId && (
        <section className="rounded-xl border border-purple-100 bg-purple-50 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-purple-900">Polling participants</p>
              <p className="text-xs text-purple-700">
                {pollSummary
                  ? pollSummary.status === 'open'
                    ? 'Poll is open for responses'
                    : 'Poll closed · awaiting scheduling'
                  : 'Collecting poll data...'}
              </p>
            </div>
            <a
              href={`/poll/${pollId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs font-semibold text-white bg-purple-600 px-3 py-1.5 rounded-md hover:bg-purple-700"
            >
              View poll
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>
          {pollOptions.length > 0 && (
            <div className="space-y-2 text-sm text-purple-900">
              {pollOptions.slice(0, 4).map((option) => {
                  const start = new Date(option.start_time);
                  const end = new Date(option.end_time);
                  const isWinner = pollSummary?.winning_option_id === option.id;
                  return (
                    <div
                      key={option.id}
                      className={`flex items-center justify-between rounded-lg px-3 py-2 ${
                        isWinner ? 'bg-white shadow border border-purple-200' : 'bg-purple-100'
                      }`}
                    >
                      <div>
                        <p className="font-medium">
                          {formatMonthDayTime(start, timezone)} – {formatTimeOnly(end, timezone)}
                        </p>
                        <p className="text-xs text-purple-600">{option.votes} votes</p>
                      </div>
                      {isWinner && (
                        <span className="text-xs font-semibold text-green-700">Chosen slot</span>
                      )}
                    </div>
                  );
                })}
              {pollOptions.length > 4 && (
                <p className="text-xs text-purple-700">+{pollOptions.length - 4} additional options</p>
              )}
            </div>
          )}
        </section>
      )}

      <section>
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-sm font-semibold text-gray-900">Participants</p>
            <p className="text-xs text-gray-500">
              {meeting.participants.length} attendee{meeting.participants.length === 1 ? '' : 's'}
            </p>
          </div>
        </div>
        <div className="border border-gray-100 rounded-xl divide-y divide-gray-100 max-h-72 overflow-y-auto">
          {participants.map((participant, index) => {
            const initials = (participant.name || participant.email)
              .split(' ')
              .map((part) => part.charAt(0))
              .slice(0, 2)
              .join('')
              .toUpperCase();
            const avatarClass = avatarColors[index % avatarColors.length];
            const isOrganizer = participant.email === meeting.organizerEmail;
            return (
              <div key={participant.email} className="flex items-center justify-between px-4 py-3 bg-white">
                <div className="flex items-center gap-3">
                  <div
                    className={`h-10 w-10 rounded-full bg-gradient-to-br ${avatarClass} flex items-center justify-center text-sm font-semibold border border-white shadow`}
                  >
                    {initials}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-900">{participant.name || participant.email}</p>
                    <p className="text-xs text-gray-500">{participant.email}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {isOrganizer && (
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">
                      Organizer
                    </span>
                  )}
                  <a
                    href={`mailto:${participant.email}`}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:underline"
                  >
                    <Mail className="h-3.5 w-3.5" /> Email
                  </a>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
};
