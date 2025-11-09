import React, { useMemo, useState } from 'react';
import {
  addDays,
  addWeeks,
  format,
  isSameDay,
  startOfWeek,
} from 'date-fns';
import { Meeting, Poll } from '../types';

interface CalendarViewProps {
  events: any[];
  currentTime: Date;
  pollSummaries?: Record<string, Poll | null | undefined>;
  onEditMeeting?: (meeting: Meeting) => void;
  onDeleteMeeting?: (meeting: Meeting) => void;
}

interface NormalizedEvent {
  id: string;
  summary: string;
  start: Date;
  end: Date;
  location?: string;
  meeting?: Meeting;
  source?: 'meeting' | 'calendar';
}

const normalizeEvents = (events: any[]): NormalizedEvent[] => {
  const normalized: NormalizedEvent[] = [];

  events.forEach((event) => {
    const start = event.start?.dateTime
      ? new Date(event.start.dateTime)
      : event.start?.date
        ? new Date(event.start.date)
        : null;
    const end = event.end?.dateTime
      ? new Date(event.end.dateTime)
      : event.end?.date
        ? new Date(event.end.date)
        : null;

    if (!start || !end || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return;
    }

    normalized.push({
      id: event.id || `${event.summary}-${start.toISOString()}`,
      summary: event.summary || 'Untitled event',
      start,
      end,
      location: event.location,
      meeting: event.meeting,
      source: event.source === 'meeting' ? 'meeting' : 'calendar',
    });
  });

  return normalized.sort((a, b) => a.start.getTime() - b.start.getTime());
};

