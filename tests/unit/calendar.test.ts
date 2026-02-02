import { beforeEach, describe, expect, it, vi } from "vitest";
import { checkAvailability, createMeetingWithAvailabilityCheck } from "@/lib/google/calendar";
import { callGoogleAPI } from "@/lib/google/tokens";

vi.mock("@/lib/google/tokens", () => ({
  callGoogleAPI: vi.fn(),
}));

const callGoogleAPIMock = vi.mocked(callGoogleAPI);

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

  it("createMeetingWithAvailabilityCheck creates an event when available", async () => {
    callGoogleAPIMock
      .mockResolvedValueOnce({
        calendars: { primary: { busy: [] } },
      })
      .mockResolvedValueOnce({
        id: "evt_123",
        summary: "Test",
        start: { dateTime: "2030-01-01T10:00:00Z" },
        end: { dateTime: "2030-01-01T11:00:00Z" },
      });

    const result = await createMeetingWithAvailabilityCheck(
      "token",
      {
        summary: "Test",
        start: { dateTime: "2030-01-01T10:00:00Z" },
        end: { dateTime: "2030-01-01T11:00:00Z" },
      },
      "primary"
    );

    expect(result.success).toBe(true);
    expect(result.event?.id).toBe("evt_123");
  });
});
