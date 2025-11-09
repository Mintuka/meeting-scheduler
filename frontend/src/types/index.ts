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
  status: 'scheduled' | 'confirmed' | 'cancelled' | 'rescheduled' | 'running' | 'completed';
  createdAt: Date;
  updatedAt: Date;
  metadata?: Record<string, any>;
}

export interface MeetingFormData {
  title: string;
  description: string;
  participants: string[];
  startTime: string;
  endTime: string;
  preferredDate: string;
  preferredTimeSlots: TimeSlot[];
}

export interface Event {
  id: string;
  title: string;
  description?: string;
  startTime: Date;
  endTime: Date;
  location?: string;
  category?: string;
  status: 'scheduled' | 'rescheduled' | 'confirmed' | 'running' | 'cancelled' | 'completed';
  creatorEmail: string;
  createdAt: Date;
  updatedAt: Date;
  metadata?: Record<string, any>;
}

export interface EventFormData {
  title: string;
  description?: string;
  startTime: string;
  endTime: string;
  eventDate: string;
  location?: string;
  category?: string;
}

export interface PollOption {
  id: string;
  text: string;
  votes: string[]; // List of voter emails
}

export interface Poll {
  id: string;
  meetingId: string;
  question: string;
  options: PollOption[];
  creatorEmail: string;
  createdAt: Date;
  updatedAt: Date;
  isClosed: boolean;
}

export interface PollCreate {
  meetingId: string;
  question: string;
  options: string[]; // List of option texts
}
