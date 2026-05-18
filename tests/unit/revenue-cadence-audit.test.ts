import { describe, expect, it } from "vitest";

import {
  buildGcloudInvocation,
  createWritableGcloudEnv,
} from "../../scripts/revenue-cadence-audit.mjs";

describe("revenue cadence audit gcloud runtime hardening", () => {
  it("builds a writable gcloud env surface", () => {
    const env = createWritableGcloudEnv({ ...process.env });

    expect(env.CLOUDSDK_CONFIG).toBeTruthy();
    expect(env.CLOUDSDK_LOG_DIR).toContain("logs");
    expect(env.CLOUDSDK_ACTIVE_CONFIG_NAME).toBe("default");
  });

  it("wraps gcloud through cmd.exe on win32", () => {
    const invocation = buildGcloudInvocation(["scheduler", "jobs", "list"], {
      platform: "win32",
      env: { ...process.env },
    });

    expect(invocation.command).toBe("cmd.exe");
    expect(invocation.args.slice(0, 4)).toEqual(["/d", "/s", "/c", "gcloud"]);
    expect(invocation.env.CLOUDSDK_CONFIG).toBeTruthy();
  });
});
