export type LocationType = 'online' | 'onsite';

export interface Participant {
  id: string;
  name: string;
  email: string;
  availability: TimeSlot[];
}

export interface TimeSlot {
  start: Date;
  end: Date;
  isAvailable: boolean;
}

export interface Meeting {
  id: string;
  title: string;
  description: string;
  participants: Participant[];
  startTime: Date;
  endTime: Date;
  duration: number;
  status: 'scheduled' | 'confirmed' | 'cancelled' | 'rescheduled' | 'running' | 'completed' | 'polling';
  organizerEmail?: string;
  createdAt: Date;
  updatedAt: Date;
  metadata?: MeetingMetadata;
}

export interface MeetingFormData {
  title: string;
  description: string;
  participants: string[];
  startTime: string;
  endTime: string;
  preferredDate: string;
  preferredTimeSlots: TimeSlot[];
  durationMinutes: number;
  locationType: LocationType;
  roomId?: string;
  clientTimezone?: string;
  manualTimeMode?: boolean;
  selectedSuggestionStart?: string | null;
  pollPending?: boolean;
}

export interface MeetingMetadata {
  poll_id?: string;
  meeting_url?: string;
  google_event_id?: string;
  google_event_link?: string;
  location_type?: LocationType;
  room_id?: string;
  room_name?: string;
  room_capacity?: number;
  room_location?: string;
  room_features?: string[];
  [key: string]: any;
}

export interface AvailabilitySuggestion {
  start: string;
  end: string;
}

export interface Room {
  id: string;
  name: string;
  capacity: number;
  location: string;
  features: string[];
  notes?: string;
}

export interface RoomAvailability extends Room {
  is_available: boolean;
  conflicts: {
    meeting_id: string;
    title: string;
    start_time: string;
    end_time: string;
  }[];
}

export interface PollOption {
  id: string;
  start_time: string;
  end_time: string;
  votes: number;
}

export interface Poll {
  id: string;
  meeting_id: string;
  status: 'open' | 'closed';
  options: PollOption[];
  deadline?: string;
  winning_option_id?: string;
}
