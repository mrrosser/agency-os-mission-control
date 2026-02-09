import { describe, it, expect } from "vitest";
import { computeTelemetryFingerprint } from "@/lib/telemetry/fingerprint";

describe("telemetry fingerprint", () => {
  it("normalizes UUIDs and numbers for stable grouping", () => {
    const a = computeTelemetryFingerprint({
      kind: "client",
      name: "Error",
      message: "Failed for user 1234 id 550e8400-e29b-41d4-a716-446655440000",
      stack: "Error: boom\n  at fn (file.ts:10:20)",
      route: "/dashboard/inbox",
      url: "https://leadflow-review.web.app/dashboard/inbox",
    });
    const b = computeTelemetryFingerprint({
      kind: "client",
      name: "Error",
      message: "Failed for user 9999 id 11111111-2222-3333-4444-555555555555",
      stack: "Error: boom\n  at fn (file.ts:10:20)",
      route: "/dashboard/inbox",
      url: "https://leadflow-review.web.app/dashboard/inbox",
    });
    expect(a).toBe(b);
  });
});

