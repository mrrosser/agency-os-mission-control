import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/revenue/kpi/weekly/route";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { runWeeklyKpiRollup } from "@/lib/revenue/weekly-kpi";

vi.mock("@/lib/api/auth", () => ({
  requireFirebaseAuth: vi.fn(),
}));

vi.mock("@/lib/revenue/weekly-kpi", () => ({
  runWeeklyKpiRollup: vi.fn(),
}));

const requireAuthMock = vi.mocked(requireFirebaseAuth);
const runWeeklyKpiRollupMock = vi.mocked(runWeeklyKpiRollup);

function createContext() {
  return { params: Promise.resolve({}) };
}

describe("revenue weekly kpi route", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    requireAuthMock.mockResolvedValue({ uid: "user-1" } as Awaited<ReturnType<typeof requireFirebaseAuth>>);
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
    });
  });

  it("runs weekly KPI rollup for authenticated user", async () => {
    const req = new Request("http://localhost/api/revenue/kpi/weekly", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
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
    expect(runWeeklyKpiRollupMock).toHaveBeenCalledOnce();
    expect(runWeeklyKpiRollupMock.mock.calls[0]?.[0]).toMatchObject({
      uid: "user-1",
      timeZone: "America/Chicago",
    });
  });
});
