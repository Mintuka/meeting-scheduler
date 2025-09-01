import { Meeting, Participant, TimeSlot, MeetingFormData } from '../types';

export class AISchedulerService {
  static async findCommonFreeTime(
    participants: Participant[],
    duration: number,
    preferredDate: Date
  ): Promise<TimeSlot | null> {
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    const startHour = 9;
    const endHour = 17;
    
    const availableSlots: TimeSlot[] = [];
    for (let hour = startHour; hour < endHour - Math.ceil(duration / 60); hour++) {
      const start = new Date(preferredDate);
      start.setHours(hour, 0, 0, 0);
      
      const end = new Date(start);
      end.setMinutes(end.getMinutes() + duration);
      
      availableSlots.push({
        start,
        end,
        isAvailable: true
      });
    }
    
    return availableSlots[0] || null;
  }
  
  static async createMeeting(formData: MeetingFormData): Promise<Meeting> {
    const commonTime = await this.findCommonFreeTime(
      formData.participants.map(email => ({
        id: Math.random().toString(),
        name: email.split('@')[0],
        email,
        availability: []
      })),
      formData.duration,
      formData.preferredDate
    );
    
    if (!commonTime) {
      throw new Error('No common free time found');
    }
    
    const meeting: Meeting = {
      id: Math.random().toString(),
      title: formData.title,
      description: formData.description,
      participants: formData.participants.map(email => ({
        id: Math.random().toString(),
        name: email.split('@')[0],
        email,
        availability: []
      })),
      startTime: commonTime.start,
      endTime: commonTime.end,
      duration: formData.duration,
      status: 'scheduled',
      createdAt: new Date(),
      updatedAt: new Date()
    };
    
    return meeting;
  }
  
  static async sendMeetingInvitation(meeting: Meeting): Promise<void> {
    console.log(`Sending meeting invitation to: ${meeting.participants.map(p => p.email).join(', ')}`);
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  static async sendReminder(meeting: Meeting): Promise<void> {
    console.log(`Sending reminder for meeting: ${meeting.title}`);
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  static async rescheduleMeeting(meeting: Meeting, newTimeSlot: TimeSlot): Promise<Meeting> {
    const updatedMeeting = {
      ...meeting,
      startTime: newTimeSlot.start,
      endTime: newTimeSlot.end,
      status: 'rescheduled' as const,
      updatedAt: new Date()
    };
    
    await this.sendMeetingInvitation(updatedMeeting);
    
    return updatedMeeting;
  }
}
