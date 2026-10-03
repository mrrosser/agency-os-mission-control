import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkAvailability,
  createEvent,
  createMeetingWithAvailabilityCheck,
  deleteEvent,
  updateEvent,
  type CreateEventInput,
} from "@/lib/google/calendar";
import { callGoogleAPI } from "@/lib/google/tokens";
import { ApiError } from "@/lib/api/handler";

vi.mock("@/lib/google/tokens", () => ({
  callGoogleAPI: vi.fn(),
}));

const callGoogleAPIMock = vi.mocked(callGoogleAPI);
const event: CreateEventInput = {
  summary: "Test",
  start: { dateTime: "2030-01-01T10:00:00Z", timeZone: "UTC" },
  end: { dateTime: "2030-01-01T11:00:00Z", timeZone: "UTC" },
  attendees: [{ email: "guest@example.com" }],
  conferenceData: { createRequest: { requestId: "test-conference" } },
};

describe("calendar helpers", () => {
  beforeEach(() => {
    callGoogleAPIMock.mockReset();
  });

  it("checkAvailability returns true when no busy slots", async () => {
    callGoogleAPIMock.mockResolvedValueOnce({
      calendars: { primary: { busy: [] } },
    });

    const result = await checkAvailability(
      "token",
      new Date("2030-01-01T10:00:00Z"),
      new Date("2030-01-01T11:00:00Z"),
      "primary"
    );

    expect(result).toBe(true);
  });

  it("checkAvailability returns false when busy slots exist", async () => {
    callGoogleAPIMock.mockResolvedValueOnce({
      calendars: { primary: { busy: [{ start: "2030-01-01T10:00:00Z", end: "2030-01-01T11:00:00Z" }] } },
    });

    const result = await checkAvailability(
      "token",
      new Date("2030-01-01T10:00:00Z"),
      new Date("2030-01-01T11:00:00Z"),
      "primary"
    );

    expect(result).toBe(false);
  });

  it.each([
    { name: "createEvent", invoke: () => createEvent("token", event) },
    { name: "updateEvent", invoke: () => updateEvent("token", "existing-event", { summary: "Changed" }) },
    { name: "deleteEvent", invoke: () => deleteEvent("token", "existing-event") },
    { name: "meeting with implicit calendar", invoke: () => createMeetingWithAvailabilityCheck("token", event) },
    { name: "meeting with primary calendar", invoke: () => createMeetingWithAvailabilityCheck("token", event, "primary") },
    { name: "meeting with explicit calendar", invoke: () => createMeetingWithAvailabilityCheck("token", event, "team@example.com") },
    {
      name: "meeting with missing times",
      invoke: () => createMeetingWithAvailabilityCheck("token", { summary: "Missing times", start: {}, end: {} }),
    },
  ])("blocks legacy $name with 409 before any provider call", async ({ invoke }) => {
    const attempt = invoke();
    await expect(attempt).rejects.toBeInstanceOf(ApiError);
    await expect(attempt).rejects.toMatchObject({
      status: 409,
      message: "Legacy calendar mutations are disabled. Use the reviewed calendar workflow.",
    });
    expect(callGoogleAPIMock).not.toHaveBeenCalled();
  });
});
