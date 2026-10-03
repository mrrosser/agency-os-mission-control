import { callGoogleAPI } from "./tokens";
import { ApiError } from "@/lib/api/handler";
import type { Logger } from "@/lib/logging";

const CALENDAR_API_BASE = 'https://www.googleapis.com/calendar/v3';
const LEGACY_MUTATION_DISABLED = "Legacy calendar mutations are disabled. Use the reviewed calendar workflow.";

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
    conferenceData?: {
        entryPoints?: Array<{ uri?: string }>;
    };
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
 * Retained for caller compatibility; calendar writes require the reviewed workflow.
 */
export async function createEvent(
    _accessToken: string,
    _event: CreateEventInput,
    _log?: Logger
): Promise<CalendarEvent> {
    throw new ApiError(409, LEGACY_MUTATION_DISABLED);
}

/**
 * Retained for caller compatibility; legacy calendar updates are disabled.
 */
export async function updateEvent(
    _accessToken: string,
    _eventId: string,
    _event: Partial<CreateEventInput>,
    _log?: Logger
): Promise<CalendarEvent> {
    throw new ApiError(409, LEGACY_MUTATION_DISABLED);
}

/**
 * Retained for caller compatibility; legacy calendar deletion is disabled.
 */
export async function deleteEvent(
    _accessToken: string,
    _eventId: string,
    _log?: Logger
): Promise<void> {
    throw new ApiError(409, LEGACY_MUTATION_DISABLED);
}

interface FreeBusyResponse {
    calendars?: Record<string, { busy?: Array<{ start: string; end: string }> }>;
}

export interface BusyInterval {
    start: string;
    end: string;
}

/**
 * List busy intervals for a time window using the FreeBusy API.
 */
export async function listBusyIntervals(
    accessToken: string,
    timeMin: Date,
    timeMax: Date,
    calendarId: string = "primary",
    log?: Logger
): Promise<BusyInterval[]> {
    if (Number.isNaN(timeMin.valueOf()) || Number.isNaN(timeMax.valueOf())) {
        throw new Error("Invalid timeMin or timeMax");
    }

    const response = await callGoogleAPI<FreeBusyResponse>(
        `${CALENDAR_API_BASE}/freeBusy`,
        accessToken,
        {
            method: "POST",
            body: JSON.stringify({
                timeMin: timeMin.toISOString(),
                timeMax: timeMax.toISOString(),
                items: [{ id: calendarId }],
            }),
        },
        log
    );

    return (response.calendars?.[calendarId]?.busy || []).map((range) => ({
        start: range.start,
        end: range.end,
    }));
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
 * Retained for caller compatibility; reviewed creation owns availability and writes.
 */
export async function createMeetingWithAvailabilityCheck(
    _accessToken: string,
    _event: CreateEventInput,
    _calendarId: string = "primary",
    _log?: Logger
): Promise<CreateMeetingResult> {
    throw new ApiError(409, LEGACY_MUTATION_DISABLED);
}