export const CalendarView: React.FC<CalendarViewProps> = ({
  events,
  currentTime,
  pollSummaries,
  onEditMeeting,
  onDeleteMeeting,
}) => {
  const normalizedEvents = useMemo(() => normalizeEvents(events), [events]);
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const timezone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);
  const today = new Date();
  const weekDays = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));

  const handleMonthInput = (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    if (!value) return;
    const [year, month] = value.split('-').map(Number);
    const jumpDate = new Date(year, month - 1, 1);
    setWeekStart(startOfWeek(jumpDate, { weekStartsOn: 1 }));
  };

  const renderDayEvents = (day: Date) => {
    const dayEvents = normalizedEvents.filter((event) => isSameDay(event.start, day));
    if (dayEvents.length === 0) {
      return <p className="text-[11px] text-gray-400">No events</p>;
    }
    return (
      <>
        {dayEvents.slice(0, 3).map((event) => (
          <div key={`${event.id}-${event.start.toISOString()}`} className="text-[11px] bg-blue-50 text-blue-900 rounded px-1 py-0.5 truncate">
            <p className="font-medium truncate">{event.summary}</p>
            <p>
              {format(event.start, 'h:mm a')} – {format(event.end, 'h:mm a')}
            </p>
          </div>
        ))}
        {dayEvents.length > 3 && (
          <p className="text-[11px] text-gray-500">+{dayEvents.length - 3} more</p>
        )}
      </>
    );
  };

  const computeMeetingStatus = (meeting: Meeting): Meeting['status'] => {
    if (meeting.status === 'cancelled') return 'cancelled';
    if (meeting.metadata?.poll_pending || meeting.status === 'polling') return 'polling';
    if (meeting.startTime <= currentTime && meeting.endTime > currentTime) return 'running';
    if (meeting.endTime <= currentTime) return 'completed';
    if (meeting.status === 'rescheduled') return 'rescheduled';
    return meeting.status;
  };

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
      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${colors[status] || 'bg-gray-100 text-gray-700'}`}>
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </span>
    );
  };

  const renderMeetingCard = (event: NormalizedEvent) => {
    const meeting = event.meeting;
    if (!meeting) {
      return (
        <div className="border rounded-lg p-4 bg-gray-50 text-sm text-gray-700 space-y-1">
          <div className="flex items-center justify-between">
            <p className="font-medium text-gray-900">{event.summary}</p>
            <span className="text-xs text-gray-500">Google Calendar</span>
          </div>
          <p className="text-sm text-gray-600">
            {format(event.start, 'h:mm a')} – {format(event.end, 'h:mm a')}
          </p>
          {event.location && <p className="text-xs text-gray-500 mt-1">{event.location}</p>}
        </div>
      );
    }

    const status = computeMeetingStatus(meeting);
    const locationType = (meeting.metadata?.location_type as 'online' | 'onsite') || 'online';
    const locationLabel =
      locationType === 'onsite'
        ? meeting.metadata?.room_name || 'Onsite'
        : 'Google Meet';
    const locationSubtext =
      locationType === 'onsite'
        ? meeting.metadata?.room_location || 'Office'
        : meeting.metadata?.meeting_url
        ? 'Link ready'
        : 'Link shared via invitation';

    const canModify = !['completed', 'cancelled'].includes(status);
    const canJoin = canModify && meeting.metadata?.meeting_url && locationType === 'online';
    const participantsPreview = meeting.participants.slice(0, 4);
    const extraParticipants = meeting.participants.length - participantsPreview.length;
    const pollId = meeting.metadata?.poll_id as string | undefined;
    const pollSummary = pollId ? pollSummaries?.[pollId] : undefined;
    const isPollOpen = meeting.metadata?.poll_pending || (pollSummary?.status === 'open');

    return (
      <div className="border rounded-xl p-5 bg-white shadow-sm space-y-4 hover:shadow transition">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <p className="font-semibold text-gray-900 text-base">{meeting.title}</p>
            <p className="text-sm text-gray-600">
              {format(meeting.startTime, 'EEE, MMM d · h:mm a')} – {format(meeting.endTime, 'h:mm a')}
            </p>
          </div>
          {renderStatusBadge(status)}
        </div>
        {meeting.description && (
          <div className="flex gap-3 text-sm text-gray-600">
            <span className="w-1 rounded-full bg-blue-200" />
            <p className="flex-1">
            {meeting.description.length > 180 ? `${meeting.description.slice(0, 177)}…` : meeting.description}
            </p>
          </div>
        )}
        {locationType === 'onsite' && (
          <div className="rounded-lg border border-gray-100 p-3 bg-gray-50 text-sm text-gray-700 space-y-1">
            <div className="font-medium">{locationLabel}</div>
            <p className="text-xs text-gray-500">{locationSubtext}</p>
          </div>
        )}
        <div>
          <p className="text-xs uppercase text-gray-500 mb-1">Participants</p>
          <div className="flex items-center gap-3">
            <div className="flex -space-x-2">
              {participantsPreview.map((participant) => (
                <div
                  key={participant.email}
                  className="h-8 w-8 rounded-full bg-gradient-to-br from-blue-100 to-blue-200 text-blue-700 flex items-center justify-center text-xs font-semibold border border-white"
                  title={participant.name || participant.email}
                >
                  {(participant.name || participant.email).charAt(0).toUpperCase()}
                </div>
              ))}
            </div>
            {extraParticipants > 0 && (
              <span className="text-xs text-gray-500">+{extraParticipants} more</span>
            )}
          </div>
          <p className="text-xs text-gray-500 mt-1">
            Organized by {meeting.organizerEmail || 'you'}
          </p>
        </div>
        {pollId && (
          <div className="rounded-lg border border-purple-100 p-3 bg-purple-50 text-sm text-purple-900 space-y-2">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <p className="font-semibold text-purple-900">Poll</p>
                <p className="text-xs text-purple-700">
                  {pollSummary
                    ? pollSummary.status === 'open'
                      ? 'Open for votes'
                      : 'Closed · awaiting finalization'
                    : meeting.metadata?.poll_pending
                    ? 'Collecting responses'
                    : 'Loading poll details...'}
                </p>
              </div>
              <a
                href={`/poll/${pollId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="px-3 py-1.5 text-xs font-semibold text-white bg-purple-600 rounded-md hover:bg-purple-700"
              >
                {isPollOpen ? 'Vote / view poll' : 'View poll'}
              </a>
            </div>
            {pollSummary && pollSummary.options.length > 0 && (
              <div className="space-y-1 text-xs text-purple-800">
                {pollSummary.options.slice(0, 3).map((option) => {
                  const start = new Date(option.start_time);
                  const end = new Date(option.end_time);
                  return (
                    <div key={option.id} className="flex items-center justify-between">
                      <span>
                        {format(start, 'MMM d · h:mm a')} – {format(end, 'h:mm a')}
                      </span>
                      <span className="font-semibold">{option.votes} votes</span>
                    </div>
                  );
                })}
                {pollSummary.options.length > 3 && (
                  <p className="text-[11px] text-purple-600">
                    +{pollSummary.options.length - 3} more options
                  </p>
                )}
              </div>
            )}
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          {canJoin && meeting.metadata?.meeting_url && (
            <a
              href={meeting.metadata.meeting_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center px-3 py-2 text-xs font-semibold text-white bg-blue-600 rounded-md hover:bg-blue-700"
            >
              Join Meeting
            </a>
          )}
          {onEditMeeting && canModify && (
            <button
              type="button"
              className="inline-flex items-center px-3 py-2 text-xs font-semibold text-blue-600 bg-blue-50 rounded-md hover:bg-blue-100"
              onClick={() => onEditMeeting(meeting)}
            >
              Edit
            </button>
          )}
          {onDeleteMeeting && canModify && (
            <button
              type="button"
              className="inline-flex items-center px-3 py-2 text-xs font-semibold text-red-600 bg-red-50 rounded-md hover:bg-red-100"
              onClick={() => onDeleteMeeting(meeting)}
            >
              Delete
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="bg-white rounded-lg shadow p-4">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-4">
        <div>
          <p className="text-sm uppercase tracking-wide text-gray-500">Calendar · week view</p>
          <h3 className="text-2xl font-semibold text-gray-900">
            {format(weekStart, 'MMM d')} – {format(addDays(weekStart, 6), 'MMM d, yyyy')}
          </h3>
          <p className="text-xs text-gray-500 mt-1">Your timezone: {timezone}</p>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <button
            type="button"
            onClick={() => setWeekStart((prev) => addWeeks(prev, -1))}
            className="px-3 py-2 border rounded-md text-sm text-gray-700 hover:bg-gray-50"
          >
            ← Previous week
          </button>
          <button
            type="button"
            onClick={() => {
              const todayWeek = startOfWeek(new Date(), { weekStartsOn: 1 });
              setWeekStart(todayWeek);
              setSelectedDate(new Date());
            }}
            className="px-3 py-2 border rounded-md text-sm text-gray-700 hover:bg-gray-50"
          >
            Today
          </button>
          <button
            type="button"
            onClick={() => setWeekStart((prev) => addWeeks(prev, 1))}
            className="px-3 py-2 border rounded-md text-sm text-gray-700 hover:bg-gray-50"
          >
            Next week →
          </button>
          <input
            type="month"
            value={format(weekStart, 'yyyy-MM')}
            onChange={handleMonthInput}
            className="px-3 py-2 border rounded-md text-sm text-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
      </div>

      <div className="grid grid-cols-7 text-xs font-semibold text-gray-500 border-b border-gray-100 pb-2">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((label) => (
          <div key={label} className="text-center uppercase tracking-wide">
            {label}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-2 mt-2">
        {weekDays.map((day) => {
          const isToday = isSameDay(day, today);
          const isSelected = selectedDate ? isSameDay(selectedDate, day) : false;
          return (
            <button
              key={day.toISOString()}
              type="button"
              onClick={() => setSelectedDate(day)}
              className={[
                'border rounded-md p-2 text-left transition-all h-36 flex flex-col',
                isToday ? 'border-blue-500' : 'border-gray-200',
                isSelected ? 'ring-2 ring-blue-400' : '',
                'bg-white',
              ].join(' ')}
            >
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-900 font-medium">{format(day, 'EEE d')}</span>
                {isToday && <span className="text-[10px] font-semibold text-blue-600 uppercase">Today</span>}
              </div>
              <div className="mt-2 space-y-1 overflow-y-auto pr-1 flex-1">
                {renderDayEvents(day)}
              </div>
            </button>
          );
        })}
      </div>

      {selectedDate && (
        <div className="mt-4 border-t pt-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-medium text-gray-700">{format(selectedDate, 'EEEE, MMMM d, yyyy')}</p>
            <span className="text-xs text-gray-500">
              {normalizedEvents.filter((event) => isSameDay(event.start, selectedDate)).length} events
            </span>
          </div>
          <div className="space-y-3 max-h-72 overflow-y-auto">
            {normalizedEvents.filter((event) => isSameDay(event.start, selectedDate)).length === 0 ? (
              <p className="text-sm text-gray-500">No events scheduled for this day.</p>
            ) : (
              normalizedEvents
                .filter((event) => isSameDay(event.start, selectedDate))
                .map((event) => (
                  <div key={`${event.id}-${event.start.toISOString()}`}>{renderMeetingCard(event)}</div>
                ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};
