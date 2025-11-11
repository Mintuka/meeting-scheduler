import { Meeting, MeetingFormData, AvailabilitySuggestion, Poll, Room, RoomAvailability } from '../types';
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

  // Event methods
  static async getEvents(): Promise<Event[]> {
    const events = await this.makeRequest<any[]>('/api/events');
    return events.map(event => this.transformEventFromAPI(event));
  }

  static async getEvent(eventId: string): Promise<Event> {
    const event = await this.makeRequest<any>(`/api/events/${eventId}`);
    return this.transformEventFromAPI(event);
  }

  static async createEvent(formData: EventFormData): Promise<Event> {
    // Parse the date string manually to avoid timezone issues
    const [year, month, day] = formData.eventDate.split('-').map(Number);
    const eventDate = new Date(year, month - 1, day);
    const startTimeStr = formData.startTime;
    const endTimeStr = formData.endTime;
    
    // Create start datetime by combining date with start time
    const startTime = new Date(eventDate.getFullYear(), eventDate.getMonth(), eventDate.getDate());
    const [startHour, startMinute] = startTimeStr.split(':').map(Number);
    startTime.setHours(startHour, startMinute, 0, 0);
    
    // Create end datetime by combining date with end time
    const endTime = new Date(eventDate.getFullYear(), eventDate.getMonth(), eventDate.getDate());
    const [endHour, endMinute] = endTimeStr.split(':').map(Number);
    endTime.setHours(endHour, endMinute, 0, 0);

    const apiData = {
      title: formData.title,
      description: formData.description || undefined,
      start_time: startTime.toISOString(),
      end_time: endTime.toISOString(),
      location: formData.location || undefined,
      category: formData.category || undefined,
    };

    const event = await this.makeRequest<any>('/api/events', {
      method: 'POST',
      body: JSON.stringify(apiData),
    });

    return this.transformEventFromAPI(event);
  }

  static async updateEvent(eventId: string, updateData: Partial<Event>): Promise<Event> {
    const apiData: any = {
      title: updateData.title,
      description: updateData.description,
      start_time: updateData.startTime ? updateData.startTime.toISOString() : undefined,
      end_time: updateData.endTime ? updateData.endTime.toISOString() : undefined,
      location: updateData.location,
      category: updateData.category,
      status: updateData.status,
      metadata: updateData.metadata
    };

    const event = await this.makeRequest<any>(`/api/events/${eventId}`, {
      method: 'PUT',
      body: JSON.stringify(apiData),
    });

    return this.transformEventFromAPI(event);
  }

  static async deleteEvent(eventId: string): Promise<void> {
    await this.makeRequest(`/api/events/${eventId}`, {
      method: 'DELETE',
    });
  }

  // Helper method to transform API response to frontend format
  private static transformEventFromAPI(apiEvent: any): Event {
    const parseDate = (value: string | Date | undefined | null): Date => {
      if (!value) return new Date(NaN);
      if (value instanceof Date) return value;
      const hasTimezone = /[zZ]|[+-]\d{2}:?\d{2}$/.test(value);
      const normalized = hasTimezone ? value : `${value}Z`;
      return new Date(normalized);
    };

    return {
      id: apiEvent.id || apiEvent._id,
      title: apiEvent.title,
      description: apiEvent.description,
      startTime: parseDate(apiEvent.start_time),
      endTime: parseDate(apiEvent.end_time),
      location: apiEvent.location,
      category: apiEvent.category,
      status: apiEvent.status,
      creatorEmail: apiEvent.creator_email,
      createdAt: new Date(apiEvent.created_at),
      updatedAt: new Date(apiEvent.updated_at),
      metadata: apiEvent.metadata || {}
    };
  }

  // Poll methods
  static async createPoll(meetingId: string, pollData: PollCreate): Promise<Poll> {
    const apiPoll = await this.makeRequest<any>(`/api/meetings/${meetingId}/polls`, {
      method: 'POST',
      body: JSON.stringify({
        meeting_id: meetingId,
        question: pollData.question,
        options: pollData.options
      })
    });
    return this.transformPollFromAPI(apiPoll);
  }

  static async getMeetingPolls(meetingId: string): Promise<Poll[]> {
    const apiPolls = await this.makeRequest<any[]>(`/api/meetings/${meetingId}/polls`);
    return apiPolls.map(poll => this.transformPollFromAPI(poll));
  }

  static async getPoll(pollId: string): Promise<Poll> {
    const apiPoll = await this.makeRequest<any>(`/api/polls/${pollId}`);
    return this.transformPollFromAPI(apiPoll);
  }

  static async voteOnPoll(pollId: string, optionId: string): Promise<Poll> {
    const apiPoll = await this.makeRequest<any>(`/api/polls/${pollId}/vote`, {
      method: 'POST',
      body: JSON.stringify({ option_id: optionId })
    });
    return this.transformPollFromAPI(apiPoll);
  }

  static async closePoll(pollId: string): Promise<Poll> {
    const apiPoll = await this.makeRequest<any>(`/api/polls/${pollId}/close`, {
      method: 'POST'
    });
    return this.transformPollFromAPI(apiPoll);
  }

  static async deletePoll(pollId: string): Promise<void> {
    await this.makeRequest(`/api/polls/${pollId}`, {
      method: 'DELETE'
    });
  }

  private static transformPollFromAPI(apiPoll: any): Poll {
    return {
      id: apiPoll.id || apiPoll._id,
      meetingId: apiPoll.meeting_id,
      question: apiPoll.question,
      options: apiPoll.options.map((opt: any) => ({
        id: opt.id,
        text: opt.text,
        votes: opt.votes || []
      })),
      creatorEmail: apiPoll.creator_email,
      createdAt: new Date(apiPoll.created_at),
      updatedAt: new Date(apiPoll.updated_at),
      isClosed: apiPoll.is_closed || false
    };
  }
}
