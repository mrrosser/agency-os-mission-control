import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/revenue/day1/worker-task/route";
import { runDay1RevenueAutomation } from "@/lib/revenue/day1-automation";
import { ApiError } from "@/lib/api/handler";
import {
  authorizeRevenueAutomationWorker,
  resolveRevenueAutomationWorkerUid,
} from "@/lib/revenue/worker-auth";

vi.mock("@/lib/revenue/day1-automation", () => ({
  runDay1RevenueAutomation: vi.fn(),
}));
vi.mock("@/lib/revenue/worker-auth", () => ({
  authorizeRevenueAutomationWorker: vi.fn(),
  resolveRevenueAutomationWorkerUid: vi.fn(),
}));

const runDay1Mock = vi.mocked(runDay1RevenueAutomation);
const authorizeMock = vi.mocked(authorizeRevenueAutomationWorker);
const resolveUidMock = vi.mocked(resolveRevenueAutomationWorkerUid);

function createContext() {
  return { params: Promise.resolve({}) };
}

describe("revenue day1 worker-task route", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
    authorizeMock.mockResolvedValue({ mode: "oidc", principalHash: "principal" });
    resolveUidMock.mockReturnValue("configured-worker-uid");

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
        requireBookingConfirmation: true,
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

  it("rejects failed shared worker authentication", async () => {
    authorizeMock.mockRejectedValue(new ApiError(403, "Forbidden"));
    const req = new Request("http://localhost/api/revenue/day1/worker-task", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
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

  it("runs with signed worker auth and the server-configured uid", async () => {
    const req = new Request("http://localhost/api/revenue/day1/worker-task", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer signed-oidc-token",
      },
      body: JSON.stringify({
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
    expect(data.authMode).toBe("oidc");
    expect(runDay1Mock).toHaveBeenCalledOnce();
    const [args] = runDay1Mock.mock.calls[0] || [];
    expect(args?.uid).toBe("configured-worker-uid");
    expect(args?.templateId).toBe("rt-template");
    expect(args?.autoQueueFollowups).toBe(true);
    expect(resolveUidMock).toHaveBeenCalledWith(undefined);
  });
});
