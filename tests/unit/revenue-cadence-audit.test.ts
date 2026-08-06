import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

function runAuditHelper(expression: string) {
  const script = `
    import { JOB_SPECS, buildGcloudInvocation, createWritableGcloudEnv } from "./scripts/revenue-cadence-audit.mjs";
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
    expect(env.CLOUDSDK_ACTIVE_CONFIG_NAME).toBe("default");
  });

  it("wraps gcloud through cmd.exe on win32", () => {
    const invocation = runAuditHelper(
      `buildGcloudInvocation(["scheduler", "jobs", "list"], { platform: "win32", env: process.env })`
    ) as { command: string; args: string[]; env: Record<string, unknown> };

    expect(invocation.command).toBe("cmd.exe");
    expect(invocation.args.slice(0, 4)).toEqual(["/d", "/s", "/c", "gcloud"]);
    expect(invocation.env.CLOUDSDK_CONFIG).toBeTruthy();
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
});
