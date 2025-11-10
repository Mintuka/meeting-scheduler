import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import {
  Calendar,
  Loader2,
  CheckCircle,
  Clock,
  MapPin,
  Video,
  AlertCircle,
  RefreshCw,
  PlusCircle,
  MinusCircle,
  X,
} from 'lucide-react';
import { AvailabilitySuggestion, MeetingFormData, Meeting, Room, RoomAvailability, Poll } from '../types';
import { AISchedulerService } from '../services/AISchedulerService';
import { notificationService } from '../services/NotificationService';

interface MeetingCreationMeta {
  isPollOnly: boolean;
  participantCount: number;
  createdPoll?: Poll | null;
}

interface MeetingFormProps {
  onMeetingCreated: (meeting: Meeting, meta: MeetingCreationMeta) => void;
}

const formatDateInput = (date: Date) => {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

const formatTimeInput = (date: Date) => {
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
};

const buildDateTime = (dateStr?: string, timeStr?: string) => {
  if (!dateStr || !timeStr) return null;
  const [year, month, day] = dateStr.split('-').map(Number);
  const [hour, minute] = timeStr.split(':').map(Number);
  if ([year, month, day, hour, minute].some((v) => Number.isNaN(v))) {
    return null;
  }
  return new Date(year, month - 1, day, hour, minute, 0, 0);
};

const computeDefaultPollDeadline = () => {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setMinutes(tomorrow.getMinutes() - tomorrow.getTimezoneOffset());
  return tomorrow.toISOString().slice(0, 16);
};

export const MeetingForm: React.FC<MeetingFormProps> = ({ onMeetingCreated }) => {
  const [isLoading, setIsLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [participants, setParticipants] = useState<string[]>([]);
  const [newParticipant, setNewParticipant] = useState('');
  const [suggestions, setSuggestions] = useState<AvailabilitySuggestion[]>([]);
  const [participantsMissing, setParticipantsMissing] = useState<string[]>([]);
  const [participantsMissingDetails, setParticipantsMissingDetails] = useState<Record<string, string>>({});
  const [isSuggesting, setIsSuggesting] = useState(false);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [roomsLoading, setRoomsLoading] = useState(true);
  const [roomsError, setRoomsError] = useState<string | null>(null);
  const [roomAvailability, setRoomAvailability] = useState<RoomAvailability[]>([]);
  const [roomAvailabilityLoading, setRoomAvailabilityLoading] = useState(false);
  const [roomAvailabilityError, setRoomAvailabilityError] = useState<string | null>(null);
  const [selectedPollOptions, setSelectedPollOptions] = useState<AvailabilitySuggestion[]>([]);
  const [pollDeadline, setPollDeadline] = useState(() => computeDefaultPollDeadline());
  const [hasGeneratedSuggestions, setHasGeneratedSuggestions] = useState(false);
  const [hasChosenTime, setHasChosenTime] = useState(false);
  const [manualTimeMode, setManualTimeMode] = useState(false);
  const [selectedSuggestionId, setSelectedSuggestionId] = useState<string | null>(null);
  const timezone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);
  const [justAddedPollOptionId, setJustAddedPollOptionId] = useState<string | null>(null);
  const canShowFinalize = manualTimeMode || hasChosenTime;
  const shouldShowPollBuilder = hasGeneratedSuggestions && !manualTimeMode && !hasChosenTime;
  const isPollOnly = selectedPollOptions.length > 0 && !canShowFinalize;

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
    reset,
    setError,
    setValue,
    clearErrors,
  } = useForm<MeetingFormData>({
    defaultValues: {
      durationMinutes: 60,
      locationType: 'online',
      roomId: '',
    },
  });
  const roomIdRegister = register('roomId', {
    onChange: () => clearErrors('roomId'),
  });

  const watchPreferredDate = watch('preferredDate');
  const watchDuration = watch('durationMinutes');
  const watchLocationType = watch('locationType');
  const watchStartTime = watch('startTime');
  const watchEndTime = watch('endTime');
  const selectedRoomId = watch('roomId');

  const selectedRoom = useMemo(
    () => rooms.find((room) => room.id === selectedRoomId),
    [rooms, selectedRoomId]
  );

  const mergedRoomAvailability = useMemo(() => {
    if (!roomAvailability.length) return rooms.map((room) => ({ ...room, status: null as null | boolean }));
    return rooms.map((room) => {
      const slot = roomAvailability.find((entry) => entry.id === room.id);
      return {
        ...room,
        status: slot?.is_available ?? null,
        conflicts: slot?.conflicts ?? [],
      };
    });
  }, [rooms, roomAvailability]);

  const selectedRoomAvailability = roomAvailability.find((entry) => entry.id === selectedRoomId);
  const resetKey = useMemo(
    () => `${watchPreferredDate ?? ''}|${watchDuration ?? ''}|${participants.join(',')}`,
    [watchPreferredDate, watchDuration, participants]
  );
  const prevResetKeyRef = useRef(resetKey);

  const computeMeetingTimes = useCallback(() => {
    const start = buildDateTime(watchPreferredDate, watchStartTime);
    const end = buildDateTime(watchPreferredDate, watchEndTime);
    if (!start || !end || end <= start) {
      return null;
    }
    return { start, end };
  }, [watchPreferredDate, watchStartTime, watchEndTime]);

  const addParticipant = () => {
    if (newParticipant && !participants.includes(newParticipant)) {
      setParticipants([...participants, newParticipant]);
      setNewParticipant('');
    }
  };

  const removeParticipant = (email: string) => {
    setParticipants(participants.filter(p => p !== email));
  };

  const clearSuggestionState = useCallback(() => {
    setSuggestions([]);
    setHasGeneratedSuggestions(false);
    setHasChosenTime(false);
    setManualTimeMode(false);
    setSelectedSuggestionId(null);
    setSelectedPollOptions([]);
    setPollDeadline(computeDefaultPollDeadline());
    setParticipantsMissing([]);
    setParticipantsMissingDetails({});
  }, []);

  useEffect(() => {
    if (manualTimeMode) {
      setHasChosenTime(Boolean(watchStartTime && watchEndTime));
    }
  }, [manualTimeMode, watchStartTime, watchEndTime]);

  useEffect(() => {
    if (!justAddedPollOptionId) return;
    const timeout = setTimeout(() => setJustAddedPollOptionId(null), 2000);
    return () => clearTimeout(timeout);
  }, [justAddedPollOptionId]);

  useEffect(() => {
    if (prevResetKeyRef.current === resetKey) {
      return;
    }
    prevResetKeyRef.current = resetKey;
    if (
      hasGeneratedSuggestions ||
      hasChosenTime ||
      manualTimeMode ||
      suggestions.length > 0 ||
      selectedPollOptions.length > 0
    ) {
      clearSuggestionState();
    }
  }, [resetKey, hasGeneratedSuggestions, hasChosenTime, manualTimeMode, suggestions.length, selectedPollOptions.length, clearSuggestionState]);

  const onSubmit = async (data: MeetingFormData) => {
    if (participants.length === 0) {
      notificationService.warning('No Participants', 'Please add at least one participant');
      return;
    }
    let startTime = buildDateTime(data.preferredDate, data.startTime);
    let endTime = buildDateTime(data.preferredDate, data.endTime);
    const now = new Date();

    if (!isPollOnly) {
      if (!startTime || !endTime) {
        setError('preferredDate', { type: 'validate', message: 'Choose a valid date and time' });
        return;
      }
      if (startTime <= now) {
        setError('startTime', { type: 'validate', message: 'Start time must be in the future' });
        return;
      }
      if (endTime <= startTime) {
        setError('endTime', { type: 'validate', message: 'End time must be after start time' });
        return;
      }
      const diffMs = endTime.getTime() - startTime.getTime();
      if (diffMs < 5 * 60 * 1000) {
        setError('endTime', { type: 'validate', message: 'Meeting must be at least 5 minutes long' });
        return;
      }
    }

    if (isPollOnly) {
      const primary = selectedPollOptions[0];
      startTime = new Date(primary.start);
      endTime = new Date(primary.end);
    }

    if (!startTime || !endTime) {
      notificationService.error('Time missing', 'Unable to determine meeting start/end time. Please try again.');
      return;
    }

    if (data.locationType === 'onsite' && !data.roomId) {
      setError('roomId', { type: 'validate', message: 'Select a room for onsite meetings' });
      return;
    }
    if (!isPollOnly && !hasChosenTime) {
      notificationService.warning('Choose a slot', 'Select a suggested time or enable manual entry before scheduling.');
      return;
    }

    const overridePreferredDate = formatDateInput(startTime);
    const overrideStart = formatTimeInput(startTime);
    const overrideEnd = formatTimeInput(endTime);

    setIsLoading(true);
    try {
      const formData: MeetingFormData = {
        ...data,
        participants,
        startTime: overrideStart,
        endTime: overrideEnd,
        preferredDate: overridePreferredDate,
        preferredTimeSlots: [],
        clientTimezone: timezone,
        manualTimeMode,
        selectedSuggestionStart: selectedSuggestionId,
        pollPending: isPollOnly,
      };

      let meeting = await AISchedulerService.createMeeting(formData);
      let createdPoll: Poll | null = null;

      if (selectedPollOptions.length > 0) {
        try {
          const poll = await AISchedulerService.createPoll(
            meeting.id,
            selectedPollOptions.map((slot) => ({ start: slot.start, end: slot.end })),
            pollDeadline ? new Date(pollDeadline) : undefined
          );
          meeting = await AISchedulerService.getMeeting(meeting.id);
          createdPoll = poll;
        } catch (pollError) {
          console.error('Poll creation failed', pollError);
          notificationService.error('Poll Error', 'Meeting created but poll creation failed.');
        }
      }

      if (!isPollOnly) {
        await AISchedulerService.sendMeetingInvitation(meeting);
      }

      setIsSuccess(true);
      onMeetingCreated(meeting, {
        isPollOnly,
        participantCount: meeting.participants.length,
        createdPoll,
      });
      reset({
        durationMinutes: 60,
        locationType: 'online',
        roomId: '',
      });
      setParticipants([]);
      clearSuggestionState();
      setRoomAvailability([]);
      setRoomAvailabilityError(null);
      
      setTimeout(() => setIsSuccess(false), 3000);
    } catch (error) {
      console.error('Error creating meeting:', error);
      notificationService.failedToCreateMeeting('Failed to create meeting. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSuggestTimes = async () => {
    if (!watchPreferredDate) {
      setError('preferredDate', { type: 'validate', message: 'Pick a preferred date to suggest times' });
      return;
    }
    if (participants.length === 0) {
      notificationService.warning('Participants missing', 'Add at least one participant before suggesting times.');
      return;
    }
    if (!watchDuration || watchDuration < 5) {
      setError('durationMinutes', { type: 'validate', message: 'Duration must be at least 5 minutes' });
      return;
    }
    const [year, month, day] = watchPreferredDate.split('-').map(Number);
    const windowStart = new Date(year, month - 1, day, 0, 0, 0, 0);
    const windowEnd = new Date(windowStart.getTime() + 24 * 60 * 60 * 1000);
    const now = new Date();
    if (windowEnd <= now) {
      notificationService.warning('Past date', 'Suggestions must be requested for today or a future date.');
      return;
    }

    setIsSuggesting(true);
    try {
      const response = await AISchedulerService.suggestAvailability({
        participants,
        durationMinutes: watchDuration,
        windowStart,
        windowEnd,
        slotIncrementMinutes: 30,
        maxSuggestions: 5,
        clientTimezone: timezone,
      });
      setSuggestions(response.suggestions);
      setParticipantsMissing(response.participants_missing || []);
      setParticipantsMissingDetails(response.participants_missing_details || {});
      setHasGeneratedSuggestions(true);
      setManualTimeMode(false);
      setHasChosenTime(false);
      setSelectedSuggestionId(null);
      setSelectedPollOptions([]);
      setPollDeadline(computeDefaultPollDeadline());

      if (response.suggestions.length === 0) {
        notificationService.info(
          'No slots found',
          'We could not find an overlapping free window. Consider creating a poll.'
        );
      }
    } catch (error) {
      console.error('Suggestion error', error);
      notificationService.error('Availability error', 'Unable to fetch suggestions. Try again shortly.');
    } finally {
      setIsSuggesting(false);
    }
  };

  const applySuggestion = (slot: AvailabilitySuggestion) => {
    const isAlreadySelected = selectedSuggestionId === slot.start;
    if (isAlreadySelected) {
      setSelectedSuggestionId(null);
      setHasChosenTime(false);
      setValue('startTime', '');
      setValue('endTime', '');
      return;
    }
    if (selectedPollOptions.length > 0) {
      setSelectedPollOptions([]);
      setJustAddedPollOptionId(null);
      setPollDeadline(computeDefaultPollDeadline());
    }
    const startDate = new Date(slot.start);
    const endDate = new Date(slot.end);
    setValue('preferredDate', formatDateInput(startDate));
    setValue('startTime', formatTimeInput(startDate));
    setValue('endTime', formatTimeInput(endDate));
    setSelectedSuggestionId(slot.start);
    setHasChosenTime(true);
    setManualTimeMode(false);
  };

  const addPollOption = (slot: AvailabilitySuggestion) => {
    if (!hasGeneratedSuggestions) {
      notificationService.warning('Suggestions required', 'Generate availability suggestions before collecting poll options.');
      return;
    }
    if (manualTimeMode || hasChosenTime) {
      notificationService.warning('Time already selected', 'Remove the selected time if you want to collect votes via a poll.');
      return;
    }
    if (selectedPollOptions.some((option) => option.start === slot.start && option.end === slot.end)) {
      return;
    }
    setSelectedPollOptions((prev) => [...prev, slot]);
    setJustAddedPollOptionId(slot.start);
  };

  const removePollOption = (slotStart: string) => {
    setSelectedPollOptions((prev) => prev.filter((slot) => slot.start !== slotStart));
  };

  const fetchRooms = useCallback(async () => {
    setRoomsLoading(true);
    setRoomsError(null);
    try {
      const fetched = await AISchedulerService.getRooms();
      setRooms(fetched);
    } catch (error) {
      console.error('Failed to load rooms', error);
      setRoomsError('Unable to load onsite rooms. Please retry later.');
    } finally {
      setRoomsLoading(false);
    }
  }, []);

  const fetchRoomAvailability = useCallback(async () => {
    if (watchLocationType !== 'onsite') {
      setRoomAvailability([]);
      return;
    }
    const windows = computeMeetingTimes();
    if (!windows) {
      setRoomAvailability([]);
      return;
    }
    setRoomAvailabilityLoading(true);
    setRoomAvailabilityError(null);
    try {
      const availability = await AISchedulerService.getRoomAvailability(windows.start, windows.end);
      setRoomAvailability(availability);
    } catch (error) {
      console.error('Room availability error', error);
      setRoomAvailabilityError('Unable to check room availability for this time range.');
    } finally {
      setRoomAvailabilityLoading(false);
    }
  }, [watchLocationType, computeMeetingTimes]);

  useEffect(() => {
    fetchRooms();
  }, [fetchRooms]);

  useEffect(() => {
    fetchRoomAvailability();
  }, [fetchRoomAvailability, watchLocationType, watchPreferredDate, watchStartTime, watchEndTime]);

  useEffect(() => {
    if (watchLocationType === 'online') {
      setValue('roomId', '');
      clearErrors('roomId');
      setRoomAvailability([]);
    }
  }, [watchLocationType, setValue, clearErrors]);

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Meeting Scheduler</h2>
        <p className="text-gray-600">Coordinate calendars, polls, and final details in a single workflow.</p>
      </div>

      {isSuccess && (
        <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-lg flex items-center">
          <CheckCircle className="h-5 w-5 text-green-500 mr-2" />
          <span className="text-green-700">Meeting created successfully! Invitations sent.</span>
        </div>
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
        <div className="mb-2">
          <p className="text-xs uppercase tracking-wide text-gray-500">Step 1 · Meeting basics</p>
        </div>
        {/* Meeting Title */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Meeting Title
          </label>
          <input
            type="text"
            {...register('title', { required: 'Meeting title is required' })}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            placeholder="Enter meeting title"
          />
          {errors.title && (
            <p className="mt-1 text-sm text-red-600">{errors.title.message}</p>
          )}
        </div>

        {/* Meeting Description */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Description
          </label>
          <textarea
            {...register('description', { required: 'Description is required' })}
            rows={3}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            placeholder="Enter meeting description"
          />
          {errors.description && (
            <p className="mt-1 text-sm text-red-600">{errors.description.message}</p>
          )}
        </div>

        <div className="mb-2 mt-6">
          <p className="text-xs uppercase tracking-wide text-gray-500">Step 2 · Participants</p>
        </div>
        {/* Participants */}
        <div className="bg-gray-50 border border-gray-200 rounded-md p-4 space-y-3">
          <div className="flex items-center justify-between">
            <label className="block text-sm font-medium text-gray-700">
              Participants
            </label>
            <span className="text-xs text-gray-500">
              Add everyone who should attend before requesting suggestions
            </span>
          </div>
          <div className="flex gap-2">
            <input
              type="email"
              value={newParticipant}
              onChange={(e) => setNewParticipant(e.target.value)}
              className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="Enter email address"
            />
            <button
              type="button"
              onClick={addParticipant}
              className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              Add
            </button>
          </div>
          {participants.length === 0 && (
            <p className="text-xs text-gray-500">You need at least one participant to generate availability.</p>
          )}
          {participants.length > 0 && (
            <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
              {participants.map((email) => (
                <div key={email} className="flex items-center justify-between p-2 bg-white rounded-md border border-gray-200">
                  <span className="text-sm text-gray-700">{email}</span>
                  <button
                    type="button"
                    onClick={() => removeParticipant(email)}
                    className="text-red-500 hover:text-red-700 text-xs"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="mb-2 mt-6">
          <p className="text-xs uppercase tracking-wide text-gray-500">Step 3 · Scheduling window</p>
        </div>
        {/* Meeting Date */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Meeting Date
          </label>
          <input
            type="date"
            {...register('preferredDate', { required: 'Meeting date is required' })}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          {errors.preferredDate && (
            <p className="mt-1 text-sm text-red-600">{errors.preferredDate.message}</p>
          )}
        </div>

        {/* Duration */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Meeting Duration (minutes)</label>
          <input
            type="number"
            min={5}
            {...register('durationMinutes', {
              valueAsNumber: true,
              min: { value: 5, message: 'Duration must be at least 5 minutes' },
            })}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          {errors.durationMinutes && (
            <p className="mt-1 text-sm text-red-600">{errors.durationMinutes.message}</p>
          )}
        </div>

        {/* Suggestion Controls */}
        <div className="border rounded-md p-4 bg-gray-50">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 mb-3">
            <div>
              <p className="text-sm font-medium text-gray-700 flex items-center gap-2">
                <Clock className="h-4 w-4" />
                Smart availability suggestions
              </p>
              <p className="text-xs text-gray-500 mt-1">
                Suggestions consider each participant&apos;s Google Calendar in your timezone ({timezone}).
              </p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  clearSuggestionState();
                  setManualTimeMode(false);
                  handleSuggestTimes();
                }}
                className={`inline-flex items-center px-3 py-2 rounded-md text-sm focus:outline-none ${
                  !manualTimeMode ? 'bg-blue-600 text-white shadow-sm' : 'border border-gray-300 text-gray-700 hover:bg-white'
                }`}
                disabled={isSuggesting || participants.length === 0}
              >
                {isSuggesting && !manualTimeMode && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {manualTimeMode ? 'Use suggested times' : 'Get suggestions'}
              </button>
              <button
                type="button"
                onClick={() => {
                  clearSuggestionState();
                  setManualTimeMode(true);
                  setHasGeneratedSuggestions(true);
                }}
                className={`px-3 py-2 rounded-md text-sm focus:outline-none ${
                  manualTimeMode ? 'bg-blue-600 text-white shadow-sm' : 'border border-gray-300 text-gray-700 hover:bg-white'
                }`}
              >
                I&apos;ll set the time manually
              </button>
            </div>
          </div>
          {participants.length === 0 && (
            <p className="text-xs text-red-500">Add participants first to unlock suggestions.</p>
          )}
        </div>

        {!manualTimeMode && (
          <>
            <div className="mb-2 mt-6">
              <p className="text-xs uppercase tracking-wide text-gray-500">Step 4 · Availability suggestions</p>
            </div>
            {/* Availability Suggestions */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-gray-700 flex items-center gap-2">
                  <Clock className="h-4 w-4" />
                  Suggested time slots
                </p>
                {hasGeneratedSuggestions && (
                  <button
                    type="button"
                    className="text-sm text-gray-500 hover:text-gray-700"
                    onClick={clearSuggestionState}
                  >
                    Clear selection
                  </button>
                )}
              </div>
              {participantsMissing.length > 0 && (
                <div className="bg-yellow-50 border border-yellow-200 rounded-md p-3 text-sm text-yellow-900 flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 mt-0.5" />
                  <div>
                    <p>Waiting on calendar access from:</p>
                    <ul className="list-disc list-inside text-xs text-yellow-800 mt-1 space-y-1">
                      {participantsMissing.map(email => (
                        <li key={email}>
                          <span className="font-medium">{email}</span>
                          {participantsMissingDetails[email] ? ` – ${participantsMissingDetails[email]}` : null}
                        </li>
                      ))}
                    </ul>
                    <p className="text-xs text-yellow-700 mt-2">
                      Ask them to connect Google Calendar inside Meeting Scheduler so we can read availability.
                    </p>
                  </div>
                </div>
              )}
              {!hasGeneratedSuggestions && (
                <p className="text-xs text-gray-500">
                  Use “Get suggestions” above to preview recommended time slots. Start and end time fields stay locked until
                  you select a slot or opt into manual entry.
                </p>
              )}
              {hasGeneratedSuggestions && !manualTimeMode && suggestions.length === 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-md p-3 text-sm text-amber-900">
                  We couldn&apos;t find overlapping busy-free time. Consider creating a poll with a few preferred options.
                </div>
              )}
              {hasGeneratedSuggestions && !manualTimeMode && suggestions.length > 0 && (
                <div className="space-y-2">
                  {suggestions.map((slot) => {
                      const start = new Date(slot.start);
                      const end = new Date(slot.end);
                const label = `${start.toLocaleString(undefined, { timeZoneName: 'short' })} → ${end.toLocaleTimeString(undefined, { timeZoneName: 'short' })}`;
                const slotKey = slot.start;
                const isSelected = selectedSuggestionId === slot.start;
                const isInPoll = selectedPollOptions.some(option => option.start === slot.start && option.end === slot.end);
                return (
                        <div
                          key={slotKey}
                          className={[
                            'border rounded-md p-3 flex flex-col md:flex-row md:items-center md:justify-between gap-2',
                            isSelected ? 'border-blue-500 bg-blue-50' : 'border-gray-200',
                          ].join(' ')}
                        >
                          <div>
                            <p className="font-medium text-gray-900">{label}</p>
                            <p className="text-sm text-gray-500">
                              {(end.getTime() - start.getTime()) / (1000 * 60)} minutes · Local timezone ({timezone})
                            </p>
                          </div>
                          <div className="flex flex-col sm:flex-row gap-2 w-full sm:justify-end">
                            <button
                              type="button"
                              onClick={() => applySuggestion(slot)}
                              className={`w-full sm:w-36 min-h-[40px] px-3 py-1 inline-flex items-center justify-center rounded-md text-sm font-medium ${
                                isSelected ? 'bg-blue-100 text-blue-700 border border-blue-600' : 'bg-blue-600 text-white hover:bg-blue-700'
                              }`}
                            >
                              {isSelected ? 'Clear selection' : 'Use slot'}
                            </button>
                            <button
                              type="button"
                              onClick={() => (isInPoll ? removePollOption(slot.start) : addPollOption(slot))}
                              className={`w-full sm:w-36 min-h-[40px] px-3 py-1 inline-flex items-center justify-center gap-1 border rounded-md text-sm font-medium ${
                                isInPoll
                                  ? 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100'
                                  : 'border-gray-300 hover:bg-gray-50'
                              }`}
                            >
                              {isInPoll ? <MinusCircle className="h-4 w-4" /> : <PlusCircle className="h-4 w-4" />}
                              {isInPoll ? 'Remove' : 'Add to poll'}
                            </button>
                          </div>
                  </div>
                );
                    })}
                  </div>
                )}
            </div>
          </>
        )}

        {/* Poll Builder */}
        {shouldShowPollBuilder && (
          <>
          <div className="mb-2 mt-6">
            <p className="text-xs uppercase tracking-wide text-gray-500">Step 6 · Optional poll</p>
          </div>
          <div className="space-y-3 border rounded-md p-3 border-purple-200 bg-purple-50">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-purple-900 flex items-center gap-2">
                <Calendar className="h-4 w-4" />
                Poll options ({selectedPollOptions.length})
              </p>
              {selectedPollOptions.length === 0 && (
                <span className="text-xs text-purple-700">Add one or more suggested slots to collect votes</span>
              )}
            </div>
            {selectedPollOptions.length > 0 ? (
              <>
                <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
                  {selectedPollOptions.map((slot) => (
                    <div key={slot.start} className="flex items-center justify-between text-sm bg-white rounded-md px-3 py-2 shadow-sm">
                      <span>{new Date(slot.start).toLocaleString()} - {new Date(slot.end).toLocaleTimeString()}</span>
                      <button
                        type="button"
                        className="text-red-500 hover:text-red-700"
                        onClick={() => removePollOption(slot.start)}
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
                <div>
                  <label className="block text-xs font-medium text-purple-900 mb-1">Poll deadline (optional)</label>
                  <input
                    type="datetime-local"
                    value={pollDeadline}
                    onChange={(event) => setPollDeadline(event.target.value)}
                    className="w-full px-3 py-2 border border-purple-200 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                  />
                </div>
              </>
            ) : (
              <p className="text-xs text-purple-700">
                Click “Add to poll” next to any suggestion above to prepare a poll for participants.
              </p>
            )}
          </div>
          </>
        )}

        {canShowFinalize ? (
          <>
            <div className="mb-2 mt-6">
              <p className="text-xs uppercase tracking-wide text-gray-500">Step 5 · Finalize time & location</p>
            </div>
            <div className={`border rounded-md p-4 ${!hasGeneratedSuggestions && !manualTimeMode ? 'bg-gray-50 border-dashed' : 'bg-white'}`}>
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm font-medium text-gray-700">Select the final start and end time</p>
                {manualTimeMode && (
                  <span className="text-xs text-gray-500">
                    Manual mode enabled · times will use your local timezone ({timezone})
                  </span>
                )}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Start Time
                  </label>
                  <input
                    type="time"
                    {...register('startTime', { required: 'Start time is required' })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="Select start time"
                    disabled={!manualTimeMode && !hasChosenTime}
                    readOnly={!manualTimeMode}
                  />
                  {errors.startTime && (
                    <p className="mt-1 text-sm text-red-600">{errors.startTime.message}</p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    End Time
                  </label>
                  <input
                    type="time"
                    {...register('endTime', { required: 'End time is required' })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="Select end time"
                    disabled={!manualTimeMode && !hasChosenTime}
                    readOnly={!manualTimeMode}
                  />
                  {errors.endTime && (
                    <p className="mt-1 text-sm text-red-600">{errors.endTime.message}</p>
                  )}
                  <p className="mt-1 text-xs text-gray-500">End time must be after start time and at least 5 minutes later</p>
                </div>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2 mt-4">Location</label>
              <div className="flex flex-col gap-3 md:flex-row">
                <label className={`flex-1 border rounded-md p-3 cursor-pointer ${watchLocationType === 'online' ? 'border-blue-500 bg-blue-50' : 'border-gray-200'}`}>
                  <div className="flex items-center gap-3">
                    <input
                      type="radio"
                      value="online"
                      className="h-4 w-4"
                      {...register('locationType')}
                    />
                    <div>
                      <p className="font-semibold text-gray-900 flex items-center gap-2">
                        <Video className="h-4 w-4" /> Online (Google Meet)
                      </p>
                      <p className="text-sm text-gray-500">Automatically generates a Meet link</p>
                    </div>
                  </div>
                </label>
                <label className={`flex-1 border rounded-md p-3 cursor-pointer ${watchLocationType === 'onsite' ? 'border-blue-500 bg-blue-50' : 'border-gray-200'}`}>
                  <div className="flex items-center gap-3">
                    <input
                      type="radio"
                      value="onsite"
                      className="h-4 w-4"
                      {...register('locationType')}
                    />
                    <div>
                      <p className="font-semibold text-gray-900 flex items-center gap-2">
                        <MapPin className="h-4 w-4" /> Onsite (reserve a room)
                      </p>
                      <p className="text-sm text-gray-500">Choose an available conference space</p>
                    </div>
                  </div>
                </label>
              </div>
            </div>

            {watchLocationType === 'onsite' && (
              <div className="mt-4 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-gray-700 flex items-center gap-2">
                    <MapPin className="h-4 w-4" /> Available Rooms
                  </p>
                  <button
                    type="button"
                    onClick={fetchRoomAvailability}
                    className="inline-flex items-center text-sm text-blue-600 hover:text-blue-800"
                  >
                    <RefreshCw className={`h-4 w-4 mr-1 ${roomAvailabilityLoading ? 'animate-spin' : ''}`} />
                    Refresh availability
                  </button>
                </div>
                {(!watchStartTime || !watchEndTime) && (
                  <p className="text-xs text-gray-500">
                    Select a start and end time above to check which rooms are available.
                  </p>
                )}
                {roomsError && <p className="text-sm text-red-600">{roomsError}</p>}
                {roomAvailabilityError && <p className="text-sm text-red-600">{roomAvailabilityError}</p>}
                {watchStartTime && watchEndTime && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-72 overflow-y-auto pr-1">
                    {roomsLoading ? (
                      <div className="col-span-2 flex items-center justify-center py-6 text-gray-500">
                        <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                        Loading rooms...
                      </div>
                    ) : mergedRoomAvailability.length === 0 ? (
                      <div className="col-span-2 text-sm text-gray-500">No rooms configured.</div>
                    ) : (
                      mergedRoomAvailability.map((room) => {
                        const isSelected = selectedRoomId === room.id;
                        const availabilityState = room.status;
                        return (
                          <label
                            key={room.id}
                            className={`border rounded-md p-3 cursor-pointer transition ${
                              isSelected ? 'border-blue-500 shadow-sm bg-blue-50' : 'border-gray-200 hover:border-blue-300'
                            }`}
                          >
                            <input
                              type="radio"
                              value={room.id}
                              {...roomIdRegister}
                              className="sr-only"
                            />
                            <div className="flex items-center justify-between">
                              <p className="font-semibold text-gray-900">{room.name}</p>
                              <span
                                className={`text-xs px-2 py-0.5 rounded-full ${
                                  availabilityState === null
                                    ? 'bg-gray-100 text-gray-700'
                                    : availabilityState
                                    ? 'bg-green-100 text-green-800'
                                    : 'bg-red-100 text-red-700'
                                }`}
                              >
                                {availabilityState === null ? 'Select time to check' : availabilityState ? 'Available' : 'Booked'}
                              </span>
                            </div>
                            <p className="text-sm text-gray-600 mt-1">{room.location}</p>
                            <p className="text-xs text-gray-500 mt-1">
                              Capacity {room.capacity} · {room.features.slice(0, 2).join(', ')}
                              {room.features.length > 2 ? '…' : ''}
                            </p>
                          </label>
                        );
                      })
                    )}
                  </div>
                )}
                {errors.roomId && <p className="text-sm text-red-600">{errors.roomId.message}</p>}
                {selectedRoom && (
                  <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
                    <p className="font-medium">{selectedRoom.name}</p>
                    <p>{selectedRoom.location}</p>
                    <p>Seats {selectedRoom.capacity} · {selectedRoom.features.join(', ')}</p>
                    {selectedRoom.notes && <p className="text-xs mt-1 text-blue-800">{selectedRoom.notes}</p>}
                    {selectedRoomAvailability && selectedRoomAvailability.conflicts.length > 0 && (
                      <div className="mt-2 text-xs text-red-700 flex items-center gap-2">
                        <AlertCircle className="h-4 w-4" />
                        Conflicts with {selectedRoomAvailability.conflicts[0].title}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </>
        ) : (
          <div className="border border-dashed rounded-md p-4 bg-gray-50 text-xs text-gray-600 mt-4">
            Complete steps 1–4 above, then select a suggested slot or enable manual entry to configure the final
            start/end time and meeting location.
          </div>
        )}

        {/* Submit Button */}
        <button
          type="submit"
          disabled={
            isLoading ||
            (!isPollOnly && !canShowFinalize) ||
            (!isPollOnly && watchLocationType === 'onsite' && !selectedRoomId)
          }
          className="w-full flex items-center justify-center px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isLoading ? (
            <>
              <Loader2 className="h-5 w-5 mr-2 animate-spin" />
              Scheduling meeting...
            </>
          ) : (
            <>
              <Calendar className="h-5 w-5 mr-2" />
              {isPollOnly ? 'Send poll' : 'Schedule Meeting'}
            </>
          )}
        </button>
      </form>
    </div>
  );
};
