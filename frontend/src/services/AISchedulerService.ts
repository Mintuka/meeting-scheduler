import { Meeting, Participant, TimeSlot, MeetingFormData } from '../types';

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';

export class AISchedulerService {
  private static async makeRequest<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${API_BASE_URL}${endpoint}`;
    
    const defaultHeaders = {
      'Content-Type': 'application/json',
      // Add Bearer token if you implement authentication
      // 'Authorization': `Bearer ${token}`,
    };

    const response = await fetch(url, {
      ...options,
      headers: {
        ...defaultHeaders,
        ...options.headers,
      },
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.detail || `HTTP error! status: ${response.status}`);
    }

    return response.json();
  }

  static async getMeetings(): Promise<Meeting[]> {
    const meetings = await this.makeRequest<any[]>('/api/meetings');
    return meetings.map(meeting => this.transformMeetingFromAPI(meeting));
  }

  static async getMeeting(meetingId: string): Promise<Meeting> {
    const meeting = await this.makeRequest<any>(`/api/meetings/${meetingId}`);
    return this.transformMeetingFromAPI(meeting);
  }

  static async createMeeting(formData: MeetingFormData): Promise<Meeting> {
    // Parse the date string manually to avoid timezone issues
    const [year, month, day] = formData.preferredDate.split('-').map(Number);
    const meetingDate = new Date(year, month - 1, day); // month is 0-indexed in Date constructor
    const startTimeStr = formData.startTime;
    const endTimeStr = formData.endTime;
    
    // Create start datetime by combining date with start time
    // Use local timezone to avoid UTC conversion issues
    const startTime = new Date(meetingDate.getFullYear(), meetingDate.getMonth(), meetingDate.getDate());
    const [startHour, startMinute] = startTimeStr.split(':').map(Number);
    startTime.setHours(startHour, startMinute, 0, 0);
    
    // Create end datetime by combining date with end time
    const endTime = new Date(meetingDate.getFullYear(), meetingDate.getMonth(), meetingDate.getDate());
    const [endHour, endMinute] = endTimeStr.split(':').map(Number);
    endTime.setHours(endHour, endMinute, 0, 0);

    const apiData = {
      title: formData.title,
      description: formData.description,
      participants: formData.participants,
      start_time: startTime.toISOString(),
      end_time: endTime.toISOString(),
      preferred_date: meetingDate.toISOString(),
      metadata: {
        preferred_time_slots: formData.preferredTimeSlots?.map(slot => ({
          start: slot.start.toISOString(),
          end: slot.end.toISOString(),
          is_available: slot.isAvailable
        })) || []
      }
    };

    const meeting = await this.makeRequest<any>('/api/meetings', {
      method: 'POST',
      body: JSON.stringify(apiData),
    });

    return this.transformMeetingFromAPI(meeting);
  }

  static async updateMeeting(meetingId: string, updateData: Partial<Meeting>): Promise<Meeting> {
    const apiData = {
      title: updateData.title,
      description: updateData.description,
      start_time: updateData.startTime?.toISOString(),
      end_time: updateData.endTime?.toISOString(),
      status: updateData.status,
      metadata: updateData.metadata
    };

    const meeting = await this.makeRequest<any>(`/api/meetings/${meetingId}`, {
      method: 'PUT',
      body: JSON.stringify(apiData),
    });

    return this.transformMeetingFromAPI(meeting);
  }

  static async deleteMeeting(meetingId: string): Promise<void> {
    await this.makeRequest(`/api/meetings/${meetingId}`, {
      method: 'DELETE',
    });
  }

  static async sendMeetingInvitation(meeting: Meeting): Promise<void> {
    // For now, we'll just log this since the backend doesn't have a specific endpoint for this
    console.log(`Sending meeting invitation to: ${meeting.participants.map(p => p.email).join(', ')}`);
    
    // You could implement this by calling a notification service or email service
    // For example:
    // await this.makeRequest(`/api/meetings/${meeting.id}/send-invitation`, {
    //   method: 'POST',
    // });
  }

  static async sendReminder(meetingId: string): Promise<void> {
    await this.makeRequest(`/api/meetings/${meetingId}/send-reminder`, {
      method: 'POST',
    });
  }

  static async findCommonFreeTime(
    participants: Participant[],
    duration: number,
    preferredDate: Date
  ): Promise<TimeSlot | null> {
    // This would typically call an AI service or availability service
    // For now, we'll simulate finding a common time
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

  static async rescheduleMeeting(meeting: Meeting, newTimeSlot: TimeSlot): Promise<Meeting> {
    const updateData = {
      start_time: newTimeSlot.start.toISOString(),
      end_time: newTimeSlot.end.toISOString(),
      status: 'rescheduled' as const,
    };

    const updatedMeeting = await this.updateMeeting(meeting.id, updateData);
    
    // Send new invitation
    await this.sendMeetingInvitation(updatedMeeting);
    
    return updatedMeeting;
  }

  // Helper method to transform API response to frontend format
  private static transformMeetingFromAPI(apiMeeting: any): Meeting {
    return {
      id: apiMeeting.id || apiMeeting._id,
      title: apiMeeting.title,
      description: apiMeeting.description,
      participants: apiMeeting.participants?.map((p: any) => ({
        id: p.id,
        name: p.name,
        email: p.email,
        availability: p.availability?.map((a: any) => ({
          start: new Date(a.start),
          end: new Date(a.end),
          isAvailable: a.is_available
        })) || []
      })) || [],
      startTime: new Date(apiMeeting.start_time),
      endTime: new Date(apiMeeting.end_time),
      duration: this.calculateDuration(apiMeeting.start_time, apiMeeting.end_time),
      status: apiMeeting.status,
      createdAt: new Date(apiMeeting.created_at),
      updatedAt: new Date(apiMeeting.updated_at),
      metadata: apiMeeting.metadata || {}
    };
  }

  // Helper method to calculate duration from start and end times
  private static calculateDuration(startTime: string | Date, endTime: string | Date): number {
    const start = new Date(startTime);
    const end = new Date(endTime);
    return Math.round((end.getTime() - start.getTime()) / (1000 * 60)); // Duration in minutes
  }
}
