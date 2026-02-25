import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/revenue/day30/route";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { runDay30RevenueAutomation } from "@/lib/revenue/day30-automation";

vi.mock("@/lib/api/auth", () => ({
  requireFirebaseAuth: vi.fn(),
}));

vi.mock("@/lib/revenue/day30-automation", () => ({
  runDay30RevenueAutomation: vi.fn(),
}));

const requireAuthMock = vi.mocked(requireFirebaseAuth);
const runDay30Mock = vi.mocked(runDay30RevenueAutomation);

function createContext() {
  return { params: Promise.resolve({}) };
}

describe("revenue day30 route", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    requireAuthMock.mockResolvedValue({ uid: "user-1" } as Awaited<ReturnType<typeof requireFirebaseAuth>>);
    runDay30Mock.mockResolvedValue({
      uid: "user-1",
      dateKey: "2026-02-25",
      timeZone: "America/Chicago",
      cadence: {
        runWeeklyKpi: false,
        runServiceLab: false,
        runCloserQueue: true,
        runRevenueMemory: true,
      },
      day2: {
        uid: "user-1",
        dateKey: "2026-02-25",
        dryRun: false,
        processDueResponses: true,
        requireApprovalGates: true,
        templates: [],
        totals: {
          templatesAttempted: 1,
          templatesSucceeded: 1,
          leadsScored: 5,
          followupsSeeded: 4,
          responseProcessed: 2,
          responseCompleted: 2,
          responseSkipped: 0,
          responseFailed: 0,
        },
        warnings: [],
      },
      weeklyKpi: null,
      revenueMemory: null,
      closerQueue: null,
      serviceLab: null,
      dailyDigest: {
        dateKey: "2026-02-25",
        timeZone: "America/Chicago",
        summary: {
          templatesSucceeded: 1,
          leadsScored: 5,
          followupsSeeded: 4,
          responseCompleted: 2,
          responseFailed: 0,
          closeRatePct: 0,
          dealsWon: 0,
          pendingApprovals: 0,
          closerQueueOpen: 0,
          closerQueueBreached: 0,
        },
        blockers: [],
        topPriorities: [],
      },
      warnings: [],
    });
  });

  it("runs day30 automation for authenticated user", async () => {
    const req = new Request("http://localhost/api/revenue/day30", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        templateIds: ["rng-south-day1"],
        runCloserQueue: true,
      }),
    });

    const res = await POST(
      req as Parameters<typeof POST>[0],
      createContext() as Parameters<typeof POST>[1]
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(runDay30Mock).toHaveBeenCalledOnce();
    const [args] = runDay30Mock.mock.calls[0] || [];
    expect(args?.uid).toBe("user-1");
    expect(args?.templateIds).toEqual(["rng-south-day1"]);
  });

  it("returns 400 for invalid payload", async () => {
    const req = new Request("http://localhost/api/revenue/day30", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        templateIds: [],
      }),
    });

    const res = await POST(
      req as Parameters<typeof POST>[0],
      createContext() as Parameters<typeof POST>[1]
    );
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(String(data.error || "")).toContain("Invalid request body");
  });
});
