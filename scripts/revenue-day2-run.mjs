const baseUrl = (
  process.env.REVENUE_DAY2_BASE_URL ||
  process.env.REVENUE_DAY1_BASE_URL ||
  process.env.SMOKE_BASE_URL ||
  "http://localhost:3000"
).replace(/\/+$/, "");
const workerToken = String(
  process.env.REVENUE_DAY2_WORKER_TOKEN || process.env.REVENUE_DAY1_WORKER_TOKEN || ""
).trim();
const uid = String(
  process.env.REVENUE_DAY2_UID ||
    process.env.REVENUE_AUTOMATION_UID ||
    process.env.REVENUE_DAY1_UID ||
    process.env.VOICE_ACTIONS_DEFAULT_UID ||
    process.env.SQUARE_WEBHOOK_DEFAULT_UID ||
    ""
).trim();
const templateIdsEnv = String(
  process.env.REVENUE_DAY2_TEMPLATE_IDS || process.env.REVENUE_DAY1_TEMPLATE_ID || ""
).trim();
const timeZone = String(
  process.env.REVENUE_DAY2_TIMEZONE || process.env.REVENUE_AUTOMATION_TIME_ZONE || "America/Chicago"
).trim();

const dryRun = String(process.env.REVENUE_DAY2_DRY_RUN || "").trim().toLowerCase() === "true";
const forceRun = String(process.env.REVENUE_DAY2_FORCE_RUN || "").trim().toLowerCase() === "true";
const autoQueueFollowups =
  String(process.env.REVENUE_DAY2_AUTO_QUEUE_FOLLOWUPS || "true").trim().toLowerCase() !== "false";
const processDueResponses =
  String(process.env.REVENUE_DAY2_PROCESS_DUE_RESPONSES || "true").trim().toLowerCase() !== "false";
const requireApprovalGates =
  String(process.env.REVENUE_DAY2_REQUIRE_APPROVAL_GATES || "true").trim().toLowerCase() !== "false";

const followupDelayHours = Number.parseInt(String(process.env.REVENUE_DAY2_FOLLOWUP_DELAY_HOURS || "48"), 10);
const followupMaxLeads = Number.parseInt(String(process.env.REVENUE_DAY2_FOLLOWUP_MAX_LEADS || "25"), 10);
const followupSequence = Number.parseInt(String(process.env.REVENUE_DAY2_FOLLOWUP_SEQUENCE || "1"), 10);
const responseLoopMaxTasks = Number.parseInt(String(process.env.REVENUE_DAY2_RESPONSE_LOOP_MAX_TASKS || "10"), 10);
const dateKey = String(process.env.REVENUE_DAY2_DATE_KEY || "").trim();

const templateIds = templateIdsEnv
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

if (!workerToken) {
  console.error("Missing REVENUE_DAY2_WORKER_TOKEN (or REVENUE_DAY1_WORKER_TOKEN fallback)");
  process.exit(1);
}
if (!uid) {
  console.error(
    "Missing REVENUE_DAY2_UID (or REVENUE_AUTOMATION_UID/REVENUE_DAY1_UID/VOICE_ACTIONS_DEFAULT_UID/SQUARE_WEBHOOK_DEFAULT_UID)"
  );
  process.exit(1);
}
if (!templateIds.length) {
  console.error("Missing REVENUE_DAY2_TEMPLATE_IDS (comma-separated template IDs)");
  process.exit(1);
}

const payload = {
  uid,
  templateIds,
  dryRun,
  forceRun,
  timeZone,
  autoQueueFollowups,
  processDueResponses,
  requireApprovalGates,
  followupDelayHours: Number.isFinite(followupDelayHours) ? followupDelayHours : 48,
  followupMaxLeads: Number.isFinite(followupMaxLeads) ? followupMaxLeads : 25,
  followupSequence: Number.isFinite(followupSequence) ? followupSequence : 1,
  responseLoopMaxTasks: Number.isFinite(responseLoopMaxTasks) ? responseLoopMaxTasks : 10,
  ...(dateKey ? { dateKey } : {}),
};

const response = await fetch(`${baseUrl}/api/revenue/day2/worker-task`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${workerToken}`,
  },
  body: JSON.stringify(payload),
});

const bodyText = await response.text();
let body;
try {
  body = bodyText ? JSON.parse(bodyText) : {};
} catch {
  body = { raw: bodyText };
}

if (!response.ok) {
  console.error("Day2 revenue run failed", {
    status: response.status,
    body,
  });
  process.exit(1);
}

console.log("Day2 revenue run complete", {
  status: response.status,
  templateCount: Array.isArray(body?.templates) ? body.templates.length : 0,
  templatesSucceeded: body?.totals?.templatesSucceeded,
  leadsScored: body?.totals?.leadsScored,
  followupsSeeded: body?.totals?.followupsSeeded,
  responseProcessed: body?.totals?.responseProcessed,
  responseCompleted: body?.totals?.responseCompleted,
  responseFailed: body?.totals?.responseFailed,
});
