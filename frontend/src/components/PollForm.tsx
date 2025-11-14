import React, { useState } from 'react';
import { X, Plus, Calendar, Clock } from 'lucide-react';

interface PollFormProps {
  meetingId: string;
  onSubmit: (pollData: { options: { start: string; end: string }[]; deadline?: Date }) => void;
  onCancel: () => void;
}

export const PollForm: React.FC<PollFormProps> = ({ meetingId, onSubmit, onCancel }) => {
  const [options, setOptions] = useState<{ start: string; end: string }[]>([
    { start: '', end: '' }
  ]);
  const [deadline, setDeadline] = useState<string>('');

  const handleAddOption = () => {
    setOptions([...options, { start: '', end: '' }]);
  };

  const handleRemoveOption = (index: number) => {
    if (options.length > 1) {
      setOptions(options.filter((_, i) => i !== index));
    }
  };

  const handleOptionChange = (index: number, field: 'start' | 'end', value: string) => {
    const newOptions = [...options];
    newOptions[index] = { ...newOptions[index], [field]: value };
    setOptions(newOptions);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    // Validate all options have both start and end times
    const validOptions = options.filter(opt => opt.start && opt.end);
    
    if (validOptions.length === 0) {
      alert('Please add at least one time slot option');
      return;
    }

    // Convert date/time strings to ISO strings
    const formattedOptions = validOptions.map(opt => {
      // If start/end are just time strings (HH:mm), we need to combine with a date
      // For now, assume they're ISO strings or datetime-local format
      let startISO = opt.start;
      let endISO = opt.end;
      
      // If they're datetime-local format, convert to ISO
      if (opt.start.includes('T') && !opt.start.includes('Z')) {
        startISO = new Date(opt.start).toISOString();
      }
      if (opt.end.includes('T') && !opt.end.includes('Z')) {
        endISO = new Date(opt.end).toISOString();
      }
      
      return { start: startISO, end: endISO };
    });

    const deadlineDate = deadline ? new Date(deadline) : undefined;

    onSubmit({
      options: formattedOptions,
      deadline: deadlineDate
    });
    
    setOptions([{ start: '', end: '' }]);
    setDeadline('');
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          <Calendar className="h-4 w-4 inline mr-1" />
          Time Slot Options
        </label>
        {options.map((option, index) => (
          <div key={index} className="flex items-center gap-2 mb-2">
            <div className="flex-1 grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Start Time</label>
                <input
                  type="datetime-local"
                  value={option.start}
                  onChange={(e) => handleOptionChange(index, 'start', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                  required
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">End Time</label>
                <input
                  type="datetime-local"
                  value={option.end}
                  onChange={(e) => handleOptionChange(index, 'end', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                  required
                />
              </div>
            </div>
            {options.length > 1 && (
              <button
                type="button"
                onClick={() => handleRemoveOption(index)}
                className="p-2 text-red-600 hover:bg-red-50 rounded-md mt-6"
                title="Remove option"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        ))}
        <button
          type="button"
          onClick={handleAddOption}
          className="flex items-center text-sm text-blue-600 hover:text-blue-700 mt-2"
        >
          <Plus className="h-4 w-4 mr-1" />
          Add Time Slot
        </button>
      </div>

      <div>
        <label htmlFor="deadline" className="block text-sm font-medium text-gray-700 mb-1">
          <Clock className="h-4 w-4 inline mr-1" />
          Voting Deadline (Optional)
        </label>
        <input
          type="datetime-local"
          id="deadline"
          value={deadline}
          onChange={(e) => setDeadline(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <p className="text-xs text-gray-500 mt-1">
          If set, voting will automatically close at this time
        </p>
      </div>

      <div className="flex justify-end gap-2 pt-4">
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200"
        >
          Cancel
        </button>
        <button
          type="submit"
          className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
        >
          Create Poll
        </button>
      </div>
    </form>
  );
};
