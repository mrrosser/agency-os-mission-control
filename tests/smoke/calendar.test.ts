import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMeetingWithAvailabilityCheck } from "@/lib/google/calendar";
import { callGoogleAPI } from "@/lib/google/tokens";

vi.mock("@/lib/google/tokens", () => ({ callGoogleAPI: vi.fn() }));
const callGoogleAPIMock = vi.mocked(callGoogleAPI);

describe("legacy calendar mutation smoke", () => {
  beforeEach(() => { callGoogleAPIMock.mockReset(); });

  it("rejects the unreviewed legacy meeting helper even when times are missing", async () => {
    await expect(createMeetingWithAvailabilityCheck("test-only-token", {
      summary: "Missing times", start: {}, end: {},
    }, "primary")).rejects.toMatchObject({ status: 409 });
    expect(callGoogleAPIMock).not.toHaveBeenCalled();
  });

  it("rejects a complete event instead of performing availability checks or creation", async () => {
    await expect(createMeetingWithAvailabilityCheck("test-only-token", {
      summary: "Unreviewed event", start: { dateTime: "2026-10-05T14:00:00Z" }, end: { dateTime: "2026-10-05T14:30:00Z" },
    }, "work@example.test")).rejects.toMatchObject({ status: 409 });
    expect(callGoogleAPIMock).not.toHaveBeenCalled();
  });
});
