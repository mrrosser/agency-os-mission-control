import { mkdtempSync, readFileSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { describe, expect, test } from "vitest";

const bootstrapModulePath = "../../scripts/bootstrap_socialops_storage_state.cjs";

type StorageStateCheck = {
  exists: boolean;
  ageHours: number | null;
};

type BootstrapStorageStateModule = {
  storageStateIsFresh: (check: StorageStateCheck, maxAgeHours: number) => boolean;
};

async function loadBootstrapModule() {
  return (await import(bootstrapModulePath)) as BootstrapStorageStateModule;
}

describe("bootstrap_socialops_storage_state helpers", () => {
  test("storageStateIsFresh returns false when missing", async () => {
    const mod = await loadBootstrapModule();
    expect(mod.storageStateIsFresh({ exists: false, ageHours: null }, 24)).toBe(false);
  });

  test("storageStateIsFresh returns true when age under max", async () => {
    const mod = await loadBootstrapModule();
    expect(mod.storageStateIsFresh({ exists: true, ageHours: 1 }, 24)).toBe(true);
  });

  test("storageStateIsFresh returns false when age over max", async () => {
    const mod = await loadBootstrapModule();
    expect(mod.storageStateIsFresh({ exists: true, ageHours: 25 }, 24)).toBe(false);
  });

  test("stale existing state without Secret Manager source exits non-zero", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "socialops-storage-state-"));
    const storageStatePath = join(tempDir, "socialops-client.json");
    const checkPath = join(tempDir, "storage-state-check.json");
    const logPath = join(tempDir, "auth-bootstrap.log");
    writeFileSync(storageStatePath, JSON.stringify({ cookies: [], origins: [] }), "utf8");

    const stale = new Date(Date.now() - 48 * 60 * 60 * 1000);
    utimesSync(storageStatePath, stale, stale);

    let status = 0;
    try {
      execFileSync(process.execPath, [resolve(__dirname, "../../scripts/bootstrap_socialops_storage_state.cjs")], {
        env: {
          ...process.env,
          SOCIALOPS_STORAGE_STATE_PATH: storageStatePath,
          SOCIALOPS_STORAGE_STATE_MAX_AGE_HOURS: "24",
          AUTOPILOT_STORAGE_STATE_CHECK_JSON: checkPath,
          AUTOPILOT_AUTH_BOOTSTRAP_LOG: logPath,
          SOCIALOPS_GCP_PROJECT_ID: "",
          SOCIALOPS_PLAYWRIGHT_STORAGE_STATE_SECRET: "",
        },
        stdio: "pipe",
      });
    } catch (err) {
      status = (err as { status?: number }).status ?? 1;
    }

    expect(status).toBe(2);
    expect(statSync(checkPath).size).toBeGreaterThan(0);
    expect(readFileSync(logPath, "utf8")).toContain("Storage state is missing/stale");
  });
});
