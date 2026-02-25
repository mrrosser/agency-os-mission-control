import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/revenue/day1/route";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { runDay1RevenueAutomation } from "@/lib/revenue/day1-automation";

vi.mock("@/lib/api/auth", () => ({
  requireFirebaseAuth: vi.fn(),
}));

vi.mock("@/lib/revenue/day1-automation", () => ({
  runDay1RevenueAutomation: vi.fn(),
}));

const requireAuthMock = vi.mocked(requireFirebaseAuth);
const runDay1Mock = vi.mocked(runDay1RevenueAutomation);

function createContext() {
  return { params: Promise.resolve({}) };
}

describe("revenue day1 route", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    requireAuthMock.mockResolvedValue({ uid: "user-1" } as Awaited<ReturnType<typeof requireFirebaseAuth>>);
    runDay1Mock.mockResolvedValue({
      runId: "day1-2026-02-24-abcd",
      templateId: "rt-template",
      dateKey: "2026-02-24",
      reused: false,
      businessUnit: "rt_solutions",
      offerCode: "RTS-QUICK-WEBSITE-SPRINT",
      leadTotals: { candidateTotal: 10, scoredTotal: 6, filteredOut: 4 },
      sourcesUsed: ["googlePlaces"],
      warnings: [],
      job: {
        status: "queued",
        totalLeads: 6,
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
        skippedNoOutreach: 6,
        dueAtMs: null,
        autoEnabled: false,
        scheduledNextAtMs: null,
        dispatch: null,
        error: null,
      },
    });
  });

  it("runs day1 automation for authenticated user", async () => {
    const req = new Request("http://localhost/api/revenue/day1", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        templateId: "rt-template",
        dryRun: false,
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
    expect(data.runId).toBe("day1-2026-02-24-abcd");
    expect(runDay1Mock).toHaveBeenCalledOnce();
    const [args] = runDay1Mock.mock.calls[0] || [];
    expect(args?.uid).toBe("user-1");
    expect(args?.templateId).toBe("rt-template");
    expect(args?.autoQueueFollowups).toBe(true);
  });

  it("returns 400 for invalid payload", async () => {
    const req = new Request("http://localhost/api/revenue/day1", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ templateId: "" }),
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
