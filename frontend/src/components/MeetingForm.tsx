import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Calendar, Clock, Users, Mail, Loader2, CheckCircle } from 'lucide-react';
import { MeetingFormData } from '../types';
import { AISchedulerService } from '../services/AISchedulerService';

interface MeetingFormProps {
  onMeetingCreated: (meeting: any) => void;
}

export const MeetingForm: React.FC<MeetingFormProps> = ({ onMeetingCreated }) => {
  const [isLoading, setIsLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [participants, setParticipants] = useState<string[]>([]);
  const [newParticipant, setNewParticipant] = useState('');

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset
  } = useForm<MeetingFormData>();

  const addParticipant = () => {
    if (newParticipant && !participants.includes(newParticipant)) {
      setParticipants([...participants, newParticipant]);
      setNewParticipant('');
    }
  };

  const removeParticipant = (email: string) => {
    setParticipants(participants.filter(p => p !== email));
  };

  const onSubmit = async (data: MeetingFormData) => {
    if (participants.length === 0) {
      alert('Please add at least one participant');
      return;
    }

    setIsLoading(true);
    try {
      const formData: MeetingFormData = {
        ...data,
        participants,
        preferredDate: new Date(data.preferredDate),
        preferredTimeSlots: []
      };

      const meeting = await AISchedulerService.createMeeting(formData);
      await AISchedulerService.sendMeetingInvitation(meeting);
      
      setIsSuccess(true);
      onMeetingCreated(meeting);
      reset();
      setParticipants([]);
      
      setTimeout(() => setIsSuccess(false), 3000);
    } catch (error) {
      console.error('Error creating meeting:', error);
      alert('Failed to create meeting. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto p-6 bg-white rounded-lg shadow-lg">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Schedule Meeting with AI</h2>
        <p className="text-gray-600">Let AI find the best time for everyone to meet</p>
      </div>

      {isSuccess && (
        <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-lg flex items-center">
          <CheckCircle className="h-5 w-5 text-green-500 mr-2" />
          <span className="text-green-700">Meeting created successfully! Invitations sent.</span>
        </div>
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
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

        {/* Duration */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Duration (minutes)
          </label>
          <select
            {...register('duration', { required: 'Duration is required' })}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            <option value="">Select duration</option>
            <option value={15}>15 minutes</option>
            <option value={30}>30 minutes</option>
            <option value={45}>45 minutes</option>
            <option value={60}>1 hour</option>
            <option value={90}>1.5 hours</option>
            <option value={120}>2 hours</option>
          </select>
          {errors.duration && (
            <p className="mt-1 text-sm text-red-600">{errors.duration.message}</p>
          )}
        </div>

        {/* Preferred Date */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Preferred Date
          </label>
          <input
            type="date"
            {...register('preferredDate', { required: 'Preferred date is required' })}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          {errors.preferredDate && (
            <p className="mt-1 text-sm text-red-600">{errors.preferredDate.message}</p>
          )}
        </div>

        {/* Participants */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Participants
          </label>
          <div className="flex gap-2 mb-2">
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
          
          {participants.length > 0 && (
            <div className="space-y-2">
              {participants.map((email, index) => (
                <div key={index} className="flex items-center justify-between p-2 bg-gray-50 rounded-md">
                  <span className="text-sm text-gray-700">{email}</span>
                  <button
                    type="button"
                    onClick={() => removeParticipant(email)}
                    className="text-red-500 hover:text-red-700"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
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
              Finding Best Time...
            </>
          ) : (
            <>
              <Calendar className="h-5 w-5 mr-2" />
              Schedule Meeting
            </>
          )}
        </button>
      </form>
    </div>
  );
};
