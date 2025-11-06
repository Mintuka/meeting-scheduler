import React, { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Calendar, Loader2, Save, Plus, X } from 'lucide-react';
import { Meeting } from '../types';
import { AISchedulerService } from '../services/AISchedulerService';
import { notificationService } from '../services/NotificationService';

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
}

export const EditMeetingForm: React.FC<EditMeetingFormProps> = ({ meeting, onClose, onUpdated }) => {
  const [isSaving, setIsSaving] = useState(false);
  const [participants, setParticipants] = useState<string[]>(meeting.participants.map(p => p.email));
  const [newParticipant, setNewParticipant] = useState('');
  const initialParticipantsRef = useRef<string[]>(meeting.participants.map(p => p.email));

  const { register, handleSubmit, reset, setError, formState: { errors, isDirty } } = useForm<EditFormData>({
    defaultValues: {
      title: meeting.title,
      description: meeting.description,
      preferredDate: '',
      startTime: '',
      endTime: '',
    }
  });

  useEffect(() => {
    const d = new Date(meeting.startTime);
    const end = new Date(meeting.endTime);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    const eh = String(end.getHours()).padStart(2, '0');
    const emi = String(end.getMinutes()).padStart(2, '0');

    reset({
      title: meeting.title,
      description: meeting.description,
      preferredDate: `${yyyy}-${mm}-${dd}`,
      startTime: `${hh}:${mi}`,
      endTime: `${eh}:${emi}`,
    });

    // Reset participants and initial reference
    const emails = meeting.participants.map(p => p.email);
    setParticipants(emails);
    initialParticipantsRef.current = emails;
  }, [meeting, reset]);

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
      const [year, month, day] = data.preferredDate.split('-').map(Number);
      const [sh, sm] = data.startTime.split(':').map(Number);
      const [eh, em] = data.endTime.split(':').map(Number);
      const start = new Date(year, month - 1, day, sh, sm, 0, 0);
      const end = new Date(year, month - 1, day, eh, em, 0, 0);
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

      const updated = await AISchedulerService.updateMeeting(meeting.id, {
        title: data.title,
        description: data.description,
        startTime: start,
        endTime: end,
        metadata: meeting.metadata,
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
