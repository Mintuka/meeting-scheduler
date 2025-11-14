import { Meeting, MeetingFormData, AvailabilitySuggestion, Poll, Room, RoomAvailability, Event, EventFormData } from '../types';
import { buildDateTimeInTimeZone, getBrowserTimeZone } from '../utils/timezone';

declare global {
  namespace NodeJS {
    interface ProcessEnv {
      REACT_APP_API_URL?: string;
    }
  }
}

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';

export class AISchedulerService {
  private static authToken: string | null = localStorage.getItem('accessToken');

  static setAuthToken(token: string | null) {
    this.authToken = token;
  }

  private static async makeRequest<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = `${API_BASE_URL}${endpoint}`;
    const headers = new Headers(options.headers || {});
    if (!headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
    if (this.authToken) {
      headers.set('Authorization', `Bearer ${this.authToken}`);
    }

    const response = await fetch(url, {
      ...options,
      headers,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.detail || `HTTP error! status: ${response.status}`);
    }

    return response.json();
  }

  static async getGoogleAuthUrl(redirectUri?: string): Promise<{ auth_url: string }> {
    const query = redirectUri ? `?redirect_uri=${encodeURIComponent(redirectUri)}` : '';
    return this.makeRequest(`/api/auth/google/login${query}`);
  }

  static async getCurrentUser(): Promise<any> {
    return this.makeRequest('/api/me');
  }

  static async getCalendarEvents(timeMin: Date, timeMax: Date): Promise<any[]> {
    const params = new URLSearchParams({
      time_min: timeMin.toISOString(),
      time_max: timeMax.toISOString(),
    });
    const { events } = await this.makeRequest<{ events: any[] }>(`/api/calendars/events?${params.toString()}`);
    return events;
  }

