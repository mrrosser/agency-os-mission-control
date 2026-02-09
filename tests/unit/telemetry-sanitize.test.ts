import { describe, it, expect } from "vitest";
import { redactSecrets, sanitizeTelemetryMeta, sanitizeTelemetryString } from "@/lib/telemetry/sanitize";

describe("telemetry sanitize", () => {
  it("redacts bearer tokens", () => {
    const input = "Authorization: Bearer abcdefghijklmnopqrstuvwxyz.1234567890";
    const out = redactSecrets(input);
    expect(out).toContain("Bearer [REDACTED]");
  });

  it("redacts google api keys", () => {
    const input = "key=AIzaSyDUMMYDUMMYDUMMYDUMMYDUMMYDUMMY";
    const out = redactSecrets(input);
    expect(out).toContain("AIza[REDACTED]");
  });

  it("clips and sanitizes strings", () => {
    const out = sanitizeTelemetryString("  hello  ", 3);
    expect(out).toBe("hel…");
  });

  it("redacts secret-like keys in meta", () => {
    const meta = sanitizeTelemetryMeta({
      ok: true,
      access_token: "abc",
      nested: { authorization: "Bearer xyz" },
    });
    expect(meta?.access_token).toBe("[REDACTED]");
    expect((meta?.nested as Record<string, unknown>)?.authorization).toBe("[REDACTED]");
  });
});
