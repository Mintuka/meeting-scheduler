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
