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
  "SMAUTO_MCP_SERVER_URL",
  "SMAUTO_MCP_API_KEY",
  "SMAUTO_MCP_AUTH_MODE",
  "SMAUTO_MCP_ID_TOKEN_AUDIENCE",
  "LEADOPS_MCP_SERVER_URL",
  "LEADOPS_MCP_API_KEY",
  "SOCIAL_DRAFT_WORKER_TOKEN",
  "SOCIAL_DRAFT_APPROVAL_BASE_URL",
  "SOCIAL_DRAFT_GOOGLE_CHAT_WEBHOOK_URL",
  "SOCIAL_DRAFT_GOOGLE_CHAT_WEBHOOK_URL_RTS",
  "SOCIAL_DRAFT_GOOGLE_CHAT_WEBHOOK_URL_RNG",
  "SOCIAL_DRAFT_GOOGLE_CHAT_WEBHOOK_URL_AICF",
  "GOOGLE_CHAT_MKT_SOCIAL_WEBHOOK_URL",
  "REVENUE_DAY30_WORKER_TOKEN",
  "REVENUE_DAY2_WORKER_TOKEN",
  "REVENUE_DAY1_WORKER_TOKEN",
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
    expect(report.checks.find((check) => check.id === "smauto-mcp-connector")?.state).toBe("warning");
    expect(report.checks.find((check) => check.id === "smauto-mcp-auth")?.state).toBe("warning");
    expect(report.checks.find((check) => check.id === "leadops-mcp-connector")?.state).toBe("warning");
  });

  it("marks MCP connector checks ok when endpoint and key are provided", () => {
    process.env.GOOGLE_PLACES_API_KEY = "x";
    process.env.LEAD_SOURCE_BUDGET_MAX_COST_USD = "2";
    process.env.LEAD_SOURCE_BUDGET_MAX_PAGES = "4";
    process.env.LEAD_SOURCE_BUDGET_MAX_RUNTIME_SEC = "50";
    process.env.LEAD_RUNS_TASK_QUEUE = "lead-run-worker";
    process.env.LEAD_RUNS_TASK_LOCATION = "us-central1";
    process.env.SMAUTO_MCP_SERVER_URL = "https://smauto.example/mcp";
    process.env.SMAUTO_MCP_API_KEY = "token";
    process.env.LEADOPS_MCP_SERVER_URL = "https://leadops.example/mcp";
    process.env.LEADOPS_MCP_API_KEY = "token";

    const report = buildRuntimePreflightReport();
    expect(report.checks.find((check) => check.id === "smauto-mcp-connector")?.state).toBe("ok");
    expect(report.checks.find((check) => check.id === "smauto-mcp-auth")?.state).toBe("ok");
    expect(report.checks.find((check) => check.id === "leadops-mcp-connector")?.state).toBe("ok");
  });

  it("warns when id-token auth is enabled without audience", () => {
    process.env.GOOGLE_PLACES_API_KEY = "x";
    process.env.LEAD_SOURCE_BUDGET_MAX_COST_USD = "2";
    process.env.LEAD_SOURCE_BUDGET_MAX_PAGES = "4";
    process.env.LEAD_SOURCE_BUDGET_MAX_RUNTIME_SEC = "50";
    process.env.LEAD_RUNS_TASK_QUEUE = "lead-run-worker";
    process.env.LEAD_RUNS_TASK_LOCATION = "us-central1";
    process.env.SMAUTO_MCP_SERVER_URL = "https://smauto.example/mcp";
    process.env.SMAUTO_MCP_AUTH_MODE = "id_token";

    const report = buildRuntimePreflightReport();
    expect(report.checks.find((check) => check.id === "smauto-mcp-auth")?.state).toBe("warning");
  });

  it("warns when MCP connector URLs are invalid", () => {
    process.env.GOOGLE_PLACES_API_KEY = "x";
    process.env.LEAD_SOURCE_BUDGET_MAX_COST_USD = "2";
    process.env.LEAD_SOURCE_BUDGET_MAX_PAGES = "4";
    process.env.LEAD_SOURCE_BUDGET_MAX_RUNTIME_SEC = "50";
    process.env.LEAD_RUNS_TASK_QUEUE = "lead-run-worker";
    process.env.LEAD_RUNS_TASK_LOCATION = "us-central1";
    process.env.SMAUTO_MCP_SERVER_URL = "not-a-url";
    process.env.LEADOPS_MCP_SERVER_URL = "ftp://leadops.internal";

    const report = buildRuntimePreflightReport();
    const smAuto = report.checks.find((check) => check.id === "smauto-mcp-connector");
    const leadOps = report.checks.find((check) => check.id === "leadops-mcp-connector");

    expect(smAuto?.state).toBe("warning");
    expect(String(smAuto?.detail || "")).toContain("invalid");
    expect(leadOps?.state).toBe("warning");
    expect(String(leadOps?.detail || "")).toContain("invalid");
  });

  it("marks social draft checks ok when worker token/base url/webhook are configured", () => {
    process.env.GOOGLE_PLACES_API_KEY = "x";
    process.env.LEAD_SOURCE_BUDGET_MAX_COST_USD = "2";
    process.env.LEAD_SOURCE_BUDGET_MAX_PAGES = "4";
    process.env.LEAD_SOURCE_BUDGET_MAX_RUNTIME_SEC = "50";
    process.env.LEAD_RUNS_TASK_QUEUE = "lead-run-worker";
    process.env.LEAD_RUNS_TASK_LOCATION = "us-central1";
    process.env.SOCIAL_DRAFT_WORKER_TOKEN = "social-token";
    process.env.SOCIAL_DRAFT_APPROVAL_BASE_URL = "https://leadflow-review.web.app";
    process.env.SOCIAL_DRAFT_GOOGLE_CHAT_WEBHOOK_URL = "https://chat.googleapis.com/v1/spaces/x/messages?key=k&token=t";

    const report = buildRuntimePreflightReport();

    expect(report.checks.find((check) => check.id === "social-draft-worker-token")?.state).toBe("ok");
    expect(report.checks.find((check) => check.id === "social-draft-approval-base-url")?.state).toBe("ok");
    expect(report.checks.find((check) => check.id === "social-draft-webhook")?.state).toBe("ok");
  });
});
