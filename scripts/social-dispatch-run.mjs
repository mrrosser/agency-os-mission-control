import { loadLocalEnv } from "./_load-env.mjs";

loadLocalEnv();

const baseUrl = (
  process.env.SOCIAL_DISPATCH_BASE_URL ||
  process.env.SOCIAL_DRAFT_BASE_URL ||
  process.env.REVENUE_DAY30_BASE_URL ||
  process.env.REVENUE_DAY2_BASE_URL ||
  process.env.REVENUE_DAY1_BASE_URL ||
  process.env.SMOKE_BASE_URL ||
  "http://localhost:3000"
).replace(/\/+$/, "");

const workerToken = String(
  process.env.SOCIAL_DRAFT_WORKER_TOKEN ||
    process.env.REVENUE_DAY30_WORKER_TOKEN ||
    process.env.REVENUE_DAY2_WORKER_TOKEN ||
    process.env.REVENUE_DAY1_WORKER_TOKEN ||
    ""
).trim();

const uid = String(
  process.env.SOCIAL_DISPATCH_UID ||
    process.env.SOCIAL_DRAFT_UID ||
    process.env.REVENUE_AUTOMATION_UID ||
    process.env.REVENUE_DAY30_UID ||
    process.env.REVENUE_DAY2_UID ||
    process.env.REVENUE_DAY1_UID ||
    process.env.VOICE_ACTIONS_DEFAULT_UID ||
    process.env.SQUARE_WEBHOOK_DEFAULT_UID ||
    ""
).trim();

const maxTasks = Number.parseInt(String(process.env.SOCIAL_DISPATCH_MAX_TASKS || "10"), 10);
const retryFailed =
  String(process.env.SOCIAL_DISPATCH_RETRY_FAILED || "false").trim().toLowerCase() === "true";
const dryRun =
  String(process.env.SOCIAL_DISPATCH_DRY_RUN || "false").trim().toLowerCase() === "true";

if (!workerToken) {
  console.error(
    "Missing SOCIAL_DRAFT_WORKER_TOKEN (or fallback REVENUE_DAY30/2/1 worker token)."
  );
  process.exit(1);
}

if (!uid) {
  console.error(
    "Missing SOCIAL_DISPATCH_UID (or fallback SOCIAL_DRAFT_UID/REVENUE_AUTOMATION_UID/REVENUE_DAY30_UID/REVENUE_DAY2_UID/REVENUE_DAY1_UID)."
  );
  process.exit(1);
}

if (!Number.isFinite(maxTasks) || maxTasks < 1 || maxTasks > 50) {
  console.error("SOCIAL_DISPATCH_MAX_TASKS must be an integer between 1 and 50.");
  process.exit(1);
}

const payload = {
  uid,
  maxTasks,
  retryFailed,
  dryRun,
};

const response = await fetch(`${baseUrl}/api/social/drafts/dispatch/worker-task`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${workerToken}`,
  },
  body: JSON.stringify(payload),
});

const raw = await response.text();
let body;
try {
  body = raw ? JSON.parse(raw) : {};
} catch {
  body = { raw };
}

if (!response.ok) {
  console.error("Social dispatch worker run failed", {
    status: response.status,
    body,
  });
  process.exit(1);
}

console.log("Social dispatch worker run complete", {
  status: response.status,
  uid: body?.uid || uid,
  dryRun: body?.dryRun || false,
  retryFailed: body?.retryFailed || false,
  scanned: body?.scanned || 0,
  attempted: body?.attempted || 0,
  dispatched: body?.dispatched || 0,
  failed: body?.failed || 0,
  skipped: body?.skipped || 0,
});
