const baseUrl = (process.env.REVENUE_DAY1_BASE_URL || process.env.SMOKE_BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
const workerToken = String(process.env.REVENUE_DAY1_WORKER_TOKEN || "").trim();
const uid = String(
  process.env.REVENUE_DAY1_UID ||
    process.env.REVENUE_AUTOMATION_UID ||
    process.env.VOICE_ACTIONS_DEFAULT_UID ||
    process.env.SQUARE_WEBHOOK_DEFAULT_UID ||
    ""
).trim();
const templateId = String(process.env.REVENUE_DAY1_TEMPLATE_ID || "").trim();
const timeZone = String(process.env.REVENUE_DAY1_TIMEZONE || "America/Chicago").trim();

const dryRun = String(process.env.REVENUE_DAY1_DRY_RUN || "").trim().toLowerCase() === "true";
const forceRun = String(process.env.REVENUE_DAY1_FORCE_RUN || "").trim().toLowerCase() === "true";
const autoQueueFollowups =
  String(process.env.REVENUE_DAY1_AUTO_QUEUE_FOLLOWUPS || "true").trim().toLowerCase() !== "false";
const followupDelayHours = Number.parseInt(String(process.env.REVENUE_DAY1_FOLLOWUP_DELAY_HOURS || "48"), 10);
const followupMaxLeads = Number.parseInt(String(process.env.REVENUE_DAY1_FOLLOWUP_MAX_LEADS || "25"), 10);
const followupSequence = Number.parseInt(String(process.env.REVENUE_DAY1_FOLLOWUP_SEQUENCE || "1"), 10);
const dateKey = String(process.env.REVENUE_DAY1_DATE_KEY || "").trim();

if (!workerToken) {
  console.error("Missing REVENUE_DAY1_WORKER_TOKEN");
  process.exit(1);
}
if (!uid) {
  console.error("Missing REVENUE_DAY1_UID (or REVENUE_AUTOMATION_UID/VOICE_ACTIONS_DEFAULT_UID/SQUARE_WEBHOOK_DEFAULT_UID)");
  process.exit(1);
}
if (!templateId) {
  console.error("Missing REVENUE_DAY1_TEMPLATE_ID");
  process.exit(1);
}

const payload = {
  uid,
  templateId,
  dryRun,
  forceRun,
  timeZone,
  autoQueueFollowups,
  followupDelayHours: Number.isFinite(followupDelayHours) ? followupDelayHours : 48,
  followupMaxLeads: Number.isFinite(followupMaxLeads) ? followupMaxLeads : 25,
  followupSequence: Number.isFinite(followupSequence) ? followupSequence : 1,
  ...(dateKey ? { dateKey } : {}),
};

const response = await fetch(`${baseUrl}/api/revenue/day1/worker-task`, {
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
  console.error("Day1 revenue run failed", {
    status: response.status,
    body,
  });
  process.exit(1);
}

console.log("Day1 revenue run complete", {
  status: response.status,
  runId: body?.runId,
  templateId: body?.templateId,
  reused: body?.reused,
  leadsScored: body?.leadTotals?.scoredTotal,
  followupCreated: body?.followups?.created,
  followupExisting: body?.followups?.existing,
});
