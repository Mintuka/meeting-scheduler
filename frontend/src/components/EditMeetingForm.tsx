import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Calendar, Loader2, Save, Plus, X, MapPin, RefreshCw, AlertCircle } from 'lucide-react';
import { Meeting, Room, RoomAvailability } from '../types';
import { AISchedulerService } from '../services/AISchedulerService';
import { notificationService } from '../services/NotificationService';
import {
  buildDateTimeInTimeZone,
  formatDateInputValue,
  formatTimeInputValue,
  getMeetingTimeZone,
} from '../utils/timezone';

interface EditMeetingFormProps {
  meeting: Meeting;
  onClose: () => void;
  onUpdated: (meeting: Meeting, message?: string) => void;
}

interface EditFormData {
  title: string;
  description: string;
  preferredDate: string; // yyyy-MM-dd
  startTime: string; // HH:mm
  endTime: string; // HH:mm
  locationType: 'online' | 'onsite';
  roomId?: string;
}

export const EditMeetingForm: React.FC<EditMeetingFormProps> = ({ meeting, onClose, onUpdated }) => {
  const [isSaving, setIsSaving] = useState(false);
  const [participants, setParticipants] = useState<string[]>(meeting.participants.map(p => p.email));
  const [newParticipant, setNewParticipant] = useState('');
  const initialParticipantsRef = useRef<string[]>(meeting.participants.map(p => p.email));
  const [rooms, setRooms] = useState<Room[]>([]);
  const [roomsLoading, setRoomsLoading] = useState(true);
  const [roomsError, setRoomsError] = useState<string | null>(null);
  const [roomAvailability, setRoomAvailability] = useState<RoomAvailability[]>([]);
  const [roomAvailabilityLoading, setRoomAvailabilityLoading] = useState(false);
  const [roomAvailabilityError, setRoomAvailabilityError] = useState<string | null>(null);
  const meetingTimezone = useMemo(() => getMeetingTimeZone(meeting), [meeting]);
  const initialLocationType: 'online' | 'onsite' =
    (meeting.metadata?.location_type as 'online' | 'onsite') || (meeting.metadata?.room_id ? 'onsite' : 'online');
  const initialRoomId = meeting.metadata?.room_id || '';

  const { register, handleSubmit, reset, setError, clearErrors, setValue, watch, formState: { errors, isDirty } } = useForm<EditFormData>({
    defaultValues: {
      title: meeting.title,
      description: meeting.description,
      preferredDate: '',
      startTime: '',
      endTime: '',
      locationType: initialLocationType,
      roomId: initialRoomId,
    }
  });
  const roomIdRegister = register('roomId', {
    onChange: () => clearErrors('roomId'),
  });

  const watchLocationType = watch('locationType');
  const watchPreferredDate = watch('preferredDate');
  const watchStartTime = watch('startTime');
  const watchEndTime = watch('endTime');
  const selectedRoomId = watch('roomId');
  const selectedRoom = useMemo(
    () => rooms.find((room) => room.id === selectedRoomId),
    [rooms, selectedRoomId]
  );
  const selectedRoomAvailability = roomAvailability.find((entry) => entry.id === selectedRoomId);
  const mergedRoomAvailability = useMemo(() => {
    if (!rooms.length) {
      return [];
    }
    if (!roomAvailability.length) {
      return rooms.map((room) => ({ ...room, status: null as null | boolean }));
    }
    return rooms.map((room) => {
      const slot = roomAvailability.find((entry) => entry.id === room.id);
      return { ...room, status: slot?.is_available ?? null };
    });
  }, [rooms, roomAvailability]);
  const computeMeetingTimes = useCallback(() => {
    const start = buildDateTimeInTimeZone(watchPreferredDate, watchStartTime, meetingTimezone);
    const end = buildDateTimeInTimeZone(watchPreferredDate, watchEndTime, meetingTimezone);
    if (!start || !end || end <= start) {
      return null;
    }
    return { start, end };
  }, [watchPreferredDate, watchStartTime, watchEndTime, meetingTimezone]);

  const fetchRooms = useCallback(async () => {
    setRoomsLoading(true);
    setRoomsError(null);
    try {
      const fetched = await AISchedulerService.getRooms();
      setRooms(fetched);
    } catch (error) {
      console.error('Failed to load rooms', error);
      setRoomsError('Unable to load onsite rooms.');
    } finally {
      setRoomsLoading(false);
    }
  }, []);

  const fetchRoomAvailability = useCallback(async () => {
    if (watchLocationType !== 'onsite') {
      setRoomAvailability([]);
      setRoomAvailabilityError(null);
      return;
    }
    const range = computeMeetingTimes();
    if (!range) {
      setRoomAvailability([]);
      return;
    }
    setRoomAvailabilityLoading(true);
    setRoomAvailabilityError(null);
    try {
      const availability = await AISchedulerService.getRoomAvailability(range.start, range.end, meeting.id);
      setRoomAvailability(availability);
    } catch (error) {
      console.error('Room availability error', error);
      setRoomAvailabilityError('Unable to check room availability.');
    } finally {
      setRoomAvailabilityLoading(false);
    }
  }, [watchLocationType, computeMeetingTimes, meeting.id]);

  useEffect(() => {
    const startDateInput = formatDateInputValue(meeting.startTime, meetingTimezone);
    const startTimeInput = formatTimeInputValue(meeting.startTime, meetingTimezone);
    const endTimeInput = formatTimeInputValue(meeting.endTime, meetingTimezone);
    reset({
      title: meeting.title,
      description: meeting.description,
      preferredDate: startDateInput,
      startTime: startTimeInput,
      endTime: endTimeInput,
      locationType:
        (meeting.metadata?.location_type as 'online' | 'onsite') ||
        (meeting.metadata?.room_id ? 'onsite' : 'online'),
      roomId: meeting.metadata?.room_id || '',
    });

    // Reset participants and initial reference
    const emails = meeting.participants.map(p => p.email);
    setParticipants(emails);
    initialParticipantsRef.current = emails;
  }, [meeting, meetingTimezone, reset]);

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

  const addParticipant = () => {
    if (newParticipant && !participants.includes(newParticipant)) {
      setParticipants(prev => [...prev, newParticipant]);
      setNewParticipant('');
    }
  };

  const removeParticipant = (email: string) => {
    setParticipants(prev => prev.filter(p => p !== email));
  };

  const onSubmit = async (data: EditFormData) => {
    // Block submit if nothing changed as an extra guard
    const participantsChanged = !arraysEqual(participants, initialParticipantsRef.current);
    const canSave = isDirty || participantsChanged;
    if (!canSave) return;
    setIsSaving(true);
    try {
      // Construct new start/end
      const start = buildDateTimeInTimeZone(data.preferredDate, data.startTime, meetingTimezone);
      const end = buildDateTimeInTimeZone(data.preferredDate, data.endTime, meetingTimezone);
      if (!start || !end) {
        notificationService.error('Time missing', 'Unable to determine meeting start/end time.');
        setIsSaving(false);
        return;
      }
      if (end <= start) {
        setError('endTime', { type: 'validate', message: 'End time must be after start time' });
        setIsSaving(false);
        return;
      }
      if (end.getTime() - start.getTime() < 5 * 60 * 1000) {
        setError('endTime', { type: 'validate', message: 'Meeting must be at least 5 minutes long' });
        setIsSaving(false);
        return;
      }

      if (data.locationType === 'onsite' && !data.roomId) {
        setError('roomId', { type: 'validate', message: 'Select a room for onsite meetings' });
        setIsSaving(false);
        return;
      }

      const updatedMetadata: Record<string, any> = {
        ...(meeting.metadata || {}),
        location_type: data.locationType,
      };
      updatedMetadata.requested_timezone = meetingTimezone;
      updatedMetadata.timezone = meetingTimezone;
      if (data.locationType === 'onsite' && data.roomId) {
        updatedMetadata.room_id = data.roomId;
      } else {
        delete updatedMetadata.room_id;
        delete updatedMetadata.room_name;
        delete updatedMetadata.room_capacity;
        delete updatedMetadata.room_location;
        delete updatedMetadata.room_features;
      }

      const updated = await AISchedulerService.updateMeeting(meeting.id, {
        title: data.title,
        description: data.description,
        startTime: start,
        endTime: end,
        metadata: updatedMetadata,
      }, participants);

      onUpdated(updated, 'Meeting details have been updated');
      onClose();
    } catch (e) {
      console.error(e);
      notificationService.error('Update Failed', 'Could not update meeting');
    } finally {
      setIsSaving(false);
    }
  };

  const arraysEqual = (a: string[], b: string[]) => {
    if (a.length !== b.length) return false;
    const as = [...a].sort();
    const bs = [...b].sort();
    for (let i = 0; i < as.length; i++) if (as[i] !== bs[i]) return false;
    return true;
  };

  const participantsChanged = !arraysEqual(participants, initialParticipantsRef.current);
  const canSave = isDirty || participantsChanged;

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Title</label>
        <input type="text" {...register('title', { required: 'Title is required' })}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500" />
        {errors.title && <p className="mt-1 text-sm text-red-600">{errors.title.message}</p>}
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Description</label>
        <textarea rows={3} {...register('description', { required: 'Description is required' })}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500" />
        {errors.description && <p className="mt-1 text-sm text-red-600">{errors.description.message}</p>}
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Date</label>
        <input type="date" {...register('preferredDate', { required: 'Date is required' })}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500" />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Start Time</label>
          <input type="time" {...register('startTime', { required: 'Start time is required' })}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">End Time</label>
          <input type="time" {...register('endTime', { required: 'End time is required' })}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500" />
          {errors.endTime && <p className="mt-1 text-sm text-red-600">{String(errors.endTime.message)}</p>}
          <p className="mt-1 text-xs text-gray-500">End time must be after start time and at least 5 minutes later</p>
        </div>
      </div>
      <p className="text-xs text-gray-500">Times shown in {meetingTimezone}</p>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Location</label>
        <div className="flex flex-col gap-3 md:flex-row">
          <label className={`flex-1 border rounded-md p-3 cursor-pointer ${watchLocationType === 'online' ? 'border-blue-500 bg-blue-50' : 'border-gray-200'}`}>
            <div className="flex items-center gap-3">
              <input type="radio" value="online" {...register('locationType')} className="h-4 w-4" />
              <div>
                <p className="font-semibold text-gray-900 flex items-center gap-2">
                  <Calendar className="h-4 w-4" /> Online
                </p>
                <p className="text-xs text-gray-500">Keep the Google Meet link</p>
              </div>
            </div>
          </label>
          <label className={`flex-1 border rounded-md p-3 cursor-pointer ${watchLocationType === 'onsite' ? 'border-blue-500 bg-blue-50' : 'border-gray-200'}`}>
            <div className="flex items-center gap-3">
              <input type="radio" value="onsite" {...register('locationType')} className="h-4 w-4" />
              <div>
                <p className="font-semibold text-gray-900 flex items-center gap-2">
                  <MapPin className="h-4 w-4" /> Onsite
                </p>
                <p className="text-xs text-gray-500">Reserve a physical room</p>
              </div>
            </div>
          </label>
        </div>
      </div>

      {watchLocationType === 'onsite' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-gray-700 flex items-center gap-2">
              <MapPin className="h-4 w-4" /> Available rooms
            </p>
            <button
              type="button"
              onClick={fetchRoomAvailability}
              className="inline-flex items-center text-sm text-blue-600 hover:text-blue-800"
            >
              <RefreshCw className={`h-4 w-4 mr-1 ${roomAvailabilityLoading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>
          {roomsError && <p className="text-sm text-red-600">{roomsError}</p>}
          {roomAvailabilityError && <p className="text-sm text-red-600">{roomAvailabilityError}</p>}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-60 overflow-y-auto pr-1">
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
                        {availabilityState === null ? 'Select time' : availabilityState ? 'Available' : 'Booked'}
                      </span>
                    </div>
                    <p className="text-sm text-gray-600 mt-1">{room.location}</p>
                    <p className="text-xs text-gray-500 mt-1">Capacity {room.capacity} · {room.features.slice(0, 2).join(', ')}</p>
                  </label>
                );
              })
            )}
          </div>
          {errors.roomId && <p className="text-sm text-red-600">{String(errors.roomId.message)}</p>}
          {selectedRoom && (
            <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
              <p className="font-medium">{selectedRoom.name}</p>
              <p>{selectedRoom.location}</p>
              <p>Seats {selectedRoom.capacity} · {selectedRoom.features.join(', ')}</p>
              {selectedRoomAvailability && selectedRoomAvailability.conflicts.length > 0 && (
                <div className="mt-1 text-xs text-red-700 flex items-center gap-1">
                  <AlertCircle className="h-4 w-4" />
                  Conflicts detected for the current slot
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Participants</label>
        <div className="flex gap-2 mb-2">
          <input type="email" value={newParticipant} onChange={(e) => setNewParticipant(e.target.value)}
            className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="Enter email address" />
          <button type="button" onClick={addParticipant}
            className="px-3 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 flex items-center" title="Add participant">
            <Plus className="h-4 w-4 mr-1" /> Add
          </button>
        </div>
        {participants.length > 0 && (
          <div className="space-y-2">
            {participants.map((email) => (
              <div key={email} className="flex items-center justify-between p-2 bg-gray-50 rounded-md">
                <span className="text-sm text-gray-700">{email}</span>
                <button type="button" onClick={() => removeParticipant(email)} className="text-red-500 hover:text-red-700" title="Remove participant">
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className="px-4 py-2 border rounded-md" title="Cancel">Cancel</button>
        <button type="submit" disabled={isSaving || !canSave} className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center" title={canSave ? 'Save changes' : 'No changes to save'}>
          {isSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
          Save
        </button>
      </div>
    </form>
  );
};
