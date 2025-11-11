import React from 'react';
import { format } from 'date-fns';
import { Calendar, Clock, MapPin, Tag, Edit, Trash2 } from 'lucide-react';
import { Event } from '../types';

interface EventListProps {
  events: Event[];
  onEventUpdated: (event: Event, message?: string) => void;
  onEventDeleted: (eventId: string) => void;
  onEditEvent?: (event: Event) => void;
  currentTime: Date;
}

export const EventList: React.FC<EventListProps> = ({
  events,
  onEventUpdated,
  onEventDeleted,
  onEditEvent,
  currentTime
}) => {
  const computeStatus = (event: Event): Event['status'] => {
    if (event.status === 'cancelled') return 'cancelled';
    if (event.startTime <= currentTime && currentTime < event.endTime) return 'running';
    if (event.endTime <= currentTime) return 'completed';
    if (event.status === 'rescheduled') return 'rescheduled';
    return event.status;
  };

  const getStatusColor = (status: Event['status']) => {
    switch (status) {
      case 'scheduled':
        return 'bg-blue-100 text-blue-800';
      case 'rescheduled':
        return 'bg-yellow-100 text-yellow-800';
      case 'confirmed':
        return 'bg-green-100 text-green-800';
      case 'running':
        return 'bg-purple-100 text-purple-800';
      case 'cancelled':
        return 'bg-red-100 text-red-800';
      case 'completed':
        return 'bg-gray-200 text-gray-700';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  if (events.length === 0) {
    return (
      <div className="text-center py-12">
        <Calendar className="h-12 w-12 text-gray-400 mx-auto mb-4" />
        <h3 className="text-lg font-medium text-gray-900 mb-2">No events scheduled</h3>
        <p className="text-gray-500">Create your first event to get started</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold text-gray-900 mb-4">Events</h2>
      {events.map((event) => {
        const effectiveStatus = computeStatus(event);
        const isCompleted = effectiveStatus === 'completed';
        return (
          <div key={event.id} className="bg-white rounded-lg shadow-md p-6 border border-gray-200">
            <div className="flex justify-between items-start mb-4">
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-1">{event.title}</h3>
                {event.description && (
                  <p className="text-gray-600 text-sm mb-2">{event.description}</p>
                )}
                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getStatusColor(effectiveStatus)}`}>
                  {effectiveStatus.charAt(0).toUpperCase() + effectiveStatus.slice(1)}
                </span>
              </div>
              <div className="flex space-x-2">
                <div className="relative group">
                <button
                  onClick={() => {
                    if (isCompleted || !onEditEvent) return;
                    onEditEvent(event);
                  }}
                  disabled={isCompleted}
                  className={`p-2 text-gray-700 rounded-md ${isCompleted ? 'opacity-50 cursor-not-allowed' : 'hover:bg-gray-100'}`}
                  title={isCompleted ? 'Completed events cannot be edited' : 'Edit Event'}
                >
                  <Edit className="h-4 w-4" />
                </button>
                {isCompleted && (
                  <div className="absolute -top-10 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md bg-gray-800 text-white text-xs px-2 py-1 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none shadow-lg">
                    Completed events can't be edited
                  </div>
                )}
                </div>
                <button 
                  onClick={() => onEventDeleted(event.id)} 
                  className="p-2 text-red-600 hover:bg-red-50 rounded-md" 
                  title="Delete Event"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
              <div className="flex items-center text-sm text-gray-600">
                <Calendar className="h-4 w-4 mr-2" />
                <span>{format(event.startTime, 'MMM dd, yyyy')}</span>
              </div>
              <div className="flex items-center text-sm text-gray-600">
                <Clock className="h-4 w-4 mr-2" />
                <span>
                  {format(event.startTime, 'h:mm a')} - {format(event.endTime, 'h:mm a')}
                </span>
              </div>
              {event.location && (
                <div className="flex items-center text-sm text-gray-600">
                  <MapPin className="h-4 w-4 mr-2" />
                  <span>{event.location}</span>
                </div>
              )}
            </div>

            {event.category && (
              <div className="flex items-center text-sm text-gray-600 mb-4">
                <Tag className="h-4 w-4 mr-2" />
                <span className="px-2 py-1 bg-gray-100 rounded-md">{event.category}</span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

