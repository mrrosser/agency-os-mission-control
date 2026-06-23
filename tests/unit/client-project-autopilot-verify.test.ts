import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

const scriptPath = resolve(__dirname, "../../scripts/client-project-autopilot-verify.ps1");

describe("client-project-autopilot-verify route probe", () => {
  test("retries transient route probe failures with structured attempt evidence", () => {
    const script = readFileSync(scriptPath, "utf8");

    expect(script).toContain("[int]$MaxAttempts = 3");
    expect(script).toContain("for ($attempt = 1; $attempt -le $MaxAttempts; $attempt++)");
    expect(script).toContain("max_attempts = $MaxAttempts");
    expect(script).toContain("Start-Sleep -Seconds ([Math]::Min($attempt, 3))");
    expect(script).toContain("$attemptEvent.error_type = $lastError");
  });
});
