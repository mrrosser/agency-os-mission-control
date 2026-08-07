import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function runAuditHelper(expression: string) {
  const script = `
    import {
      EXPECTED_RETRY_CONFIG,
      JOB_SPECS,
      buildGcloudInvocation,
      createWritableGcloudEnv,
      validateRetryConfig
    } from "./scripts/revenue-cadence-audit.mjs";
    const result = ${expression};
    console.log(JSON.stringify(result));
  `;
  return JSON.parse(
    execFileSync(process.execPath, ["--input-type=module", "-e", script], {
      cwd: process.cwd(),
      env: { ...process.env },
      encoding: "utf8",
    })
  ) as Record<string, unknown>;
}

describe("revenue cadence audit gcloud runtime hardening", () => {
  it("builds a writable gcloud env surface", () => {
    const env = runAuditHelper("createWritableGcloudEnv(process.env)");

    expect(env.CLOUDSDK_CONFIG).toBeTruthy();
    expect(String(env.CLOUDSDK_LOG_DIR)).toContain("logs");
    if (process.env.CLOUDSDK_ACTIVE_CONFIG_NAME) {
      expect(env.CLOUDSDK_ACTIVE_CONFIG_NAME).toBe(process.env.CLOUDSDK_ACTIVE_CONFIG_NAME);
    }
  });

  it("wraps gcloud through cmd.exe on win32", () => {
    const invocation = runAuditHelper(
      `buildGcloudInvocation(["scheduler", "jobs", "list"], { platform: "win32", env: process.env })`
    ) as { command: string; args: string[]; env: Record<string, unknown> };

    expect(invocation.command).toBe("cmd.exe");
    expect(invocation.args.slice(0, 4)).toEqual(["/d", "/s", "/c", "gcloud"]);
    expect(invocation.env.CLOUDSDK_CONFIG).toBeTruthy();
  });

  it("preserves an explicitly selected named gcloud configuration", () => {
    const env = runAuditHelper(
      `createWritableGcloudEnv(
        { ...process.env, CLOUDSDK_ACTIVE_CONFIG_NAME: "mission-control-audit" },
        { preferFresh: true }
      )`
    );

    expect(env.CLOUDSDK_ACTIVE_CONFIG_NAME).toBe("mission-control-audit");
    expect(
      existsSync(
        join(
          String(env.CLOUDSDK_CONFIG),
          "configurations",
          "config_mission-control-audit"
        )
      )
    ).toBe(true);
  });

  it("rejects an unsafe named gcloud configuration before creating files", () => {
    const result = runAuditHelper(
      `(() => {
        try {
          createWritableGcloudEnv(
            { ...process.env, CLOUDSDK_ACTIVE_CONFIG_NAME: "x/../../../escaped" },
            { preferFresh: true }
          );
          return { error: null };
        } catch (error) {
          return { error: error instanceof Error ? error.message : String(error) };
        }
      })()`
    );

    expect(result.error).toBe("Invalid CLOUDSDK_ACTIVE_CONFIG_NAME");
  });

  it("audits the consolidated live revenue cadence instead of removed legacy jobs", () => {
    const specs = runAuditHelper(
      "JOB_SPECS.map(({ name, endpointPath, defaultSchedule }) => ({ name, endpointPath, defaultSchedule }))"
    ) as unknown as Array<{ name: string; endpointPath: string; defaultSchedule: string }>;

    expect(specs.map((spec) => spec.name)).toEqual([
      "revenue-automation-rts",
      "revenue-automation-rng",
      "revenue-automation-aicf",
      "revenue-weekly-brain",
    ]);
    expect(specs.every((spec) => Boolean(spec.endpointPath && spec.defaultSchedule))).toBe(true);
    expect(specs.some((spec) => spec.name.startsWith("revenue-day"))).toBe(false);
  });

  it("requires the bounded revenue retry policy", () => {
    const expectedRetryConfig = runAuditHelper("EXPECTED_RETRY_CONFIG");
    const mismatches = runAuditHelper(
      `validateRetryConfig({
      retryCount: 3,
      maxRetryDuration: "0.000s",
        minBackoffDuration: "60s",
        maxBackoffDuration: "300s",
        maxDoublings: 2
      })`
    ) as unknown as string[];

    expect(expectedRetryConfig).toEqual({
      retryCount: 3,
      maxRetryDuration: "0s",
      minBackoffDuration: "60s",
      maxBackoffDuration: "300s",
      maxDoublings: 2,
    });
    expect(mismatches).toEqual([]);
  });

  it("reports the current zero-retry scheduler defaults as mismatches", () => {
    const mismatches = runAuditHelper(
      `validateRetryConfig({
        maxRetryDuration: "0s",
        minBackoffDuration: "5s",
        maxBackoffDuration: "3600s",
        maxDoublings: 5
      })`
    ) as unknown as string[];

    expect(mismatches).toEqual([
      "retryConfig.retryCount expected=3 actual=<unset>",
      "retryConfig.maxDoublings expected=2 actual=5",
      "retryConfig.minBackoffDuration expected=60s actual=5s",
      "retryConfig.maxBackoffDuration expected=300s actual=3600s",
    ]);
  });

  it("applies retry flags only to consolidated revenue migration calls", () => {
    const setupScript = readFileSync(
      join(process.cwd(), "scripts", "revenue-automation-scheduler-setup.ps1"),
      "utf8"
    );
    const migrationScript = readFileSync(
      join(process.cwd(), "scripts", "scheduler-consolidation-migrate.ps1"),
      "utf8"
    );

    for (const [flag, value] of [
      ["--max-retry-attempts", "3"],
      ["--min-backoff", "60s"],
      ["--max-backoff", "300s"],
      ["--max-doublings", "2"],
    ]) {
      expect(setupScript).toContain(`"${flag}", "${value}"`);
      expect(migrationScript).toContain(`"${flag}", "${value}"`);
    }

    expect(setupScript).toContain('"--clear-max-retry-duration"');
    expect(migrationScript).toContain('$args.Add("--clear-max-retry-duration")');

    expect(migrationScript.match(/-UseRevenueRetryPolicy/g)).toHaveLength(2);
    expect(migrationScript).not.toMatch(/social-[^\r\n]+-UseRevenueRetryPolicy/);
    expect(migrationScript).not.toMatch(/google-oauth[^\r\n]+-UseRevenueRetryPolicy/);
  });
});
