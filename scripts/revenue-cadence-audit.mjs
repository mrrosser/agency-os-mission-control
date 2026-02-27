#!/usr/bin/env node

import { spawn } from "node:child_process";

const DEFAULT_LOCATION = "us-central1";
const DEFAULT_TIME_ZONE = "America/Chicago";
const GCLOUD_BIN = "gcloud";
const GCLOUD_USE_SHELL = process.platform === "win32";

const JOB_SPECS = [
  {
    name: "revenue-day1-rts-start",
    endpointPath: "/api/revenue/day1/worker-task",
    payload: { templateId: true, uid: true, requireApprovalGates: null, runWeeklyKpi: null },
  },
  {
    name: "revenue-day1-rng-start",
    endpointPath: "/api/revenue/day1/worker-task",
    payload: { templateId: true, uid: true, requireApprovalGates: null, runWeeklyKpi: null },
  },
  {
    name: "revenue-day1-aicf-start",
    endpointPath: "/api/revenue/day1/worker-task",
    payload: { templateId: true, uid: true, requireApprovalGates: null, runWeeklyKpi: null },
  },
  {
    name: "revenue-day2-rts-loop",
    endpointPath: "/api/revenue/day2/worker-task",
    payload: { templateIds: true, uid: true, requireApprovalGates: true, runWeeklyKpi: null },
  },
  {
    name: "revenue-day2-rng-loop",
    endpointPath: "/api/revenue/day2/worker-task",
    payload: { templateIds: true, uid: true, requireApprovalGates: true, runWeeklyKpi: null },
  },
  {
    name: "revenue-day2-aicf-loop",
    endpointPath: "/api/revenue/day2/worker-task",
    payload: { templateIds: true, uid: true, requireApprovalGates: true, runWeeklyKpi: null },
  },
  {
    name: "revenue-day30-rts-daily",
    endpointPath: "/api/revenue/day30/worker-task",
    payload: { templateIds: true, uid: true, requireApprovalGates: true, runWeeklyKpi: false },
  },
  {
    name: "revenue-day30-rng-daily",
    endpointPath: "/api/revenue/day30/worker-task",
    payload: { templateIds: true, uid: true, requireApprovalGates: true, runWeeklyKpi: false },
  },
  {
    name: "revenue-day30-aicf-daily",
    endpointPath: "/api/revenue/day30/worker-task",
    payload: { templateIds: true, uid: true, requireApprovalGates: true, runWeeklyKpi: false },
  },
  {
    name: "revenue-day30-weekly-brain",
    endpointPath: "/api/revenue/day30/worker-task",
    payload: { templateIds: true, uid: true, requireApprovalGates: true, runWeeklyKpi: true },
  },
];

function readEnv(name, fallback = "") {
  const value = process.env[name];
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed || fallback;
}

function parseBoolean(value, fallback) {
  if (!value) return fallback;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "y"].includes(normalized)) return true;
  if (["0", "false", "no", "n"].includes(normalized)) return false;
  return fallback;
}

function decodeBodyToJson(base64Body) {
  if (!base64Body) return null;
  try {
    const text = Buffer.from(base64Body, "base64").toString("utf8");
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function sanitizePath(value) {
  try {
    const parsed = new URL(value);
    return parsed.pathname;
  } catch {
    return "";
  }
}

function validatePayload(payload, spec) {
  const mismatches = [];
  if (!payload || typeof payload !== "object") {
    return ["payload missing or invalid JSON"];
  }

  if (spec.templateId && typeof payload.templateId !== "string") {
    mismatches.push("payload.templateId missing");
  }

  if (spec.templateIds) {
    if (!Array.isArray(payload.templateIds) || payload.templateIds.length === 0) {
      mismatches.push("payload.templateIds missing");
    }
  }

  if (spec.uid && typeof payload.uid !== "string") {
    mismatches.push("payload.uid missing");
  }

  if (
    typeof spec.requireApprovalGates === "boolean" &&
    payload.requireApprovalGates !== spec.requireApprovalGates
  ) {
    mismatches.push(
      `payload.requireApprovalGates expected=${spec.requireApprovalGates} actual=${String(
        payload.requireApprovalGates
      )}`
    );
  }

  if (typeof spec.runWeeklyKpi === "boolean" && payload.runWeeklyKpi !== spec.runWeeklyKpi) {
    mismatches.push(
      `payload.runWeeklyKpi expected=${spec.runWeeklyKpi} actual=${String(payload.runWeeklyKpi)}`
    );
  }

  return mismatches;
}

function runGcloud(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(GCLOUD_BIN, args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      shell: GCLOUD_USE_SHELL,
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk || "");
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk || "");
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout);
        return;
      }
      reject(
        new Error(`${GCLOUD_BIN} ${args.join(" ")} failed with exit ${code}: ${stderr || stdout || ""}`)
      );
    });
  });
}

