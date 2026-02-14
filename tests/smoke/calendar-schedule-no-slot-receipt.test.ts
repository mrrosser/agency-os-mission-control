import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/calendar/schedule/route";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { getAccessTokenForUser } from "@/lib/google/oauth";
import { listBusyIntervals } from "@/lib/google/calendar";
import { recordLeadActionReceipt } from "@/lib/lead-runs/receipts";

vi.mock("@/lib/api/auth", () => ({
  requireFirebaseAuth: vi.fn(),
}));

vi.mock("@/lib/google/oauth", () => ({
  getAccessTokenForUser: vi.fn(),
}));

vi.mock("@/lib/google/calendar", () => ({
  listBusyIntervals: vi.fn(),
  createMeetingWithAvailabilityCheck: vi.fn(),
}));

vi.mock("@/lib/lead-runs/receipts", async () => {
  const actual = await vi.importActual<typeof import("@/lib/lead-runs/receipts")>(
    "@/lib/lead-runs/receipts"
  );
  return {
    ...actual,
    recordLeadActionReceipt: vi.fn(),
  };
});

const requireAuthMock = vi.mocked(requireFirebaseAuth);
const getAccessTokenMock = vi.mocked(getAccessTokenForUser);
const listBusyMock = vi.mocked(listBusyIntervals);
const recordReceiptMock = vi.mocked(recordLeadActionReceipt);

function createContext(params: Record<string, string>) {
  return { params: Promise.resolve(params) };
}

describe("calendar schedule route", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    requireAuthMock.mockResolvedValue({ uid: "user-1" } as unknown as { uid: string });
    getAccessTokenMock.mockResolvedValue("access-token");
    recordReceiptMock.mockResolvedValue(undefined);
  });

  it("records a skipped receipt when no slot is available", async () => {
    // Mark the entire window as busy so no candidate can be selected.
    listBusyMock.mockResolvedValue([
      {
        start: "2026-02-14T00:00:00.000Z",
        end: "2026-02-15T00:00:00.000Z",
      },
    ]);

    const req = new Request("http://localhost/api/calendar/schedule", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer test",
      },
      body: JSON.stringify({
        runId: "run-1",
        leadDocId: "lead-1",
        receiptActionId: "calendar.booking",
        durationMinutes: 30,
        candidateStarts: [
          "2026-02-14T16:00:00.000Z",
          "2026-02-14T16:30:00.000Z",
        ],
        event: {
          summary: "Discovery Call - Acme",
        },
      }),
    });

    const res = await POST(
      req as unknown as Parameters<typeof POST>[0],
      createContext({}) as unknown as Parameters<typeof POST>[1]
    );
    const data = await res.json();

    expect(res.status).toBe(409);
    expect(data.error).toContain("No available slot");
    expect(recordReceiptMock).toHaveBeenCalledTimes(1);
    expect(recordReceiptMock.mock.calls[0]?.[0]).toMatchObject({
      runId: "run-1",
      leadDocId: "lead-1",
      actionId: "calendar.booking",
      status: "skipped",
      dryRun: false,
      data: expect.objectContaining({ reason: "no_slot" }),
    });
  });
});

