const baseUrl = (
  process.env.REVENUE_DAY30_BASE_URL ||
  process.env.REVENUE_DAY2_BASE_URL ||
  process.env.REVENUE_DAY1_BASE_URL ||
  process.env.SMOKE_BASE_URL ||
  "http://localhost:3000"
).replace(/\/+$/, "");

const workerToken = String(
  process.env.REVENUE_DAY30_WORKER_TOKEN ||
    process.env.REVENUE_DAY2_WORKER_TOKEN ||
    process.env.REVENUE_DAY1_WORKER_TOKEN ||
    ""
).trim();

const uid = String(
  process.env.REVENUE_DAY30_UID ||
    process.env.REVENUE_AUTOMATION_UID ||
    process.env.REVENUE_DAY2_UID ||
    process.env.REVENUE_DAY1_UID ||
    process.env.VOICE_ACTIONS_DEFAULT_UID ||
    process.env.SQUARE_WEBHOOK_DEFAULT_UID ||
    ""
).trim();

const templateIdsEnv = String(
  process.env.REVENUE_DAY30_TEMPLATE_IDS ||
    process.env.REVENUE_DAY2_TEMPLATE_IDS ||
    process.env.REVENUE_DAY1_TEMPLATE_ID ||
    ""
).trim();

const timeZone = String(
  process.env.REVENUE_DAY30_TIMEZONE || process.env.REVENUE_AUTOMATION_TIME_ZONE || "America/Chicago"
).trim();

const dryRun = String(process.env.REVENUE_DAY30_DRY_RUN || "").trim().toLowerCase() === "true";
const forceRun = String(process.env.REVENUE_DAY30_FORCE_RUN || "").trim().toLowerCase() === "true";
const autoQueueFollowups =
  String(process.env.REVENUE_DAY30_AUTO_QUEUE_FOLLOWUPS || "true").trim().toLowerCase() !== "false";
const processDueResponses =
  String(process.env.REVENUE_DAY30_PROCESS_DUE_RESPONSES || "true").trim().toLowerCase() !== "false";
const requireApprovalGates =
  String(process.env.REVENUE_DAY30_REQUIRE_APPROVAL_GATES || "true").trim().toLowerCase() !== "false";
const runWeeklyKpi =
  String(process.env.REVENUE_DAY30_RUN_WEEKLY_KPI || "").trim().toLowerCase() === "true";
const runServiceLab =
  String(process.env.REVENUE_DAY30_RUN_SERVICE_LAB || "").trim().toLowerCase() === "true";
const runCloserQueue =
  String(process.env.REVENUE_DAY30_RUN_CLOSER_QUEUE || "true").trim().toLowerCase() !== "false";
const runRevenueMemory =
  String(process.env.REVENUE_DAY30_RUN_REVENUE_MEMORY || "true").trim().toLowerCase() !== "false";

const followupDelayHours = Number.parseInt(
  String(process.env.REVENUE_DAY30_FOLLOWUP_DELAY_HOURS || "48"),
  10
);
const followupMaxLeads = Number.parseInt(
  String(process.env.REVENUE_DAY30_FOLLOWUP_MAX_LEADS || "25"),
  10
);
const followupSequence = Number.parseInt(
  String(process.env.REVENUE_DAY30_FOLLOWUP_SEQUENCE || "1"),
  10
);
const responseLoopMaxTasks = Number.parseInt(
  String(process.env.REVENUE_DAY30_RESPONSE_LOOP_MAX_TASKS || "10"),
  10
);
const serviceCandidateLimit = Number.parseInt(
  String(process.env.REVENUE_DAY30_SERVICE_CANDIDATE_LIMIT || "5"),
  10
);
const closerQueueLookbackHours = Number.parseInt(
  String(process.env.REVENUE_DAY30_CLOSER_LOOKBACK_HOURS || "72"),
  10
);
const closerQueueLimit = Number.parseInt(
  String(process.env.REVENUE_DAY30_CLOSER_QUEUE_LIMIT || "40"),
  10
);
const memoryLookbackDays = Number.parseInt(
  String(process.env.REVENUE_DAY30_MEMORY_LOOKBACK_DAYS || "30"),
  10
);
const dateKey = String(process.env.REVENUE_DAY30_DATE_KEY || "").trim();

const templateIds = templateIdsEnv
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

if (!workerToken) {
  console.error(
    "Missing REVENUE_DAY30_WORKER_TOKEN (or REVENUE_DAY2_WORKER_TOKEN/REVENUE_DAY1_WORKER_TOKEN fallback)"
  );
  process.exit(1);
}
if (!uid) {
  console.error(
    "Missing REVENUE_DAY30_UID (or REVENUE_AUTOMATION_UID/REVENUE_DAY2_UID/REVENUE_DAY1_UID fallback)"
  );
  process.exit(1);
}
if (!templateIds.length) {
  console.error("Missing REVENUE_DAY30_TEMPLATE_IDS (comma-separated template IDs)");
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
  runWeeklyKpi,
  runServiceLab,
  runCloserQueue,
  runRevenueMemory,
  followupDelayHours: Number.isFinite(followupDelayHours) ? followupDelayHours : 48,
  followupMaxLeads: Number.isFinite(followupMaxLeads) ? followupMaxLeads : 25,
  followupSequence: Number.isFinite(followupSequence) ? followupSequence : 1,
  responseLoopMaxTasks: Number.isFinite(responseLoopMaxTasks) ? responseLoopMaxTasks : 10,
  serviceCandidateLimit: Number.isFinite(serviceCandidateLimit) ? serviceCandidateLimit : 5,
  closerQueueLookbackHours: Number.isFinite(closerQueueLookbackHours)
    ? closerQueueLookbackHours
    : 72,
  closerQueueLimit: Number.isFinite(closerQueueLimit) ? closerQueueLimit : 40,
  memoryLookbackDays: Number.isFinite(memoryLookbackDays) ? memoryLookbackDays : 30,
  ...(dateKey ? { dateKey } : {}),
};

const response = await fetch(`${baseUrl}/api/revenue/day30/worker-task`, {
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
  console.error("Day30 revenue run failed", {
    status: response.status,
    body,
  });
  process.exit(1);
}

console.log("Day30 revenue run complete", {
  status: response.status,
  templatesSucceeded: body?.day2?.totals?.templatesSucceeded,
  leadsScored: body?.day2?.totals?.leadsScored,
  responseCompleted: body?.day2?.totals?.responseCompleted,
  closerQueueSize: body?.closerQueue?.queueSize,
  closerQueueBreached: body?.closerQueue?.breachedCount,
  serviceCandidates: body?.serviceLab?.generated,
  decisionsScale: body?.weeklyKpi?.decisionSummary?.scale,
  decisionsFix: body?.weeklyKpi?.decisionSummary?.fix,
  decisionsKill: body?.weeklyKpi?.decisionSummary?.kill,
});
