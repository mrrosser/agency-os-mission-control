import { callGoogleAPI } from "./tokens";
import type { Logger } from "@/lib/logging";

const CALENDAR_API_BASE = 'https://www.googleapis.com/calendar/v3';

export interface CalendarEvent {
    id: string;
    summary: string;
    description?: string;
    start: {
        dateTime?: string;
        date?: string;
        timeZone?: string;
    };
    end: {
        dateTime?: string;
        date?: string;
        timeZone?: string;
    };
    location?: string;
    attendees?: Array<{
        email: string;
        displayName?: string;
        responseStatus?: 'needsAction' | 'declined' | 'tentative' | 'accepted';
    }>;
    htmlLink?: string;
    creator?: {
        email?: string;
        displayName?: string;
    };
}

export interface CreateEventInput {
    summary: string;
    description?: string;
    start: {
        dateTime?: string;
        date?: string;
        timeZone?: string;
    };
    end: {
        dateTime?: string;
        date?: string;
        timeZone?: string;
    };
    location?: string;
    attendees?: Array<{ email: string; displayName?: string }>;
    conferenceData?: unknown;
}

/**
 * List upcoming events from the user's primary calendar
 */
export async function listEvents(
    accessToken: string,
    maxResults: number = 10,
    timeMin?: string,
    log?: Logger
): Promise<{ events: CalendarEvent[]; nextPageToken?: string }> {
    const queryParams = new URLSearchParams({
        maxResults: maxResults.toString(),
        orderBy: 'startTime',
        singleEvents: 'true',
        timeMin: timeMin || new Date().toISOString(),
    });

    const response = await callGoogleAPI<{
        items?: CalendarEvent[];
        nextPageToken?: string;
    }>(
        `${CALENDAR_API_BASE}/calendars/primary/events?${queryParams}`,
        accessToken,
        {},
        log
    );

    return {
        events: response.items || [],
        nextPageToken: response.nextPageToken,
    };
}

/**
 * Create a new calendar event
 */
export async function createEvent(
    accessToken: string,
    event: CreateEventInput,
    log?: Logger
): Promise<CalendarEvent> {
    const response = await callGoogleAPI<CalendarEvent>(
        `${CALENDAR_API_BASE}/calendars/primary/events`,
        accessToken,
        {
            method: 'POST',
            body: JSON.stringify(event),
        },
        log
    );

    return response;
}

/**
 * Update an existing calendar event
 */
export async function updateEvent(
    accessToken: string,
    eventId: string,
    event: Partial<CreateEventInput>,
    log?: Logger
): Promise<CalendarEvent> {
    const response = await callGoogleAPI<CalendarEvent>(
        `${CALENDAR_API_BASE}/calendars/primary/events/${eventId}`,
        accessToken,
        {
            method: 'PATCH',
            body: JSON.stringify(event),
        },
        log
    );

    return response;
}

/**
 * Delete a calendar event
 */
export async function deleteEvent(
    accessToken: string,
    eventId: string,
    log?: Logger
): Promise<void> {
    await callGoogleAPI(
        `${CALENDAR_API_BASE}/calendars/primary/events/${eventId}`,
        accessToken,
        {
            method: 'DELETE',
        },
        log
    );
}

interface FreeBusyResponse {
    calendars?: Record<string, { busy?: Array<{ start: string; end: string }> }>;
}

/**
 * Check if a time range is free on a calendar
 */
export async function checkAvailability(
    accessToken: string,
    start: Date,
    end: Date,
    calendarId: string = "primary",
    log?: Logger
): Promise<boolean> {
    if (Number.isNaN(start.valueOf()) || Number.isNaN(end.valueOf())) {
        throw new Error("Invalid start or end time");
    }

    const response = await callGoogleAPI<FreeBusyResponse>(
        `${CALENDAR_API_BASE}/freeBusy`,
        accessToken,
        {
            method: "POST",
            body: JSON.stringify({
                timeMin: start.toISOString(),
                timeMax: end.toISOString(),
                items: [{ id: calendarId }],
            }),
        },
        log
    );

    const busy = response.calendars?.[calendarId]?.busy || [];
    return busy.length === 0;
}

export interface CreateMeetingResult {
    success: boolean;
    event?: CalendarEvent;
    error?: string;
}

/**
 * Create a meeting only if the time slot is available.
 */
export async function createMeetingWithAvailabilityCheck(
    accessToken: string,
    event: CreateEventInput,
    calendarId: string = "primary",
    log?: Logger
): Promise<CreateMeetingResult> {
    const startTime = event.start.dateTime || event.start.date;
    const endTime = event.end.dateTime || event.end.date;

    if (!startTime || !endTime) {
        return { success: false, error: "Missing start or end time" };
    }

    const start = new Date(startTime);
    const end = new Date(endTime);

    const available = await checkAvailability(accessToken, start, end, calendarId, log);
    if (!available) {
        return { success: false, error: "Calendar conflict" };
    }

    const conferenceParam = event.conferenceData ? "?conferenceDataVersion=1" : "";
    const response = await callGoogleAPI<CalendarEvent>(
        `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events${conferenceParam}`,
        accessToken,
        {
            method: "POST",
            body: JSON.stringify(event),
        },
        log
    );

    return { success: true, event: response };
}
