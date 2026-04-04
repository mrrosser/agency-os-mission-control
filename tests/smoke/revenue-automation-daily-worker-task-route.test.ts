import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/revenue/automation/daily/worker-task/route";
import { runDay1RevenueAutomation } from "@/lib/revenue/day1-automation";
import { runDay2RevenueAutomation } from "@/lib/revenue/day2-automation";
import { runDay30RevenueAutomation } from "@/lib/revenue/day30-automation";

vi.mock("@/lib/revenue/day1-automation", () => ({
  runDay1RevenueAutomation: vi.fn(),
}));

vi.mock("@/lib/revenue/day2-automation", () => ({
  runDay2RevenueAutomation: vi.fn(),
}));

vi.mock("@/lib/revenue/day30-automation", () => ({
  runDay30RevenueAutomation: vi.fn(),
}));

const runDay1Mock = vi.mocked(runDay1RevenueAutomation);
const runDay2Mock = vi.mocked(runDay2RevenueAutomation);
const runDay30Mock = vi.mocked(runDay30RevenueAutomation);

function createContext() {
  return { params: Promise.resolve({}) };
}

describe("revenue automation daily worker-task route", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
    process.env.REVENUE_DAY30_WORKER_TOKEN = "token-day30";
    process.env.REVENUE_AUTOMATION_UID = "uid-revenue";

    runDay1Mock.mockResolvedValue({
      runId: "day1-run",
      templateId: "rng-south-day1",
      dateKey: "2026-03-09",
      reused: false,
      businessUnit: "rosser_nft_gallery",
      offerCode: "starter",
      leadTotals: {
        candidateTotal: 7,
        scoredTotal: 5,
        filteredOut: 2,
      },
      sourcesUsed: ["firecrawl"],
      warnings: [],
      job: {
        status: "queued",
        totalLeads: 5,
        dryRun: false,
        draftFirst: true,
        requireBookingConfirmation: true,
        useAvatar: false,
        useSMS: false,
        useOutboundCall: false,
      },
      followups: {
        attempted: false,
        created: 0,
        existing: 0,
        skippedNoEmail: 0,
        skippedNoOutreach: 0,
        dueAtMs: null,
        autoEnabled: false,
        scheduledNextAtMs: null,
        dispatch: null,
        error: null,
      },
    });

    runDay2Mock.mockResolvedValue({
      uid: "uid-revenue",
      dateKey: "2026-03-09",
      dryRun: false,
      processDueResponses: true,
      requireApprovalGates: true,
      templates: [],
      totals: {
        templatesAttempted: 1,
        templatesSucceeded: 1,
        leadsScored: 5,
        followupsSeeded: 5,
        responseProcessed: 2,
        responseCompleted: 2,
        responseSkipped: 0,
        responseFailed: 0,
      },
      warnings: [],
    });

    runDay30Mock.mockResolvedValue({
      uid: "uid-revenue",
      dateKey: "2026-03-09",
      timeZone: "America/Chicago",
      cadence: {
        runWeeklyKpi: false,
        runServiceLab: false,
        runCloserQueue: true,
        runRevenueMemory: true,
      },
      day2: {
        uid: "uid-revenue",
        dateKey: "2026-03-09",
        dryRun: false,
        processDueResponses: true,
        requireApprovalGates: true,
        templates: [],
        totals: {
          templatesAttempted: 1,
          templatesSucceeded: 1,
          leadsScored: 5,
          followupsSeeded: 5,
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
        dateKey: "2026-03-09",
        timeZone: "America/Chicago",
        summary: {
          templatesSucceeded: 1,
          leadsScored: 5,
          followupsSeeded: 5,
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

  it("rejects requests without worker token", async () => {
    const req = new Request("http://localhost/api/revenue/automation/daily/worker-task", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ businessKey: "rng" }),
    });

    const res = await POST(
      req as Parameters<typeof POST>[0],
      createContext() as Parameters<typeof POST>[1]
    );
    const data = await res.json();

    expect(res.status).toBe(403);
    expect(data.error).toBe("Forbidden");
  });

  it("defaults to day30 orchestration for daily runs", async () => {
    const req = new Request("http://localhost/api/revenue/automation/daily/worker-task", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer token-day30",
      },
      body: JSON.stringify({ businessKey: "rng", dueOnly: true }),
    });

    const res = await POST(
      req as Parameters<typeof POST>[0],
      createContext() as Parameters<typeof POST>[1]
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.effectiveStage).toBe("day30");
    expect(data.metadata.job_name).toBe("revenue-automation-rng");
    expect(runDay30Mock).toHaveBeenCalledOnce();
    expect(runDay2Mock).not.toHaveBeenCalled();
    expect(runDay1Mock).not.toHaveBeenCalled();
  });

  it("runs the explicitly requested lower stage", async () => {
    const req = new Request("http://localhost/api/revenue/automation/daily/worker-task", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer token-day30",
      },
      body: JSON.stringify({ businessKey: "rts", runStages: ["day1"], dryRun: true }),
    });

    const res = await POST(
      req as Parameters<typeof POST>[0],
      createContext() as Parameters<typeof POST>[1]
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.effectiveStage).toBe("day1");
    expect(data.metadata.mode).toBe("dry_run");
    expect(runDay1Mock).toHaveBeenCalledOnce();
    expect(runDay30Mock).not.toHaveBeenCalled();
    expect(runDay2Mock).not.toHaveBeenCalled();
  });
});