async function describeJob(jobName, projectId, location) {
  const output = await runGcloud([
    "scheduler",
    "jobs",
    "describe",
    jobName,
    "--project",
    projectId,
    "--location",
    location,
    "--format=json",
  ]);
  return JSON.parse(output);
}

async function main() {
  const projectId = readEnv("GCP_PROJECT_ID") || readEnv("GOOGLE_CLOUD_PROJECT");
  const location = readEnv("GCP_SCHEDULER_LOCATION", DEFAULT_LOCATION);
  const expectedTimeZone = readEnv("REVENUE_CADENCE_EXPECT_TIMEZONE", DEFAULT_TIME_ZONE);
  const expectedBaseUrl = readEnv("REVENUE_CADENCE_EXPECT_BASE_URL");
  const requireOidc = parseBoolean(readEnv("REVENUE_CADENCE_REQUIRE_OIDC"), false);
  const failOnMismatch = parseBoolean(readEnv("REVENUE_CADENCE_FAIL_ON_MISMATCH"), true);

  if (!projectId) {
    throw new Error("Missing GCP_PROJECT_ID (or GOOGLE_CLOUD_PROJECT).");
  }

  const jobResults = [];
  const mismatches = [];

  for (const spec of JOB_SPECS) {
    try {
      const described = await describeJob(spec.name, projectId, location);
      const target = described.httpTarget || {};
      const payload = decodeBodyToJson(target.body);
      const jobMismatch = [];

      if (described.state !== "ENABLED") {
        jobMismatch.push(`state expected=ENABLED actual=${String(described.state || "")}`);
      }
      if (described.timeZone !== expectedTimeZone) {
        jobMismatch.push(
          `timeZone expected=${expectedTimeZone} actual=${String(described.timeZone || "")}`
        );
      }

      const actualPath = sanitizePath(target.uri || "");
      if (actualPath !== spec.endpointPath) {
        jobMismatch.push(`path expected=${spec.endpointPath} actual=${actualPath || "<none>"}`);
      }

      if (expectedBaseUrl) {
        const normalizedBase = expectedBaseUrl.replace(/\/+$/, "");
        const actualUri = String(target.uri || "");
        if (!actualUri.startsWith(normalizedBase)) {
          jobMismatch.push(`uri host mismatch expected-prefix=${normalizedBase}`);
        }
      }

      const hasOidc = Boolean(target.oidcToken && target.oidcToken.serviceAccountEmail);
      if (requireOidc && !hasOidc) {
        jobMismatch.push("oidcToken missing");
      }

      jobMismatch.push(...validatePayload(payload, spec.payload));

      if (jobMismatch.length > 0) {
        mismatches.push({ job: spec.name, issues: jobMismatch });
      }

      jobResults.push({
        job: spec.name,
        exists: true,
        state: described.state || null,
        schedule: described.schedule || null,
        timeZone: described.timeZone || null,
        uri: target.uri || null,
        hasOidc,
        payloadSummary: payload
          ? {
              uidPresent: typeof payload.uid === "string" && payload.uid.length > 0,
              templateId: typeof payload.templateId === "string" ? payload.templateId : null,
              templateIds: Array.isArray(payload.templateIds) ? payload.templateIds : null,
              requireApprovalGates:
                typeof payload.requireApprovalGates === "boolean"
                  ? payload.requireApprovalGates
                  : null,
              runWeeklyKpi: typeof payload.runWeeklyKpi === "boolean" ? payload.runWeeklyKpi : null,
            }
          : null,
        mismatches: jobMismatch,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      mismatches.push({ job: spec.name, issues: [message] });
      jobResults.push({
        job: spec.name,
        exists: false,
        state: null,
        schedule: null,
        timeZone: null,
        uri: null,
        hasOidc: false,
        payloadSummary: null,
        mismatches: [message],
      });
    }
  }

  const output = {
    ok: mismatches.length === 0,
    checkedAt: new Date().toISOString(),
    projectId,
    location,
    expectedTimeZone,
    requireOidc,
    jobCount: JOB_SPECS.length,
    mismatchCount: mismatches.length,
    jobs: jobResults,
  };

  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);

  if (failOnMismatch && mismatches.length > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  process.stderr.write(
    `${JSON.stringify(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      null,
      2
    )}\n`
  );
  process.exit(1);
});
