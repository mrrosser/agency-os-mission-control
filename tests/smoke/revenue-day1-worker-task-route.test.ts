import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/revenue/day1/worker-task/route";
import { runDay1RevenueAutomation } from "@/lib/revenue/day1-automation";

vi.mock("@/lib/revenue/day1-automation", () => ({
  runDay1RevenueAutomation: vi.fn(),
}));

const runDay1Mock = vi.mocked(runDay1RevenueAutomation);

function createContext() {
  return { params: Promise.resolve({}) };
}

describe("revenue day1 worker-task route", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
    process.env.REVENUE_DAY1_WORKER_TOKEN = "token-1";

    runDay1Mock.mockResolvedValue({
      runId: "day1-2026-02-24-abcd",
      templateId: "rt-template",
      dateKey: "2026-02-24",
      reused: false,
      businessUnit: "rt_solutions",
      offerCode: "RTS-QUICK-WEBSITE-SPRINT",
      leadTotals: { candidateTotal: 12, scoredTotal: 8, filteredOut: 4 },
      sourcesUsed: ["googlePlaces"],
      warnings: [],
      job: {
        status: "queued",
        totalLeads: 8,
        dryRun: false,
        draftFirst: true,
        useAvatar: true,
        useSMS: false,
        useOutboundCall: false,
      },
      followups: {
        attempted: true,
        created: 0,
        existing: 0,
        skippedNoEmail: 0,
        skippedNoOutreach: 8,
        dueAtMs: null,
        autoEnabled: false,
        scheduledNextAtMs: null,
        dispatch: null,
        error: null,
      },
    });
  });

  it("rejects missing token", async () => {
    const req = new Request("http://localhost/api/revenue/day1/worker-task", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        uid: "user-1",
        templateId: "rt-template",
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

  it("runs with valid token", async () => {
    const req = new Request("http://localhost/api/revenue/day1/worker-task", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer token-1",
      },
      body: JSON.stringify({
        uid: "user-1",
        templateId: "rt-template",
        autoQueueFollowups: true,
      }),
    });

    const res = await POST(
      req as Parameters<typeof POST>[0],
      createContext() as Parameters<typeof POST>[1]
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(runDay1Mock).toHaveBeenCalledOnce();
    const [args] = runDay1Mock.mock.calls[0] || [];
    expect(args?.uid).toBe("user-1");
    expect(args?.templateId).toBe("rt-template");
    expect(args?.autoQueueFollowups).toBe(true);
  });
});
