import React from 'react';
import { CheckCircle2, Lock, BarChart3, Trash2 } from 'lucide-react';
import { Poll } from '../types';
import { authService } from '../services/AuthService';

interface PollDisplayProps {
  poll: Poll;
  onVote: (pollId: string, optionId: string) => void;
  onClose?: (pollId: string) => void;
  onDelete?: (pollId: string) => void;
}

export const PollDisplay: React.FC<PollDisplayProps> = ({ poll, onVote, onClose, onDelete }) => {
  const currentUser = authService.getUser();
  const userEmail = currentUser?.email;

  const hasVoted = poll.options.some(option => option.votes.includes(userEmail || ''));
  const selectedOptionId = poll.options.find(option => option.votes.includes(userEmail || ''))?.id;
  const totalVotes = poll.options.reduce((sum, option) => sum + option.votes.length, 0);

  const getPercentage = (votes: number) => {
    if (totalVotes === 0) return 0;
    return Math.round((votes / totalVotes) * 100);
  };

  const isCreator = poll.creatorEmail === userEmail;

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4 mb-4">
      <div className="flex justify-between items-start mb-3">
        <div className="flex-1">
          <h4 className="font-semibold text-gray-900 mb-1">{poll.question}</h4>
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <BarChart3 className="h-4 w-4" />
            <span>{totalVotes} {totalVotes === 1 ? 'vote' : 'votes'}</span>
            {poll.isClosed && (
              <span className="flex items-center text-orange-600">
                <Lock className="h-3 w-3 mr-1" />
                Closed
              </span>
            )}
          </div>
        </div>
        {isCreator && (
          <div className="flex gap-2">
            {!poll.isClosed && onClose && (
              <button
                onClick={() => onClose(poll.id)}
                className="p-1 text-orange-600 hover:bg-orange-50 rounded"
                title="Close Poll"
              >
                <Lock className="h-4 w-4" />
              </button>
            )}
            {onDelete && (
              <button
                onClick={() => onDelete(poll.id)}
                className="p-1 text-red-600 hover:bg-red-50 rounded"
                title="Delete Poll"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </div>
        )}
      </div>

      <div className="space-y-2">
        {poll.options.map((option) => {
          const voteCount = option.votes.length;
          const percentage = getPercentage(voteCount);
          const isSelected = option.id === selectedOptionId;
          const isVoted = hasVoted;

          return (
            <div key={option.id} className="relative">
              <button
                onClick={() => !poll.isClosed && !isVoted && onVote(poll.id, option.id)}
                disabled={poll.isClosed || isVoted}
                className={`w-full text-left p-3 rounded-md border-2 transition-all ${
                  poll.isClosed || isVoted
                    ? 'cursor-default'
                    : 'hover:border-blue-400 cursor-pointer'
                } ${
                  isSelected
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-gray-200 bg-gray-50'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="font-medium text-gray-900">{option.text}</span>
                  <div className="flex items-center gap-2">
                    {isSelected && (
                      <CheckCircle2 className="h-5 w-5 text-blue-600" />
                    )}
                    <span className="text-sm font-semibold text-gray-600">
                      {voteCount} {voteCount === 1 ? 'vote' : 'votes'}
                    </span>
                  </div>
                </div>
                {totalVotes > 0 && (
                  <div className="w-full bg-gray-200 rounded-full h-2 mt-2">
                    <div
                      className={`h-2 rounded-full transition-all ${
                        isSelected ? 'bg-blue-600' : 'bg-gray-400'
                      }`}
                      style={{ width: `${percentage}%` }}
                    />
                  </div>
                )}
                <span className="text-xs text-gray-500 mt-1 block">{percentage}%</span>
              </button>
            </div>
          );
        })}
      </div>

      {poll.isClosed && (
        <div className="mt-3 text-sm text-gray-500 italic">
          This poll is closed. Voting is no longer available.
        </div>
      )}
    </div>
  );
};

