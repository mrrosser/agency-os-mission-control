import { loadLocalEnv } from "./_load-env.mjs";

loadLocalEnv();

const baseUrl = (
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
  process.env.SOCIAL_DRAFT_UID ||
    process.env.REVENUE_AUTOMATION_UID ||
    process.env.REVENUE_DAY30_UID ||
    process.env.REVENUE_DAY2_UID ||
    process.env.REVENUE_DAY1_UID ||
    process.env.VOICE_ACTIONS_DEFAULT_UID ||
    process.env.SQUARE_WEBHOOK_DEFAULT_UID ||
    ""
).trim();

const businessKey = String(process.env.SOCIAL_DRAFT_BUSINESS_KEY || "rng")
  .trim()
  .toLowerCase();

const allowedBusinessKeys = new Set(["aicf", "rng", "rts"]);
if (!allowedBusinessKeys.has(businessKey)) {
  console.error("Invalid SOCIAL_DRAFT_BUSINESS_KEY. Expected one of: aicf, rng, rts.");
  process.exit(1);
}

const channels = String(
  process.env.SOCIAL_DRAFT_CHANNELS || "instagram_post,facebook_post"
)
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

const caption = String(process.env.SOCIAL_DRAFT_CAPTION || "").trim();
const source = String(process.env.SOCIAL_DRAFT_SOURCE || "openclaw_social_orchestrator").trim();
const publishAt = String(process.env.SOCIAL_DRAFT_PUBLISH_AT || "").trim();
const idempotencyKey = String(process.env.SOCIAL_DRAFT_IDEMPOTENCY_KEY || "").trim();
const requestApproval =
  String(process.env.SOCIAL_DRAFT_REQUEST_APPROVAL || "true").trim().toLowerCase() !== "false";

let media = [];
const mediaRaw = String(process.env.SOCIAL_DRAFT_MEDIA_JSON || "").trim();
if (mediaRaw) {
  try {
    const parsed = JSON.parse(mediaRaw);
    if (Array.isArray(parsed)) {
      media = parsed;
    } else {
      console.error("SOCIAL_DRAFT_MEDIA_JSON must be a JSON array.");
      process.exit(1);
    }
  } catch (error) {
    console.error("SOCIAL_DRAFT_MEDIA_JSON is invalid JSON.", {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  }
}

if (!workerToken) {
  console.error(
    "Missing SOCIAL_DRAFT_WORKER_TOKEN (or fallback REVENUE_DAY30/2/1 worker token)."
  );
  process.exit(1);
}
if (!uid) {
  console.error(
    "Missing SOCIAL_DRAFT_UID (or fallback REVENUE_AUTOMATION_UID/REVENUE_DAY30_UID/REVENUE_DAY2_UID/REVENUE_DAY1_UID)."
  );
  process.exit(1);
}
if (!caption) {
  console.error("Missing SOCIAL_DRAFT_CAPTION.");
  process.exit(1);
}
if (!channels.length) {
  console.error(
    "Missing SOCIAL_DRAFT_CHANNELS. Example: instagram_post,facebook_post"
  );
  process.exit(1);
}

const payload = {
  uid,
  businessKey,
  channels,
  caption,
  media,
  source,
  requestApproval,
  ...(publishAt ? { publishAt } : {}),
  ...(idempotencyKey ? { idempotencyKey } : {}),
};

const response = await fetch(`${baseUrl}/api/social/drafts/worker-task`, {
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
  console.error("Social draft worker run failed", {
    status: response.status,
    body,
  });
  process.exit(1);
}

console.log("Social draft worker run complete", {
  status: response.status,
  draftId: body?.draft?.draftId,
  businessKey: body?.draft?.businessKey,
  channels: body?.draft?.channels,
  approvalNotified: body?.approvalNotified,
  approvalLinkIssued: Boolean(body?.approvalUrls?.approve),
  warning: body?.warning || null,
  replayed: body?.replayed || false,
});
