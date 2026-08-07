import { describe, it, expect } from "vitest";
import {
  buildFirstScanTourStatePatch,
  buildFirstScanTourSteps,
  firstIncompleteStepIndex,
} from "@/lib/onboarding/first-scan";

describe("first scan tour helpers", () => {
  it("marks steps done based on signals", () => {
    const steps = buildFirstScanTourSteps({
      hasIdentity: true,
      googleConnected: true,
      googleCapabilities: { drive: true, calendar: true, gmail: false },
      secretStatus: { googlePlacesKey: "secret", firecrawlKey: "missing" },
    });

    expect(steps.find((s) => s.key === "identity")?.done).toBe(true);
    expect(steps.find((s) => s.key === "api_keys")?.done).toBe(true);
    expect(steps.find((s) => s.key === "google")?.done).toBe(true);
    expect(steps.find((s) => s.key === "run_scan")?.done).toBe(false);
  });

  it("picks the first incomplete pre-scan step", () => {
    const steps = buildFirstScanTourSteps({
      hasIdentity: false,
      googleConnected: false,
      googleCapabilities: { drive: false, calendar: false, gmail: false },
      secretStatus: { googlePlacesKey: "missing", firecrawlKey: "missing" },
    });

    expect(firstIncompleteStepIndex(steps)).toBe(0);
  });

  it("persists dismissal in the nested shape read by tour boot", () => {
    const timestamp = { serverTimestamp: true };

    expect(buildFirstScanTourStatePatch("user-1", "dismissed", timestamp)).toEqual({
      uid: "user-1",
      onboarding: {
        firstScanTourV1: {
          version: 1,
          dismissedAt: timestamp,
        },
      },
    });
  });
});

