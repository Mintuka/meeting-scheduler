import React, { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Calendar, Loader2, Save } from 'lucide-react';
import { Event } from '../types';
import { AISchedulerService } from '../services/AISchedulerService';
import { notificationService } from '../services/NotificationService';

interface EditEventFormProps {
  event: Event;
  onClose: () => void;
  onUpdated: (event: Event, message?: string) => void;
}

interface EditFormData {
  title: string;
  description?: string;
  eventDate: string; // yyyy-MM-dd
  startTime: string; // HH:mm
  endTime: string; // HH:mm
  location?: string;
  category?: string;
}

export const EditEventForm: React.FC<EditEventFormProps> = ({ event, onClose, onUpdated }) => {
  const [isSaving, setIsSaving] = useState(false);

  const { register, handleSubmit, reset, setError, formState: { errors, isDirty } } = useForm<EditFormData>({
    defaultValues: {
      title: event.title,
      description: event.description,
      eventDate: '',
      startTime: '',
      endTime: '',
      location: event.location,
      category: event.category,
    }
  });

  useEffect(() => {
    const d = new Date(event.startTime);
    const end = new Date(event.endTime);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    const eh = String(end.getHours()).padStart(2, '0');
    const emi = String(end.getMinutes()).padStart(2, '0');

    reset({
      title: event.title,
      description: event.description,
      eventDate: `${yyyy}-${mm}-${dd}`,
      startTime: `${hh}:${mi}`,
      endTime: `${eh}:${emi}`,
      location: event.location,
      category: event.category,
    });
  }, [event, reset]);

  const onSubmit = async (data: EditFormData) => {
    if (!isDirty) return;
    setIsSaving(true);
    try {
      // Construct new start/end
      const [year, month, day] = data.eventDate.split('-').map(Number);
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
        setError('endTime', { type: 'validate', message: 'Event must be at least 5 minutes long' });
        setIsSaving(false);
        return;
      }

      const updated = await AISchedulerService.updateEvent(event.id, {
        title: data.title,
        description: data.description,
        startTime: start,
        endTime: end,
        location: data.location,
        category: data.category,
      });

      onUpdated(updated, 'Event details have been updated');
      onClose();
    } catch (e) {
      console.error(e);
      notificationService.error('Update Failed', 'Could not update event');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Title <span className="text-red-500">*</span></label>
        <input type="text" {...register('title', { required: 'Title is required' })}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500" />
        {errors.title && <p className="mt-1 text-sm text-red-600">{errors.title.message}</p>}
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Description</label>
        <textarea rows={3} {...register('description')}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500" />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Date <span className="text-red-500">*</span></label>
        <input type="date" {...register('eventDate', { required: 'Date is required' })}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500" />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Start Time <span className="text-red-500">*</span></label>
          <input type="time" {...register('startTime', { required: 'Start time is required' })}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">End Time <span className="text-red-500">*</span></label>
          <input type="time" {...register('endTime', { required: 'End time is required' })}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500" />
          {errors.endTime && <p className="mt-1 text-sm text-red-600">{String(errors.endTime.message)}</p>}
          <p className="mt-1 text-xs text-gray-500">End time must be after start time and at least 5 minutes later</p>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Location</label>
        <input type="text" {...register('location')}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500" />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Category</label>
        <select
          {...register('category')}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">Select category (optional)</option>
          <option value="work">Work</option>
          <option value="personal">Personal</option>
          <option value="meeting">Meeting</option>
          <option value="social">Social</option>
          <option value="other">Other</option>
        </select>
      </div>

      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className="px-4 py-2 border rounded-md" title="Cancel">Cancel</button>
        <button type="submit" disabled={isSaving || !isDirty} className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center" title={isDirty ? 'Save changes' : 'No changes to save'}>
          {isSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
          Save
        </button>
      </div>
    </form>
  );
};

