import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

function runAuditHelper(expression: string) {
  const script = `
    import { buildGcloudInvocation, createWritableGcloudEnv } from "./scripts/revenue-cadence-audit.mjs";
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
});