  static async suggestAvailability(payload: {
    participants: string[];
    durationMinutes: number;
    windowStart: Date;
    windowEnd: Date;
    slotIncrementMinutes?: number;
    maxSuggestions?: number;
    clientTimezone?: string;
  }): Promise<{
    suggestions: AvailabilitySuggestion[];
    participants_missing: string[];
    participants_missing_details: Record<string, string>;
  }> {
    const body = {
      participants: payload.participants,
      duration_minutes: payload.durationMinutes,
      window_start: payload.windowStart.toISOString(),
      window_end: payload.windowEnd.toISOString(),
      slot_increment_minutes: payload.slotIncrementMinutes ?? 30,
      max_suggestions: payload.maxSuggestions ?? 5,
      client_timezone: payload.clientTimezone,
    };
    return this.makeRequest('/api/availability/suggest', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  static async createPoll(meetingId: string, options: { start: string; end: string }[], deadline?: Date): Promise<Poll> {
    const payload = {
      options: options.map(opt => ({ start_time: opt.start, end_time: opt.end })),
      deadline: deadline ? deadline.toISOString() : undefined,
    };
    return this.makeRequest(`/api/meetings/${meetingId}/polls`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  static async getMeetingPolls(meetingId: string): Promise<Poll[]> {
    return this.makeRequest<Poll[]>(`/api/meetings/${meetingId}/polls`);
  }

  static async getPoll(
    pollId: string,
    options?: { token?: string; voterEmail?: string }
  ): Promise<Poll> {
    const params = new URLSearchParams();
    if (options?.token) {
      params.set('token', options.token);
    }
    if (options?.voterEmail) {
      params.set('voter_email', options.voterEmail);
    }
    const query = params.toString();
    const path = query ? `/api/polls/${pollId}?${query}` : `/api/polls/${pollId}`;
    return this.makeRequest(path);
  }

  static async votePoll(pollId: string, optionId: string, token?: string, voterEmail?: string): Promise<Poll> {
    return this.makeRequest(`/api/polls/${pollId}/vote`, {
      method: 'POST',
      body: JSON.stringify({ option_id: optionId, token, voter_email: voterEmail }),
    });
  }

  static async finalizePoll(pollId: string, optionId?: string): Promise<Poll> {
    return this.makeRequest(`/api/polls/${pollId}/finalize`, {
      method: 'POST',
      body: JSON.stringify({ option_id: optionId }),
    });
  }

  static async voteOnPoll(pollId: string, optionId: string): Promise<Poll> {
    return this.makeRequest(`/api/polls/${pollId}/vote`, {
      method: 'POST',
      body: JSON.stringify({ option_id: optionId }),
    });
  }

  static async closePoll(pollId: string): Promise<Poll> {
    return this.makeRequest(`/api/polls/${pollId}/close`, {
      method: 'POST',
    });
  }

  static async deletePoll(pollId: string): Promise<void> {
    await this.makeRequest(`/api/polls/${pollId}`, {
      method: 'DELETE',
    });
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
    const resolvedTZ = formData.clientTimezone || getBrowserTimeZone();
    const startTime = buildDateTimeInTimeZone(formData.preferredDate, formData.startTime, resolvedTZ);
    const endTime = buildDateTimeInTimeZone(formData.preferredDate, formData.endTime, resolvedTZ);
    const preferredDateTime = buildDateTimeInTimeZone(formData.preferredDate, '00:00', resolvedTZ);

    if (!startTime || !endTime || !preferredDateTime) {
      throw new Error('Invalid date or time selection.');
    }

    const metadata: Record<string, any> = {
      preferred_time_slots: formData.preferredTimeSlots?.map(slot => ({
        start: slot.start.toISOString(),
        end: slot.end.toISOString(),
        is_available: slot.isAvailable,
      })) || [],
      location_type: formData.locationType,
      duration_minutes: formData.durationMinutes,
    };
    if (formData.locationType === 'onsite' && formData.roomId) {
      metadata.room_id = formData.roomId;
    }
    metadata.requested_timezone = resolvedTZ;
    metadata.timezone = resolvedTZ;
    metadata.manual_time_mode = Boolean(formData.manualTimeMode);
    if (formData.pollPending) {
      metadata.poll_pending = true;
    }
    if (formData.selectedSuggestionStart) {
      metadata.selected_suggestion_start = formData.selectedSuggestionStart;
    }

    const apiData = {
      title: formData.title,
      description: formData.description,
      participants: formData.participants,
      start_time: startTime.toISOString(),
      end_time: endTime.toISOString(),
      preferred_date: preferredDateTime.toISOString(),
      metadata,
    };

    const meeting = await this.makeRequest<any>('/api/meetings', {
      method: 'POST',
      body: JSON.stringify(apiData),
    });

    return this.transformMeetingFromAPI(meeting);
  }

  static async updateMeeting(meetingId: string, updateData: Partial<Meeting>, participantsEmails?: string[]): Promise<Meeting> {
    const apiData: any = {
      title: updateData.title,
      description: updateData.description,
      start_time: updateData.startTime ? updateData.startTime.toISOString() : undefined,
      end_time: updateData.endTime ? updateData.endTime.toISOString() : undefined,
      status: updateData.status,
      metadata: updateData.metadata,
    };
    if (participantsEmails) {
      apiData.participants_emails = participantsEmails;
    }

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
    await this.makeRequest(`/api/meetings/${meeting.id}/send-invitation`, {
      method: 'POST',
    });
  }

  static async sendReminder(meetingId: string): Promise<void> {
    await this.makeRequest(`/api/meetings/${meetingId}/send-reminder`, {
      method: 'POST',
    });
  }

  static async sendUpdateNotification(meetingId: string, changesDescription: string): Promise<void> {
    await this.makeRequest(`/api/meetings/${meetingId}/send-update`, {
      method: 'POST',
      body: JSON.stringify({ changes_description: changesDescription }),
    });
  }

  static async sendCancellationNotification(meetingId: string, cancellationReason: string): Promise<void> {
    await this.makeRequest(`/api/meetings/${meetingId}/send-cancellation`, {
      method: 'POST',
      body: JSON.stringify({ cancellation_reason: cancellationReason }),
    });
  }

  static async generateMeetLink(meetingId: string): Promise<Meeting> {
    const meeting = await this.makeRequest<any>(`/api/meetings/${meetingId}/generate-meet-link`, {
      method: 'POST',
    });
    return this.transformMeetingFromAPI(meeting);
  }

  static async addParticipants(meetingId: string, emails: string[]): Promise<Meeting> {
    const meeting = await this.makeRequest<any>(`/api/meetings/${meetingId}/participants`, {
      method: 'POST',
      body: JSON.stringify({ emails }),
    });
    return this.transformMeetingFromAPI(meeting);
  }

  static async getRooms(): Promise<Room[]> {
    return this.makeRequest('/api/rooms');
  }

  static async getRoomAvailability(startTime: Date, endTime: Date, excludeMeetingId?: string): Promise<RoomAvailability[]> {
    const params = new URLSearchParams({
      start_time: startTime.toISOString(),
      end_time: endTime.toISOString(),
    });
    if (excludeMeetingId) {
      params.append('exclude_meeting_id', excludeMeetingId);
    }
    const { rooms } = await this.makeRequest<{ rooms: RoomAvailability[] }>(`/api/rooms/availability?${params.toString()}`);
    return rooms;
  }

  static async rescheduleMeeting(meeting: Meeting, newSlot: { start: Date; end: Date }): Promise<Meeting> {
    const metadata = { ...(meeting.metadata || {}) };
    return this.updateMeeting(
      meeting.id,
      {
        startTime: newSlot.start,
        endTime: newSlot.end,
        metadata,
      },
      meeting.participants.map(p => p.email)
    );
  }

  static async conversationalSchedule(
    message: string,
    timezone?: string
  ): Promise<{
    success: boolean;
    meeting?: Meeting;
    requires_clarification: boolean;
    clarification_message?: string;
    parsed_data?: any;
    error?: string;
  }> {
    const response = await this.makeRequest<any>('/api/ai/schedule', {
      method: 'POST',
      body: JSON.stringify({
        message,
        timezone: timezone || getBrowserTimeZone(),
      }),
    });

    if (response.success && response.meeting) {
      return {
        ...response,
        meeting: this.transformMeetingFromAPI(response.meeting),
      };
    }

    return response;
  }

  static async createEvent(formData: EventFormData): Promise<Event> {
    // Parse the date and time strings into Date objects
    const [year, month, day] = formData.eventDate.split('-').map(Number);
    const [startHour, startMinute] = formData.startTime.split(':').map(Number);
    const [endHour, endMinute] = formData.endTime.split(':').map(Number);
    
    const startTime = new Date(year, month - 1, day, startHour, startMinute);
    const endTime = new Date(year, month - 1, day, endHour, endMinute);
    
    const payload = {
      title: formData.title,
      description: formData.description || '',
      start_time: startTime.toISOString(),
      end_time: endTime.toISOString(),
      location: formData.location,
      category: formData.category,
      metadata: {},
    };
    
    const event = await this.makeRequest<any>('/api/events', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    
    return this.transformEventFromAPI(event);
  }

  static async getEvents(): Promise<Event[]> {
    const events = await this.makeRequest<any[]>('/api/events');
    return events.map(event => this.transformEventFromAPI(event));
  }

  static async getEvent(eventId: string): Promise<Event> {
    const event = await this.makeRequest<any>(`/api/events/${eventId}`);
    return this.transformEventFromAPI(event);
  }

  static async updateEvent(eventId: string, updateData: Partial<Event>): Promise<Event> {
    const payload: any = {
      title: updateData.title,
      description: updateData.description,
      location: updateData.location,
      category: updateData.category,
      status: updateData.status,
    };
    
    if (updateData.startTime) {
      payload.start_time = updateData.startTime.toISOString();
    }
    if (updateData.endTime) {
      payload.end_time = updateData.endTime.toISOString();
    }
    
    const event = await this.makeRequest<any>(`/api/events/${eventId}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
    
    return this.transformEventFromAPI(event);
  }

  static async deleteEvent(eventId: string): Promise<void> {
    await this.makeRequest(`/api/events/${eventId}`, {
      method: 'DELETE',
    });
  }

  private static transformEventFromAPI(apiEvent: any): Event {
    return {
      id: apiEvent.id || apiEvent._id,
      title: apiEvent.title,
      description: apiEvent.description,
      startTime: new Date(apiEvent.start_time),
      endTime: new Date(apiEvent.end_time),
      status: apiEvent.status,
      location: apiEvent.location,
      category: apiEvent.category,
    };
  }

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
          isAvailable: a.is_available,
        })) || [],
      })) || [],
      startTime: new Date(apiMeeting.start_time),
      endTime: new Date(apiMeeting.end_time),
      duration: this.calculateDuration(apiMeeting.start_time, apiMeeting.end_time),
      status: apiMeeting.status,
      organizerEmail: apiMeeting.organizer_email,
      createdAt: new Date(apiMeeting.created_at),
      updatedAt: new Date(apiMeeting.updated_at),
      metadata: apiMeeting.metadata || {},
    };
  }

  private static calculateDuration(startTime: string | Date, endTime: string | Date): number {
    const start = new Date(startTime);
    const end = new Date(endTime);
    return Math.round((end.getTime() - start.getTime()) / (1000 * 60));
  }
}
