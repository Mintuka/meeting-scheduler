import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { AISchedulerService } from '../services/AISchedulerService';
import { notificationService } from '../services/NotificationService';

interface PollOption {
  id: string;
  start_time: string;
  end_time: string;
  votes: number;
}

interface PollMeetingSummary {
  title: string;
  description: string;
  start_time: string;
  end_time: string;
  organizer_email?: string | null;
}

interface Poll {
  id: string;
  meeting_id: string;
  status: string;
  options: PollOption[];
  meeting_summary?: PollMeetingSummary;
}

export const PollPage: React.FC = () => {
  const { pollId } = useParams<{ pollId: string }>();
  const [poll, setPoll] = useState<Poll | null>(null);
  const [voterEmail, setVoterEmail] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const loadPoll = async () => {
    try {
      if (!pollId) return;
      const data = await AISchedulerService.getPoll(pollId);
      setPoll(data);
    } catch (error) {
      console.error('Failed to load poll', error);
      notificationService.error('Poll Error', 'Unable to load poll');
    }
  };

  useEffect(() => {
    loadPoll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pollId]);

  const vote = async (optionId: string) => {
    if (!pollId) return;
    if (!voterEmail) {
      notificationService.warning('Email required', 'Please enter your email to vote');
      return;
    }
    try {
      setIsSubmitting(true);
      const data = await AISchedulerService.votePoll(pollId, optionId, voterEmail);
      setPoll(data);
      notificationService.success('Vote submitted', 'Thank you for your response!');
    } catch (error) {
      console.error('Failed to vote', error);
      notificationService.error('Vote Error', 'Unable to submit your vote');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!poll) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-gray-600">Loading poll...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-10 px-4">
      <div className="max-w-2xl mx-auto bg-white shadow rounded-lg p-6">
        <h1 className="text-2xl font-bold mb-4">Vote for a meeting time</h1>
        {poll.meeting_summary && (
          <div className="mb-6 border rounded-md p-4 bg-gray-50">
            <p className="text-sm uppercase tracking-wide text-gray-500 mb-1">Meeting details</p>
            <h2 className="text-xl font-semibold text-gray-900">{poll.meeting_summary.title}</h2>
            <p className="text-sm text-gray-600 mb-2">{poll.meeting_summary.description}</p>
            <p className="text-sm text-gray-700">
              Proposed date: {new Date(poll.meeting_summary.start_time).toLocaleString()}
            </p>
            {poll.meeting_summary.organizer_email && (
              <p className="text-sm text-gray-500 mt-1">
                Organizer: {poll.meeting_summary.organizer_email}
              </p>
            )}
          </div>
        )}
        {poll.status !== 'open' && (
          <div className="mb-4 text-sm text-green-600">This poll has been closed.</div>
        )}

        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">Your email</label>
          <input
            type="email"
            value={voterEmail}
            onChange={(e) => setVoterEmail(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="you@example.com"
          />
        </div>

        <div className="space-y-3">
          {poll.options.map((option) => (
            <div key={option.id} className="border rounded-md p-4 flex items-center justify-between">
              <div>
                <p className="font-medium text-gray-800">
                  {new Date(option.start_time).toLocaleString()} - {new Date(option.end_time).toLocaleTimeString()}
                </p>
                <p className="text-sm text-gray-500">{option.votes} votes</p>
              </div>
              <button
                disabled={poll.status !== 'open' || isSubmitting}
                onClick={() => vote(option.id)}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
              >
                Vote
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
