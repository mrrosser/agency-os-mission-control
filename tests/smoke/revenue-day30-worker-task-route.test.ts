import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/revenue/day30/worker-task/route";
import { runDay30RevenueAutomation } from "@/lib/revenue/day30-automation";

vi.mock("@/lib/revenue/day30-automation", () => ({
  runDay30RevenueAutomation: vi.fn(),
}));

const runDay30Mock = vi.mocked(runDay30RevenueAutomation);

function createContext() {
  return { params: Promise.resolve({}) };
}

describe("revenue day30 worker-task route", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
    process.env.REVENUE_DAY30_WORKER_TOKEN = "token-day30";

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
          leadsScored: 7,
          followupsSeeded: 6,
          responseProcessed: 3,
          responseCompleted: 3,
          responseSkipped: 0,
          responseFailed: 0,
        },
        warnings: [],
      },
      weeklyKpi: null,
      revenueMemory: null,
      closerQueue: {
        scannedLeads: 100,
        queueSize: 3,
        breachedCount: 1,
        highPriorityCount: 1,
        generatedAt: "2026-02-25T12:00:00.000Z",
      },
      serviceLab: null,
      dailyDigest: {
        dateKey: "2026-02-25",
        timeZone: "America/Chicago",
        summary: {
          templatesSucceeded: 1,
          leadsScored: 7,
          followupsSeeded: 6,
          responseCompleted: 3,
          responseFailed: 0,
          closeRatePct: 0,
          dealsWon: 0,
          pendingApprovals: 0,
          closerQueueOpen: 3,
          closerQueueBreached: 1,
        },
        blockers: [],
        topPriorities: [],
      },
      warnings: [],
    });
  });

  it("rejects missing token", async () => {
    const req = new Request("http://localhost/api/revenue/day30/worker-task", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        uid: "user-1",
        templateIds: ["rng-south-day1"],
      }),
    });

    const res = await POST(
      req as Parameters<typeof POST>[0],
      createContext() as Parameters<typeof POST>[1]
    );
    const data = await res.json();

    expect(res.status).toBe(403);
    expect(data.error).toBe("Forbidden");
  });

  it("runs with day30 token", async () => {
    const req = new Request("http://localhost/api/revenue/day30/worker-task", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer token-day30",
      },
      body: JSON.stringify({
        uid: "user-1",
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
  });

  it("falls back to REVENUE_DAY2_WORKER_TOKEN when day30 token is unset", async () => {
    delete process.env.REVENUE_DAY30_WORKER_TOKEN;
    process.env.REVENUE_DAY2_WORKER_TOKEN = "token-day2";

    const req = new Request("http://localhost/api/revenue/day30/worker-task", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer token-day2",
      },
      body: JSON.stringify({
        uid: "user-1",
        templateIds: ["rng-south-day1"],
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
  });
});
