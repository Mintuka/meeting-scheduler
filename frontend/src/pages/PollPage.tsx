import React, { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { AISchedulerService } from '../services/AISchedulerService';
import { notificationService } from '../services/NotificationService';
import { useAuth } from '../context/AuthContext';

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
  viewer_vote_option_id?: string | null;
  is_deadline_passed?: boolean;
}

export const PollPage: React.FC = () => {
  const { pollId } = useParams<{ pollId: string }>();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const [poll, setPoll] = useState<Poll | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [tokenEmail, setTokenEmail] = useState<string | null>(null);
  const [legacyEmail, setLegacyEmail] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [identityReady, setIdentityReady] = useState(false);

  const loadPoll = async (currentToken?: string | null, currentLegacyEmail?: string | null) => {
    try {
      if (!pollId) return;
      const data = await AISchedulerService.getPoll(pollId, {
        token: currentToken ?? undefined,
        voterEmail: currentLegacyEmail ?? undefined,
      });
      setPoll(data);
    } catch (error) {
      console.error('Failed to load poll', error);
      notificationService.error('Poll Error', 'Unable to load poll');
    }
  };

  useEffect(() => {
    const tokenParam = searchParams.get('token');
    const emailParam = searchParams.get('email');
    setToken(tokenParam);
    setTokenEmail(tokenParam ? decodeTokenEmail(tokenParam) : null);
    setLegacyEmail(emailParam);
    setIdentityReady(true);
  }, [searchParams]);

  useEffect(() => {
    if (!identityReady) return;
    loadPoll(token, legacyEmail);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pollId, token, legacyEmail, identityReady]);

  const linkEmail = tokenEmail || legacyEmail;

  const effectiveEmail = useMemo(() => {
    if (linkEmail) return linkEmail;
    if (user?.email) return user.email;
    return null;
  }, [linkEmail, user]);

  const emailConflict =
    Boolean(linkEmail && user?.email && linkEmail.toLowerCase() !== user.email.toLowerCase());

  const vote = async (optionId: string) => {
    if (!pollId) return;
    if (poll?.is_deadline_passed) {
      notificationService.warning('Poll closed', 'The voting deadline has passed for this poll.');
      return;
    }
    if (!effectiveEmail) {
      notificationService.warning(
        'Unable to vote',
        'Sign in or open your secure poll link to cast a vote.'
      );
      return;
    }
    if (emailConflict) {
      notificationService.warning(
        'Account mismatch',
        `This poll link is reserved for ${linkEmail}. Switch accounts or use a private window to vote on their behalf.`
      );
      return;
    }
    try {
      setIsSubmitting(true);
      const legacyVoterEmail = tokenEmail ? undefined : legacyEmail || undefined;
      const data = await AISchedulerService.votePoll(
        pollId,
        optionId,
        token ?? undefined,
        legacyVoterEmail
      );
      setPoll(data);
      notificationService.success('Vote submitted', 'Thank you for your response!');
    } catch (error: unknown) {
      console.error('Failed to vote', error);
      const message = error instanceof Error ? error.message : 'Unable to submit your vote';
      notificationService.error('Vote Error', message);
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

  const myVote = poll.viewer_vote_option_id ?? null;
  const deadlineReached = Boolean(poll.is_deadline_passed);

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
        {poll.status === 'open' && deadlineReached && (
          <div className="mb-4 text-sm text-amber-600">
            Poll deadline passed. Awaiting organizer to finalize the results.
          </div>
        )}

        <div className="mb-6 border rounded-md p-4 bg-gray-50">
          <p className="text-sm font-medium text-gray-700 mb-1">Participant</p>
          {effectiveEmail ? (
            <p className="text-gray-900">
              Voting as <span className="font-semibold">{effectiveEmail}</span>
            </p>
          ) : (
            <p className="text-gray-600">
              Sign in or reopen your personalized invitation link to identify yourself before voting.
            </p>
          )}
          {emailConflict && (
            <p className="text-xs text-red-600 mt-2">
              This link belongs to <span className="font-semibold">{linkEmail}</span>. Open it in a
              private window or sign out to vote on their behalf.
            </p>
          )}
        </div>

        <div className="space-y-3">
          {poll.options.map((option) => {
            const isUsersPick = myVote === option.id;
            return (
              <div key={option.id} className="border rounded-md p-4 flex items-center justify-between">
                <div>
                  <p className="font-medium text-gray-800">
                    {new Date(option.start_time).toLocaleString()} - {new Date(option.end_time).toLocaleTimeString()}
                  </p>
                  <p className="text-sm text-gray-500">{option.votes} votes</p>
                </div>
                <button
                  disabled={
                    poll.status !== 'open' ||
                    isSubmitting ||
                    !effectiveEmail ||
                    emailConflict ||
                    deadlineReached
                  }
                  onClick={() => vote(option.id)}
                  aria-pressed={isUsersPick}
                  className={`px-4 py-2 rounded-md text-white transition ${
                    isUsersPick
                      ? 'bg-green-600 hover:bg-green-700'
                      : 'bg-blue-600 hover:bg-blue-700'
                  } disabled:opacity-50`}
                >
                  {isUsersPick ? 'Voted' : 'Vote'}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

const decodeTokenEmail = (token: string): string | null => {
  try {
    const parts = token.split('.');
    if (parts.length < 2) {
      return null;
    }
    const payload = parts[1];
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=');
    const decoded = atob(padded);
    const data = JSON.parse(decoded);
    return typeof data.email === 'string' ? data.email : null;
  } catch {
    return null;
  }
};
