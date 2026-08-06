#!/usr/bin/env node

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_LOCATION = "us-central1";
const DEFAULT_TIME_ZONE = "America/Chicago";
const GCLOUD_BIN = "gcloud";
const GCLOUD_USE_SHELL = false;

// repo-improvement: gcloud-runtime-hardening
export function createWritableGcloudEnv(baseEnv = process.env, options = {}) {
  const { preferFresh = false } = options;
  const sourceEnv = { ...baseEnv };

  let configRoot = sourceEnv.CLOUDSDK_CONFIG?.trim();
  let freshConfig = false;
  if (!configRoot && !preferFresh) {
    const defaultCandidates = [
      sourceEnv.APPDATA ? join(sourceEnv.APPDATA, "gcloud") : "",
      join(homedir(), ".config", "gcloud"),
    ].filter(Boolean);
    configRoot = defaultCandidates.find((candidate) => existsSync(candidate));
  }
  if (!configRoot || preferFresh) {
    configRoot = mkdtempSync(join(tmpdir(), "mission-control-gcloud-"));
    freshConfig = true;
  }

  const logDir = join(configRoot, "logs");
  mkdirSync(logDir, { recursive: true });
  if (freshConfig) {
    const configDir = join(configRoot, "configurations");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, "config_default"), "[core]\ndisable_usage_reporting = True\n", {
      encoding: "utf8",
    });
  }

  const writableEnv = {
    ...sourceEnv,
    CLOUDSDK_CONFIG: configRoot,
    CLOUDSDK_LOG_DIR: logDir,
  };
  // Preserve the caller's named active configuration. When the variable is
  // absent, gcloud reads the active_config marker from the selected config
  // root. Only a newly-created isolated root should be pinned to default.
  if (freshConfig) {
    writableEnv.CLOUDSDK_ACTIVE_CONFIG_NAME = "default";
  }
  return writableEnv;
}

export function buildGcloudInvocation(args, options = {}) {
  const { platform = process.platform, env = process.env, preferFresh = false } = options;
  const invocationEnv = createWritableGcloudEnv(env, { preferFresh });

  if (platform === "win32") {
    return {
      command: "cmd.exe",
      args: ["/d", "/s", "/c", GCLOUD_BIN, ...args],
      env: invocationEnv,
    };
  }

  return {
    command: GCLOUD_BIN,
    args,
    env: invocationEnv,
  };
}

export const JOB_SPECS = [
  {
    name: "revenue-automation-rts",
    endpointPath: "/api/revenue/automation/daily/worker-task",
    scheduleEnv: "REVENUE_AUTOMATION_RTS_CRON",
    defaultSchedule: "5 5 * * *",
    payload: {
      uid: true,
      businessKey: "rts",
      dueOnly: true,
      dryRun: false,
      requireApprovalGates: true,
      runWeeklyKpi: false,
      runStagesIncludes: "day30",
    },
  },
  {
    name: "revenue-automation-rng",
    endpointPath: "/api/revenue/automation/daily/worker-task",
    scheduleEnv: "REVENUE_AUTOMATION_RNG_CRON",
    defaultSchedule: "20 5 * * *",
    payload: {
      uid: true,
      businessKey: "rng",
      dueOnly: true,
      dryRun: false,
      requireApprovalGates: true,
      runWeeklyKpi: false,
      runStagesIncludes: "day30",
    },
  },
  {
    name: "revenue-automation-aicf",
    endpointPath: "/api/revenue/automation/daily/worker-task",
    scheduleEnv: "REVENUE_AUTOMATION_AICF_CRON",
    defaultSchedule: "35 5 * * *",
    payload: {
      uid: true,
      businessKey: "aicf",
      dueOnly: true,
      dryRun: false,
      requireApprovalGates: true,
      runWeeklyKpi: false,
      runStagesIncludes: "day30",
    },
  },
  {
    name: "revenue-weekly-brain",
    endpointPath: "/api/revenue/day30/worker-task",
    scheduleEnv: "REVENUE_WEEKLY_BRAIN_CRON",
    defaultSchedule: "10 6 * * 1",
    payload: {
      templateIds: true,
      uid: true,
      dryRun: false,
      requireApprovalGates: true,
      runWeeklyKpi: true,
    },
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

  if (typeof spec.businessKey === "string" && payload.businessKey !== spec.businessKey) {
    mismatches.push(
      `payload.businessKey expected=${spec.businessKey} actual=${String(payload.businessKey)}`
    );
  }

  for (const booleanField of ["dueOnly", "dryRun"]) {
    if (
      typeof spec[booleanField] === "boolean" &&
      payload[booleanField] !== spec[booleanField]
    ) {
      mismatches.push(
        `payload.${booleanField} expected=${spec[booleanField]} actual=${String(
          payload[booleanField]
        )}`
      );
    }
  }

  if (
    typeof spec.runStagesIncludes === "string" &&
    (!Array.isArray(payload.runStages) || !payload.runStages.includes(spec.runStagesIncludes))
  ) {
    mismatches.push(`payload.runStages missing=${spec.runStagesIncludes}`);
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
    const invocation = buildGcloudInvocation(args);
    const child = spawn(invocation.command, invocation.args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      shell: GCLOUD_USE_SHELL,
      env: invocation.env,
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

      const expectedSchedule = readEnv(spec.scheduleEnv, spec.defaultSchedule);
      if (described.schedule !== expectedSchedule) {
        jobMismatch.push(
          `schedule expected=${expectedSchedule} actual=${String(described.schedule || "")}`
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
              businessKey: typeof payload.businessKey === "string" ? payload.businessKey : null,
              dueOnly: typeof payload.dueOnly === "boolean" ? payload.dueOnly : null,
              dryRun: typeof payload.dryRun === "boolean" ? payload.dryRun : null,
              runStages: Array.isArray(payload.runStages) ? payload.runStages : null,
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

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
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
}
