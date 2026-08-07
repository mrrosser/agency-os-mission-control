import { beforeEach, describe, expect, it, vi } from "vitest";

const { getAdminDbMock, getPosWorkerStatusMock, runDay2RevenueAutomationMock } = vi.hoisted(() => ({
  getAdminDbMock: vi.fn(),
  getPosWorkerStatusMock: vi.fn(),
  runDay2RevenueAutomationMock: vi.fn(),
}));

vi.mock("@/lib/firebase-admin", () => ({
  getAdminDb: getAdminDbMock,
}));

vi.mock("@/lib/revenue/pos-worker", () => ({
  getPosWorkerStatus: getPosWorkerStatusMock,
}));

vi.mock("@/lib/revenue/day2-automation", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/revenue/day2-automation")>();
  return {
    ...original,
    runDay2RevenueAutomation: runDay2RevenueAutomationMock,
  };
});

import type { Logger } from "@/lib/logging";
import { runDay30RevenueAutomation } from "@/lib/revenue/day30-automation";

describe("Day30 response-loop failure boundary", () => {
  const digestSetMock = vi.fn();
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as Logger;

  beforeEach(() => {
    vi.clearAllMocks();
    digestSetMock.mockResolvedValue(undefined);
    getPosWorkerStatusMock.mockResolvedValue(null);
    runDay2RevenueAutomationMock.mockResolvedValue({
      uid: "uid-1",
      dateKey: "2026-08-06",
      dryRun: false,
      processDueResponses: true,
      requireApprovalGates: true,
      templates: [
        {
          templateId: "rts-south-day1",
          ok: true,
          day1: null,
          responseLoop: {
            attempted: true,
            autoEnabled: true,
            maxTasks: 10,
            processed: 1,
            completed: 0,
            skipped: 0,
            failed: 1,
            scheduledNextAtMs: null,
            dispatch: null,
            error: null,
          },
          error: null,
        },
      ],
      totals: {
        templatesAttempted: 1,
        templatesSucceeded: 1,
        leadsScored: 2,
        followupsSeeded: 1,
        responseProcessed: 1,
        responseCompleted: 0,
        responseSkipped: 0,
        responseFailed: 1,
      },
      warnings: [],
    });

    const makeCollection = (path: string): Record<string, unknown> => ({
      doc: vi.fn((id: string) => makeDoc(`${path}/${id}`)),
      where: vi.fn(() => ({
        limit: vi.fn(() => ({
          get: vi.fn(async () => ({ docs: [] })),
        })),
      })),
    });
    const makeDoc = (path: string): Record<string, unknown> => ({
      collection: vi.fn((name: string) => makeCollection(`${path}/${name}`)),
      get: vi.fn(async () => ({ exists: false, data: () => null })),
      set: path.includes("executive_brain/daily/entries")
        ? digestSetMock
        : vi.fn(async () => undefined),
    });

    getAdminDbMock.mockReturnValue({
      collection: vi.fn((name: string) => makeCollection(name)),
    });
  });

  it("persists independent Day30 work before surfacing an incomplete response loop", async () => {
    await expect(
      runDay30RevenueAutomation({
        uid: "uid-1",
        templateIds: ["rts-south-day1"],
        origin: "https://example.test",
        correlationId: "cid-1",
        log: logger,
        dateKey: "2026-08-06",
        runWeeklyKpi: false,
        runServiceLab: false,
        runCloserQueue: false,
        runRevenueMemory: false,
      })
    ).rejects.toEqual(
      expect.objectContaining({
        status: 502,
        message: "Day2 response loop incomplete for template(s): rts-south-day1",
      })
    );

    expect(runDay2RevenueAutomationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        deferResponseLoopFailureUntilParentCompletes: true,
      })
    );
    expect(digestSetMock).toHaveBeenCalledTimes(2);
    expect(logger.info).toHaveBeenCalledWith(
      "revenue.day30.independent_work_completed",
      expect.objectContaining({ uid: "uid-1" })
    );
    expect(logger.info).not.toHaveBeenCalledWith(
      "revenue.day30.completed",
      expect.anything()
    );
  });
});
