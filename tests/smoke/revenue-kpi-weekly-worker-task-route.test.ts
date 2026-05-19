import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/revenue/kpi/weekly/worker-task/route";
import { runWeeklyKpiRollup } from "@/lib/revenue/weekly-kpi";

vi.mock("@/lib/revenue/weekly-kpi", () => ({
  runWeeklyKpiRollup: vi.fn(),
}));

const runWeeklyKpiRollupMock = vi.mocked(runWeeklyKpiRollup);

function createContext() {
  return { params: Promise.resolve({}) };
}

describe("revenue weekly kpi worker-task route", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
    process.env.REVENUE_WEEKLY_KPI_WORKER_TOKEN = "worker-token";
    runWeeklyKpiRollupMock.mockResolvedValue({
      uid: "user-1",
      timeZone: "America/Chicago",
      weekStartDate: "2026-02-23",
      weekEndDate: "2026-03-01",
      scannedLeadCount: 12,
      sampled: false,
      summary: {
        leadsSourced: 5,
        qualifiedLeads: 4,
        outreachReady: 4,
        meetingsBooked: 3,
        depositsCollected: 2,
        dealsWon: 1,
        closeRatePct: 20,
        avgCycleDaysToDeposit: 2,
        pipelineValueUsd: 3400,
      },
      segments: [],
      decisions: [],
      decisionSummary: {
        scale: 0,
        fix: 0,
        kill: 0,
        watch: 0,
      },
      outcomeGates: {
        gates: [
          { id: "throughput", label: "Lead Throughput", status: "warn", threshold: ">=10", actual: "5" },
          { id: "qualification", label: "Qualification", status: "pass", threshold: ">=20%", actual: "4/5 (80%)" },
          { id: "meeting", label: "Meeting Rate", status: "pass", threshold: ">=15%", actual: "3/5 (60%)" },
          { id: "revenue", label: "Revenue", status: "pass", threshold: ">=1 deposit", actual: "2 deposits, 3 meetings" },
          { id: "pipeline", label: "Pipeline Value", status: "warn", threshold: ">=5000", actual: "$3400" },
        ],
        summary: {
          passCount: 3,
          warnCount: 2,
          failCount: 0,
          passOrWarnCount: 5,
        },
        criticalGateFailures: [],
      },
      outcomeGateReadiness: {
        minimumPassOrWarnGates: 3,
        targetConsecutiveWeeks: 2,
        consecutiveReadyWeeks: 1,
        meetsTarget: false,
        evaluatedWeeks: 1,
        weeks: [{ weekStartDate: "2026-02-23", passOrWarnCount: 5, ready: true }],
      },
    });
  });

  it("rejects missing token", async () => {
    const req = new Request("http://localhost/api/revenue/kpi/weekly/worker-task", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uid: "user-1" }),
    });

    const res = await POST(
      req as Parameters<typeof POST>[0],
      createContext() as Parameters<typeof POST>[1]
    );
    const data = await res.json();

    expect(res.status).toBe(403);
    expect(data.error).toBe("Forbidden");
  });

  it("runs with worker token", async () => {
    const req = new Request("http://localhost/api/revenue/kpi/weekly/worker-task", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer worker-token",
      },
      body: JSON.stringify({
        uid: "user-1",
        timeZone: "America/Chicago",
      }),
    });

    const res = await POST(
      req as Parameters<typeof POST>[0],
      createContext() as Parameters<typeof POST>[1]
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.report?.outcomeGates?.gates).toHaveLength(5);
    expect(data.report?.outcomeGates?.summary?.passOrWarnCount).toBe(5);
    expect(Array.isArray(data.report?.outcomeGates?.criticalGateFailures)).toBe(true);
    expect(data.report?.outcomeGateReadiness?.minimumPassOrWarnGates).toBe(3);
    expect(runWeeklyKpiRollupMock).toHaveBeenCalledOnce();
    expect(runWeeklyKpiRollupMock.mock.calls[0]?.[0]).toMatchObject({
      uid: "user-1",
      timeZone: "America/Chicago",
    });
  });
});
