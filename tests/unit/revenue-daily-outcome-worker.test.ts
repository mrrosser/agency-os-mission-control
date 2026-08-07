import { beforeEach, describe, expect, it, vi } from "vitest";

const { membershipGetMock, getDailyOutcomeDashboardMock } = vi.hoisted(() => ({
  membershipGetMock: vi.fn(),
  getDailyOutcomeDashboardMock: vi.fn(),
}));

vi.mock("@/lib/firebase-admin", () => ({
  getAdminDb: () => ({
    collection: vi.fn(() => ({
      doc: vi.fn((documentId: string) => ({
        get: () => membershipGetMock(documentId),
      })),
    })),
  }),
}));

vi.mock("@/lib/revenue/daily-outcome", () => ({
  DAILY_OUTCOME_TIME_ZONE: "America/Chicago",
  DAILY_OUTCOME_ORGANIZATIONS: [
    {
      businessUnit: "rosser_nft_gallery",
      organizationName: "Rosser Gallery",
      workspaceId: "ws_rosser",
      businessIdentityId: "rosser_artist_gallery",
    },
    {
      businessUnit: "rt_solutions",
      organizationName: "RT Solutions",
      workspaceId: "ws_rt",
      businessIdentityId: "rt_business_ai",
    },
  ],
  getDailyOutcomeDashboard: getDailyOutcomeDashboardMock,
}));

import type { Logger } from "@/lib/logging";
import { evaluateDailyOutcomesForRevenueWorker } from "@/lib/revenue/daily-outcome-worker";

function makeLogger(): Logger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function dashboardFor(...businessUnits: Array<"rosser_nft_gallery" | "rt_solutions">) {
  return {
    asOf: "2026-08-07T11:00:00.000Z",
    timeZone: "America/Chicago",
    outcomes: businessUnits.map((businessUnit) => ({
      outcomeId: `outcome-${businessUnit}`,
      businessUnit,
      organizationName: businessUnit === "rt_solutions" ? "RT Solutions" : "Rosser Gallery",
      localDate: "2026-08-07",
      timeZone: "America/Chicago",
      evaluatedAt: "2026-08-07T11:00:00.000Z",
      status: "at_risk" as const,
      targetSatisfied: false,
      qualifyingEvidence: [],
      counts: {
        verifiedMeetings: 0,
        applicationReady: 0,
        rejectedCandidates: 1,
        observedRecords: 1,
      },
      sourceHealth: { status: "current" as const, unavailableSourceCodes: [] },
      alert: { active: true, severity: "warning" as const, reason: "No receipt yet." },
      rejectionReasonCodes: ["no_qualifying_evidence"],
    })),
  };
}

describe("revenue daily outcome worker", () => {
  beforeEach(() => {
    membershipGetMock.mockReset();
    getDailyOutcomeDashboardMock.mockReset();
    membershipGetMock.mockResolvedValue({
      exists: true,
      data: () => ({ status: "active" }),
    });
    getDailyOutcomeDashboardMock.mockResolvedValue(
      dashboardFor("rosser_nft_gallery", "rt_solutions")
    );
  });

  it("requires active membership and persists both canonical organization outcomes", async () => {
    const result = await evaluateDailyOutcomesForRevenueWorker({
      uid: "worker-uid",
      correlationId: "corr-outcomes",
      log: makeLogger(),
      asOf: new Date("2026-08-07T11:00:00.000Z"),
    });

    expect(result.outcomes).toHaveLength(2);
    expect(membershipGetMock).toHaveBeenCalledTimes(2);
    expect(membershipGetMock).toHaveBeenCalledWith("ws_rosser__worker-uid");
    expect(membershipGetMock).toHaveBeenCalledWith("ws_rt__worker-uid");
    expect(getDailyOutcomeDashboardMock).toHaveBeenCalledWith(
      expect.objectContaining({
        uid: "worker-uid",
        timeZone: "America/Chicago",
        correlationId: "corr-outcomes",
        failOnUnavailableSources: true,
      })
    );
  });

  it("fails before evaluation when either canonical membership is not active", async () => {
    membershipGetMock.mockImplementation(async (documentId: string) => ({
      exists: true,
      data: () => ({ status: documentId.startsWith("ws_rt") ? "invited" : "active" }),
    }));

    await expect(
      evaluateDailyOutcomesForRevenueWorker({
        uid: "worker-uid",
        correlationId: "corr-membership",
        log: makeLogger(),
      })
    ).rejects.toMatchObject({
      status: 503,
      details: { missingBusinessUnits: ["rt_solutions"] },
    });
    expect(getDailyOutcomeDashboardMock).not.toHaveBeenCalled();
  });

  it("fails closed when the evaluator omits one canonical organization", async () => {
    getDailyOutcomeDashboardMock.mockResolvedValue(dashboardFor("rosser_nft_gallery"));

    await expect(
      evaluateDailyOutcomesForRevenueWorker({
        uid: "worker-uid",
        correlationId: "corr-incomplete",
        log: makeLogger(),
      })
    ).rejects.toMatchObject({
      status: 503,
      details: { missingBusinessUnits: ["rt_solutions"] },
    });
  });
});
