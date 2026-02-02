import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMeetingWithAvailabilityCheck } from "@/lib/google/calendar";
import { callGoogleAPI } from "@/lib/google/tokens";

vi.mock("@/lib/google/tokens", () => ({
  callGoogleAPI: vi.fn(),
}));

const callGoogleAPIMock = vi.mocked(callGoogleAPI);

describe("calendar smoke", () => {
  beforeEach(() => {
    callGoogleAPIMock.mockReset();
  });

  it("returns an error when event times are missing", async () => {
    const result = await createMeetingWithAvailabilityCheck(
      "token",
      {
        summary: "Missing times",
        start: {},
        end: {},
      },
      "primary"
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe("Missing start or end time");
    expect(callGoogleAPIMock).not.toHaveBeenCalled();
  });
});
