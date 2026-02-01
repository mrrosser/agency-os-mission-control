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
    attendees?: Array<{ email: string }>;
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
