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

  test("Playwright outcome parser treats failed summaries as failed", () => {
    const script = readFileSync(scriptPath, "utf8");

    expect(script).toContain("$hasFailed = $normalizedLogText -match '(?m)^\\s*\\d+\\s+(?:failed|did not pass)(?:\\s*\\(|$)'");
    expect(script).toContain('if ($hasFailed) {');
    expect(script).toContain('$status = "failed"');
    expect(script).toContain('} elseif ($hasPassed -or $hasFlaky) {');
  });

  test("falls back to portal Secret Manager bootstrap when storage-state secret is unavailable", () => {
    const script = readFileSync(scriptPath, "utf8");

    expect(script).toContain("Invoke-SocialOpsPortalStorageBootstrap");
    expect(script).toContain('"socialops-portal-password"');
    expect(script).toContain('"socialops-portal-admin-password"');
    expect(script).toContain('"clerk-secret-key"');
    expect(script).toContain("$env:SOCIALOPS_PORTAL_PASSWORD = $null");
    expect(script).toContain("$env:SOCIALOPS_SIGNIN_URL = $null");
    expect(script).toContain("Storage state refreshed via Secret Manager");
  });
});
