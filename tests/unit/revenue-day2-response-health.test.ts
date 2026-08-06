import { describe, expect, it } from "vitest";
import {
  assertDay2ResponseLoopsComplete,
  isDay2ResponseLoopIncomplete,
  type Day2RevenueAutomationResult,
  type Day2ResponseLoopResult,
} from "@/lib/revenue/day2-automation";

function responseLoop(
  error: string | null,
  overrides: Partial<Day2ResponseLoopResult> = {}
): Day2ResponseLoopResult {
  return {
    attempted: true,
    autoEnabled: true,
    maxTasks: 10,
    processed: 0,
    completed: 0,
    skipped: 0,
    failed: 0,
    scheduledNextAtMs: null,
    dispatch: null,
    error,
    ...overrides,
  };
}

function resultWithLoop(
  error: string | null,
  overrides: Partial<Day2ResponseLoopResult> = {}
): Day2RevenueAutomationResult {
  return {
    uid: "uid-1",
    dateKey: "2026-08-06",
    dryRun: false,
    processDueResponses: true,
    requireApprovalGates: true,
    templates: [
      {
        templateId: "rt-solutions-daily",
        ok: true,
        day1: null,
        responseLoop: responseLoop(error, overrides),
        error: null,
      },
    ],
    totals: {
      templatesAttempted: 1,
      templatesSucceeded: 1,
      leadsScored: 0,
      followupsSeeded: 0,
      responseProcessed: 0,
      responseCompleted: 0,
      responseSkipped: 0,
      responseFailed: 0,
    },
    warnings: [],
  };
}

describe("Day2 response-loop health", () => {
  it("accepts a completed response loop", () => {
    expect(() => assertDay2ResponseLoopsComplete(resultWithLoop(null))).not.toThrow();
  });

  it("fails visibly when a caught response-loop error would otherwise look green", () => {
    expect(() =>
      assertDay2ResponseLoopsComplete(resultWithLoop("Google account needs reauthentication"))
    ).toThrowError(
      expect.objectContaining({
        status: 502,
        message: "Day2 response loop incomplete for template(s): rt-solutions-daily",
      })
    );
  });

  it("fails visibly when one or more Gmail draft tasks failed", () => {
    expect(() => assertDay2ResponseLoopsComplete(resultWithLoop(null, { failed: 1 }))).toThrowError(
      expect.objectContaining({ status: 502 })
    );
  });

  it("fails visibly when the next drain could not be dispatched", () => {
    expect(() =>
      assertDay2ResponseLoopsComplete(
        resultWithLoop(null, {
          scheduledNextAtMs: Date.parse("2026-08-06T12:00:00.000Z"),
          dispatch: "skipped",
        })
      )
    ).toThrowError(expect.objectContaining({ status: 502 }));
  });

  it("does not treat policy skips such as DNC or missing email as infrastructure failure", () => {
    const loop = responseLoop(null, { processed: 2, skipped: 2 });
    expect(isDay2ResponseLoopIncomplete(loop)).toBe(false);
    expect(() => assertDay2ResponseLoopsComplete(resultWithLoop(null, loop))).not.toThrow();
  });
});
