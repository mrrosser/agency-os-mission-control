import { afterEach, describe, expect, it } from "vitest";
import { buildRuntimePreflightReport } from "@/lib/runtime/preflight";

const KEYS = [
  "GOOGLE_PLACES_API_KEY",
  "APIFY_TOKEN",
  "APIFY_GOOGLE_MAPS_ACTOR_ID",
  "LEAD_SOURCE_BUDGET_MAX_COST_USD",
  "LEAD_SOURCE_BUDGET_MAX_PAGES",
  "LEAD_SOURCE_BUDGET_MAX_RUNTIME_SEC",
  "LEAD_RUNS_TASK_QUEUE",
  "LEAD_RUNS_TASK_LOCATION",
  "LEAD_RUNS_TASK_SERVICE_ACCOUNT",
  "FOLLOWUPS_TASK_QUEUE",
  "FOLLOWUPS_TASK_LOCATION",
  "COMPETITOR_MONITOR_TASK_QUEUE",
  "COMPETITOR_MONITOR_TASK_LOCATION",
] as const;

const ORIGINAL_ENV: Partial<Record<(typeof KEYS)[number], string | undefined>> = {};
for (const key of KEYS) ORIGINAL_ENV[key] = process.env[key];

function resetEnv() {
  for (const key of KEYS) {
    const original = ORIGINAL_ENV[key];
    if (typeof original === "string") {
      process.env[key] = original;
    } else {
      delete process.env[key];
    }
  }
}

describe("buildRuntimePreflightReport", () => {
  afterEach(() => {
    resetEnv();
  });

  it("fails when required runtime keys are missing", () => {
    for (const key of KEYS) delete process.env[key];

    const report = buildRuntimePreflightReport();
    expect(report.status).toBe("fail");
    const requiredMissing = report.checks.filter(
      (check) => check.level === "required" && check.state === "missing"
    );
    expect(requiredMissing.length).toBeGreaterThan(0);
  });

  it("reports ok when required keys are present and warns on optional gaps", () => {
    process.env.GOOGLE_PLACES_API_KEY = "x";
    process.env.LEAD_SOURCE_BUDGET_MAX_COST_USD = "2";
    process.env.LEAD_SOURCE_BUDGET_MAX_PAGES = "4";
    process.env.LEAD_SOURCE_BUDGET_MAX_RUNTIME_SEC = "50";
    process.env.LEAD_RUNS_TASK_QUEUE = "lead-run-worker";
    process.env.LEAD_RUNS_TASK_LOCATION = "us-central1";

    const report = buildRuntimePreflightReport();
    expect(report.status).toBe("warn");
    expect(report.checks.find((check) => check.id === "lead-source-provider")?.state).toBe("ok");
    expect(report.checks.find((check) => check.id === "lead-run-queue")?.state).toBe("ok");
  });
});

