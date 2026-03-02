#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { loadLocalEnv } from "./_load-env.mjs";

loadLocalEnv();

function readEnv(name, fallback = "") {
  const value = process.env[name];
  if (typeof value !== "string") return fallback;
  const normalized = value.trim();
  return normalized || fallback;
}

function readBool(name, fallback) {
  const value = readEnv(name, "");
  if (!value) return fallback;
  const normalized = value.toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes") return true;
  if (normalized === "false" || normalized === "0" || normalized === "no") return false;
  return fallback;
}

function readInt(name, fallback, min, max) {
  const parsed = Number.parseInt(readEnv(name, ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function resolveServiceUrl() {
  return (
    readEnv("SOCIAL_DISPATCH_SERVICE_URL") ||
    readEnv("SOCIAL_DRAFT_BASE_URL") ||
    readEnv("REVENUE_DAY30_BASE_URL") ||
    readEnv("REVENUE_DAY2_BASE_URL") ||
    readEnv("REVENUE_DAY1_BASE_URL")
  );
}

function resolveWorkerToken() {
  return (
    readEnv("SOCIAL_DRAFT_WORKER_TOKEN") ||
    readEnv("REVENUE_DAY30_WORKER_TOKEN") ||
    readEnv("REVENUE_DAY2_WORKER_TOKEN") ||
    readEnv("REVENUE_DAY1_WORKER_TOKEN")
  );
}

function resolveUid() {
  return (
    readEnv("SOCIAL_DRAFT_UID") ||
    readEnv("REVENUE_AUTOMATION_UID") ||
    readEnv("REVENUE_DAY30_UID") ||
    readEnv("REVENUE_DAY2_UID") ||
    readEnv("REVENUE_DAY1_UID") ||
    readEnv("VOICE_ACTIONS_DEFAULT_UID") ||
    readEnv("SQUARE_WEBHOOK_DEFAULT_UID")
  );
}

async function main() {
  const serviceUrl = resolveServiceUrl();
  const workerToken = resolveWorkerToken();
  const uid = resolveUid();
  const maxTasks = readInt("SOCIAL_DISPATCH_SMOKE_MAX_TASKS", 10, 1, 50);
  const retryFailed = readBool("SOCIAL_DISPATCH_SMOKE_RETRY_FAILED", false);
  const dryRun = readBool("SOCIAL_DISPATCH_SMOKE_DRY_RUN", true);

  if (!serviceUrl) {
    throw new Error(
      "Missing SOCIAL_DISPATCH_SERVICE_URL (or SOCIAL_DRAFT_BASE_URL/REVENUE_DAY*_BASE_URL fallback)."
    );
  }
  if (!workerToken) {
    throw new Error(
      "Missing SOCIAL_DRAFT_WORKER_TOKEN (or REVENUE_DAY*_WORKER_TOKEN fallback)."
    );
  }
  if (!uid) {
    throw new Error(
      "Missing SOCIAL_DRAFT_UID (or revenue/default uid fallback env)."
    );
  }

  const correlationId = `social-dispatch-smoke-${randomUUID()}`;
  const endpoint = `${serviceUrl.replace(/\/+$/, "")}/api/social/drafts/dispatch/worker-task`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${workerToken}`,
      "X-Correlation-Id": correlationId,
    },
    body: JSON.stringify({
      uid,
      maxTasks,
      retryFailed,
      dryRun,
    }),
  });

  const bodyText = await response.text().catch(() => "");
  let bodyJson = null;
  try {
    bodyJson = bodyText ? JSON.parse(bodyText) : null;
  } catch {
    bodyJson = null;
  }

  if (!response.ok) {
    throw new Error(
      `Dispatch smoke failed: status=${response.status} body=${bodyText.slice(0, 600)}`
    );
  }

  const payload = bodyJson || {};
  console.log(
    JSON.stringify(
      {
        ok: true,
        route: "/api/social/drafts/dispatch/worker-task",
        correlationId,
        scanned: payload.scanned ?? 0,
        attempted: payload.attempted ?? 0,
        dispatched: payload.dispatched ?? 0,
        failed: payload.failed ?? 0,
        skipped: payload.skipped ?? 0,
        dryRun,
        retryFailed,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[social-dispatch-smoke] ${message}`);
  process.exit(1);
});
