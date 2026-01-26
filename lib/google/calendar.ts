import { callGoogleAPI } from "./tokens";
import type { Logger } from "@/lib/logging";

const CALENDAR_API_BASE = 'https://www.googleapis.com/calendar/v3';

export interface CalendarEvent {
    id?: string;
    summary: string;
    description?: string;
    start: {
        dateTime: string;
        timeZone?: string;
    };
    end: {
        dateTime: string;
        timeZone?: string;
    };
    attendees?: Array<{
        email: string;
        displayName?: string;
    }>;
    location?: string;
    conferenceData?: {
        createRequest?: {
            requestId: string;
            conferenceSolutionKey: {
                type: 'hangoutsMeet';
            };
        };
    };
}

export interface FreeBusyRequest {
    timeMin: string;
    timeMax: string;
    timeZone?: string;
    items: Array<{
        id: string;
    }>;
}

export interface FreeBusyResponse {
    calendars: {
        [calendarId: string]: {
            busy: Array<{
                start: string;
                end: string;
            }>;
        };
    };
}

/**
 * Check if a time slot is available (no conflicts)
 */
export async function checkAvailability(
    accessToken: string,
    startTime: Date,
    endTime: Date,
    calendarId: string = 'primary',
    log?: Logger
): Promise<boolean> {
    const request: FreeBusyRequest = {
        timeMin: startTime.toISOString(),
        timeMax: endTime.toISOString(),
        items: [{ id: calendarId }],
    };

    const response = await callGoogleAPI<FreeBusyResponse>(
        `${CALENDAR_API_BASE}/freeBusy`,
        accessToken,
        {
            method: 'POST',
            body: JSON.stringify(request),
        },
        log
    );

    const busySlots = response.calendars[calendarId]?.busy || [];

    // If there are no busy slots, the time is available
    return busySlots.length === 0;
}

/**
 * Create a calendar event
 */
export async function createCalendarEvent(
    accessToken: string,
    event: CalendarEvent,
    calendarId: string = 'primary',
    sendUpdates: boolean = true,
    log?: Logger
): Promise<CalendarEvent> {
    const queryParams = new URLSearchParams({
        sendUpdates: sendUpdates ? 'all' : 'none',
        conferenceDataVersion: '1', // Enable Google Meet links
    });

    const response = await callGoogleAPI<CalendarEvent>(
        `${CALENDAR_API_BASE}/calendars/${calendarId}/events?${queryParams}`,
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
 * List upcoming events
 */
export async function listUpcomingEvents(
    accessToken: string,
    maxResults: number = 10,
    calendarId: string = 'primary',
    log?: Logger
): Promise<CalendarEvent[]> {
    const queryParams = new URLSearchParams({
        maxResults: maxResults.toString(),
        orderBy: 'startTime',
        singleEvents: 'true',
        timeMin: new Date().toISOString(),
    });

    const response = await callGoogleAPI<{ items: CalendarEvent[] }>(
        `${CALENDAR_API_BASE}/calendars/${calendarId}/events?${queryParams}`,
        accessToken,
        {},
        log
    );

    return response.items || [];
}

/**
 * Create a meeting invite with automatic availability check
 */
export async function createMeetingWithAvailabilityCheck(
    accessToken: string,
    event: CalendarEvent,
    calendarId: string = 'primary',
    log?: Logger
): Promise<{ success: boolean; event?: CalendarEvent; error?: string }> {
    try {
        // Check if the time slot is available
        const isAvailable = await checkAvailability(
            accessToken,
            new Date(event.start.dateTime),
            new Date(event.end.dateTime),
            calendarId,
            log
        );

        if (!isAvailable) {
            return {
                success: false,
                error: 'Time slot is not available. Please choose a different time.',
            };
        }

        // Create the event
        const createdEvent = await createCalendarEvent(accessToken, event, calendarId, true, log);

        return {
            success: true,
            event: createdEvent,
        };
    } catch (error: any) {
        return {
            success: false,
            error: error.message || 'Failed to create calendar event',
        };
    }
}
