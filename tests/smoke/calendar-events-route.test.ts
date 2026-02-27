import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/calendar/events/route";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { getAccessTokenForUser } from "@/lib/google/oauth";
import { createEvent, deleteEvent, listEvents } from "@/lib/google/calendar";

vi.mock("@/lib/api/auth", () => ({
  requireFirebaseAuth: vi.fn(),
}));

vi.mock("@/lib/google/oauth", () => ({
  getAccessTokenForUser: vi.fn(),
}));

vi.mock("@/lib/google/calendar", () => ({
  listEvents: vi.fn(),
  createEvent: vi.fn(),
  deleteEvent: vi.fn(),
}));

const requireAuthMock = vi.mocked(requireFirebaseAuth);
const getAccessTokenMock = vi.mocked(getAccessTokenForUser);
const listEventsMock = vi.mocked(listEvents);
const createEventMock = vi.mocked(createEvent);
const deleteEventMock = vi.mocked(deleteEvent);

function createContext() {
  return { params: Promise.resolve({}) };
}

describe("calendar events route", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    requireAuthMock.mockResolvedValue({ uid: "user-1" } as Awaited<ReturnType<typeof requireFirebaseAuth>>);
    getAccessTokenMock.mockResolvedValue("token");
    listEventsMock.mockResolvedValue({
      events: [
        {
          id: "evt-1",
          summary: "Discovery Call - ACME",
          start: { dateTime: "2026-02-27T16:00:00Z" },
          end: { dateTime: "2026-02-27T16:30:00Z" },
        },
        {
          id: "evt-2",
          summary: "Discovery Call - Beta",
          start: { dateTime: "2026-02-27T17:00:00Z" },
          end: { dateTime: "2026-02-27T17:30:00Z" },
        },
        {
          id: "evt-3",
          summary: "Team Sync",
          start: { dateTime: "2026-02-27T18:00:00Z" },
          end: { dateTime: "2026-02-27T18:30:00Z" },
        },
      ],
    });
    createEventMock.mockResolvedValue({
      id: "evt-created",
      summary: "created",
      start: { dateTime: "2026-02-27T16:00:00Z" },
      end: { dateTime: "2026-02-27T16:30:00Z" },
    });
  });

  it("supports cleanup dry-run without deleting matching events", async () => {
    const req = new Request("http://localhost/api/calendar/events?action=cleanup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ summaryPrefix: "Discovery Call -" }),
    });

    const res = await POST(
      req as Parameters<typeof POST>[0],
      createContext() as Parameters<typeof POST>[1]
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.dryRun).toBe(true);
    expect(data.matched).toBe(2);
    expect(data.deleted).toBe(0);
    expect(deleteEventMock).not.toHaveBeenCalled();
  });

  it("deletes matching events when cleanup dryRun is false", async () => {
    const req = new Request("http://localhost/api/calendar/events?action=cleanup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        summaryPrefix: "Discovery Call -",
        dryRun: false,
      }),
    });

    const res = await POST(
      req as Parameters<typeof POST>[0],
      createContext() as Parameters<typeof POST>[1]
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.deleted).toBe(2);
    expect(data.deletedEventIds).toEqual(["evt-1", "evt-2"]);
    expect(deleteEventMock).toHaveBeenCalledTimes(2);
  });
});
