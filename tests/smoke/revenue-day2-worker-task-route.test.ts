import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/revenue/day2/worker-task/route";
import { runDay2RevenueAutomation } from "@/lib/revenue/day2-automation";

vi.mock("@/lib/revenue/day2-automation", () => ({
  runDay2RevenueAutomation: vi.fn(),
}));

const runDay2Mock = vi.mocked(runDay2RevenueAutomation);

function createContext() {
  return { params: Promise.resolve({}) };
}

describe("revenue day2 worker-task route", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
    process.env.REVENUE_DAY2_WORKER_TOKEN = "token-day2";

    runDay2Mock.mockResolvedValue({
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
        followupsSeeded: 7,
        responseProcessed: 3,
        responseCompleted: 3,
        responseSkipped: 0,
        responseFailed: 0,
      },
      warnings: [],
    });
  });

  it("rejects missing token", async () => {
    const req = new Request("http://localhost/api/revenue/day2/worker-task", {
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

  it("runs with day2 token", async () => {
    const req = new Request("http://localhost/api/revenue/day2/worker-task", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer token-day2",
      },
      body: JSON.stringify({
        uid: "user-1",
        templateIds: ["rng-south-day1"],
        processDueResponses: true,
      }),
    });

    const res = await POST(
      req as Parameters<typeof POST>[0],
      createContext() as Parameters<typeof POST>[1]
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(runDay2Mock).toHaveBeenCalledOnce();
  });

  it("falls back to REVENUE_DAY1_WORKER_TOKEN when day2 token is unset", async () => {
    delete process.env.REVENUE_DAY2_WORKER_TOKEN;
    process.env.REVENUE_DAY1_WORKER_TOKEN = "token-day1";

    const req = new Request("http://localhost/api/revenue/day2/worker-task", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer token-day1",
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
    expect(runDay2Mock).toHaveBeenCalledOnce();
  });
});
