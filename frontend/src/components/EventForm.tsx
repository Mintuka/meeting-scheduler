import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Calendar, Loader2, CheckCircle } from 'lucide-react';
import { EventFormData } from '../types';
import { AISchedulerService } from '../services/AISchedulerService';
import { notificationService } from '../services/NotificationService';

interface EventFormProps {
  onEventCreated: (event: any) => void;
}

export const EventForm: React.FC<EventFormProps> = ({ onEventCreated }) => {
  const [isLoading, setIsLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
    setError
  } = useForm<EventFormData>();

  const onSubmit = async (data: EventFormData) => {
    // Parse the date string manually to avoid timezone issues
    const [year, month, day] = data.eventDate.split('-').map(Number);
    const eventDate = new Date(year, month - 1, day);
    const startTimeStr = data.startTime;
    const endTimeStr = data.endTime;
    
    // Create start datetime by combining date with start time
    const startTime = new Date(eventDate.getFullYear(), eventDate.getMonth(), eventDate.getDate());
    const [startHour, startMinute] = startTimeStr.split(':').map(Number);
    startTime.setHours(startHour, startMinute, 0, 0);
    
    // Create end datetime by combining date with end time
    const endTime = new Date(eventDate.getFullYear(), eventDate.getMonth(), eventDate.getDate());
    const [endHour, endMinute] = endTimeStr.split(':').map(Number);
    endTime.setHours(endHour, endMinute, 0, 0);
    
    // Validate that end time is after start time and at least 5 minutes
    if (endTime <= startTime) {
      setError('endTime', { type: 'validate', message: 'End time must be after start time' });
      return;
    }
    const diffMs = endTime.getTime() - startTime.getTime();
    if (diffMs < 5 * 60 * 1000) {
      setError('endTime', { type: 'validate', message: 'Event must be at least 5 minutes long' });
      return;
    }

    setIsLoading(true);
    try {
      const formData: EventFormData = {
        ...data,
        startTime: data.startTime,
        endTime: data.endTime,
        eventDate: data.eventDate,
      };

      const event = await AISchedulerService.createEvent(formData);
      
      setIsSuccess(true);
      onEventCreated(event);
      reset();
      
      // Show success notification
      notificationService.success('Event Created', `Event "${event.title}" has been created successfully.`);
      
      setTimeout(() => setIsSuccess(false), 3000);
    } catch (error: any) {
      console.error('Error creating event:', error);
      notificationService.error('Create Error', error.message || 'Failed to create event. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Create New Event</h2>
        <p className="text-gray-600">Add a new event to your calendar</p>
      </div>

      {isSuccess && (
        <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-lg flex items-center">
          <CheckCircle className="h-5 w-5 text-green-500 mr-2" />
          <span className="text-green-700">Event created successfully!</span>
        </div>
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
        {/* Event Title */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Event Title <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            {...register('title', { required: 'Event title is required' })}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            placeholder="Enter event title"
          />
          {errors.title && (
            <p className="mt-1 text-sm text-red-600">{errors.title.message}</p>
          )}
        </div>

        {/* Event Description */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Description
          </label>
          <textarea
            {...register('description')}
            rows={3}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            placeholder="Enter event description (optional)"
          />
        </div>

        {/* Event Date */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Event Date <span className="text-red-500">*</span>
          </label>
          <input
            type="date"
            {...register('eventDate', { required: 'Event date is required' })}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          {errors.eventDate && (
            <p className="mt-1 text-sm text-red-600">{errors.eventDate.message}</p>
          )}
        </div>

        {/* Start Time */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Start Time <span className="text-red-500">*</span>
          </label>
          <input
            type="time"
            {...register('startTime', { required: 'Start time is required' })}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            placeholder="Select start time"
          />
          {errors.startTime && (
            <p className="mt-1 text-sm text-red-600">{errors.startTime.message}</p>
          )}
        </div>

        {/* End Time */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            End Time <span className="text-red-500">*</span>
          </label>
          <input
            type="time"
            {...register('endTime', { required: 'End time is required' })}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            placeholder="Select end time"
          />
          {errors.endTime && (
            <p className="mt-1 text-sm text-red-600">{errors.endTime.message}</p>
          )}
          <p className="mt-1 text-xs text-gray-500">End time must be after start time and at least 5 minutes later</p>
        </div>

        {/* Location */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Location
          </label>
          <input
            type="text"
            {...register('location')}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            placeholder="Enter event location (optional)"
          />
        </div>

        {/* Category */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Category
          </label>
          <select
            {...register('category')}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            <option value="">Select category (optional)</option>
            <option value="work">Work</option>
            <option value="personal">Personal</option>
            <option value="meeting">Meeting</option>
            <option value="social">Social</option>
            <option value="other">Other</option>
          </select>
        </div>

        {/* Submit Button */}
        <button
          type="submit"
          disabled={isLoading}
          className="w-full flex items-center justify-center px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isLoading ? (
            <>
              <Loader2 className="h-5 w-5 mr-2 animate-spin" />
              Creating Event...
            </>
          ) : (
            <>
              <Calendar className="h-5 w-5 mr-2" />
              Create Event
            </>
          )}
        </button>
      </form>
    </div>
  );
};

