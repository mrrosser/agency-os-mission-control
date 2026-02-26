#!/usr/bin/env node

import { initializeApp, applicationDefault, getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

function asString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function parseCsv(value) {
  return asString(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

async function readJsonResponse(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

async function exchangeCustomTokenForIdToken({ apiKey, customToken }) {
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${encodeURIComponent(
      apiKey
    )}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: customToken, returnSecureToken: true }),
    }
  );
  const body = await readJsonResponse(response);
  if (!response.ok || !asString(body.idToken)) {
    throw new Error(`Custom token exchange failed (${response.status}): ${JSON.stringify(body)}`);
  }
  return body.idToken;
}

const baseUrl = (
  process.env.SOCIAL_ACCEPTANCE_BASE_URL ||
  process.env.SOCIAL_DRAFT_BASE_URL ||
  process.env.SOCIAL_DISPATCH_BASE_URL ||
  process.env.REVENUE_DAY30_BASE_URL ||
  process.env.REVENUE_DAY2_BASE_URL ||
  process.env.REVENUE_DAY1_BASE_URL ||
  process.env.SMOKE_BASE_URL ||
  "http://localhost:3000"
).replace(/\/+$/, "");

const authMode = asString(process.env.SOCIAL_ACCEPTANCE_AUTH_MODE || "user").toLowerCase();
if (authMode !== "user" && authMode !== "worker") {
  throw new Error("Invalid SOCIAL_ACCEPTANCE_AUTH_MODE; expected user|worker.");
}

const uid = asString(
  process.env.SOCIAL_ACCEPTANCE_UID ||
    process.env.SOCIAL_DRAFT_UID ||
    process.env.REVENUE_AUTOMATION_UID ||
    process.env.REVENUE_DAY30_UID ||
    process.env.REVENUE_DAY2_UID ||
    process.env.REVENUE_DAY1_UID ||
    process.env.VOICE_ACTIONS_DEFAULT_UID ||
    process.env.SQUARE_WEBHOOK_DEFAULT_UID ||
    ""
);

const workerToken = asString(
  process.env.SOCIAL_DRAFT_WORKER_TOKEN ||
    process.env.REVENUE_DAY30_WORKER_TOKEN ||
    process.env.REVENUE_DAY2_WORKER_TOKEN ||
    process.env.REVENUE_DAY1_WORKER_TOKEN ||
    ""
);

const businessKey = asString(process.env.SOCIAL_ACCEPTANCE_BUSINESS_KEY || "rng").toLowerCase();
const channels = parseCsv(process.env.SOCIAL_ACCEPTANCE_CHANNELS || "instagram_post,facebook_post");
const mediaRaw = asString(process.env.SOCIAL_ACCEPTANCE_MEDIA_JSON || "");
const source = asString(
  process.env.SOCIAL_ACCEPTANCE_SOURCE || "social_non_admin_acceptance_probe"
);
const requestApproval =
  asString(process.env.SOCIAL_ACCEPTANCE_REQUEST_APPROVAL || "true").toLowerCase() !== "false";
const autoDecision =
  asString(process.env.SOCIAL_ACCEPTANCE_AUTO_DECISION || "true").toLowerCase() !== "false";
const decision = asString(process.env.SOCIAL_ACCEPTANCE_DECISION || "approve").toLowerCase();
const dispatchAfterDecision =
  asString(process.env.SOCIAL_ACCEPTANCE_DISPATCH_AFTER_DECISION || "true").toLowerCase() !==
  "false";
const dispatchDryRun =
  asString(process.env.SOCIAL_ACCEPTANCE_DISPATCH_DRY_RUN || "true").toLowerCase() !== "false";

const maxDispatchTasks = Math.max(
  1,
  Math.min(
    20,
    Number.parseInt(asString(process.env.SOCIAL_ACCEPTANCE_MAX_DISPATCH_TASKS || "5"), 10) || 5
  )
);

if (!uid) {
  throw new Error(
    "Missing SOCIAL_ACCEPTANCE_UID (or SOCIAL_DRAFT_UID/REVENUE_AUTOMATION_UID fallback)."
  );
}
if (!["aicf", "rng", "rts"].includes(businessKey)) {
  throw new Error("Invalid SOCIAL_ACCEPTANCE_BUSINESS_KEY; expected one of aicf|rng|rts.");
}
if (!channels.length) {
  throw new Error(
    "Missing SOCIAL_ACCEPTANCE_CHANNELS; expected CSV list (ex: instagram_post,facebook_post)."
  );
}
if (!["approve", "reject"].includes(decision)) {
  throw new Error("Invalid SOCIAL_ACCEPTANCE_DECISION; expected approve|reject.");
}

let media = [];
if (mediaRaw) {
  try {
    const parsed = JSON.parse(mediaRaw);
    if (!Array.isArray(parsed)) {
      throw new Error("SOCIAL_ACCEPTANCE_MEDIA_JSON must be a JSON array.");
    }
    media = parsed;
  } catch (error) {
    throw new Error(
      `Invalid SOCIAL_ACCEPTANCE_MEDIA_JSON: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

const caption =
  asString(process.env.SOCIAL_ACCEPTANCE_CAPTION) ||
  `Mission Control non-admin acceptance probe (${new Date().toISOString()})`;

let userAuthHeader = null;
if (authMode === "user") {
  const idTokenFromEnv = asString(process.env.SOCIAL_ACCEPTANCE_ID_TOKEN || "");
  if (idTokenFromEnv) {
    userAuthHeader = `Bearer ${idTokenFromEnv}`;
  } else {
    const firebaseApiKey = asString(
      process.env.SOCIAL_ACCEPTANCE_FIREBASE_API_KEY || process.env.NEXT_PUBLIC_FIREBASE_API_KEY
    );
    const projectId = asString(
      process.env.SOCIAL_ACCEPTANCE_PROJECT_ID ||
        process.env.GOOGLE_CLOUD_PROJECT ||
        process.env.GCLOUD_PROJECT ||
        process.env.FIREBASE_PROJECT_ID ||
        "leadflow-review"
    );
    if (!firebaseApiKey) {
      throw new Error(
        "Missing SOCIAL_ACCEPTANCE_FIREBASE_API_KEY (or NEXT_PUBLIC_FIREBASE_API_KEY) for user auth mode."
      );
    }
    if (getApps().length === 0) {
      initializeApp({ credential: applicationDefault(), projectId });
    }
    const customToken = await getAuth().createCustomToken(uid, {
      socialAcceptance: true,
      role: "client",
    });
    const idToken = await exchangeCustomTokenForIdToken({ apiKey: firebaseApiKey, customToken });
    userAuthHeader = `Bearer ${idToken}`;
  }
}

if (dispatchAfterDecision && !workerToken) {
  throw new Error(
    "Missing SOCIAL_DRAFT_WORKER_TOKEN (or REVENUE_DAY30/2/1 fallback) required for dispatch worker verification."
  );
}

const workerHeaders = {
  Authorization: `Bearer ${workerToken}`,
  "Content-Type": "application/json",
};

const userHeaders = {
  Authorization: userAuthHeader,
  "Content-Type": "application/json",
  "X-Idempotency-Key": `social-acceptance-${uid}-${Date.now()}`,
};

const draftPayload = {
  businessKey,
  channels,
  caption,
  media,
  source,
  requestApproval,
};

let draftResponse;
if (authMode === "worker") {
  draftResponse = await fetch(`${baseUrl}/api/social/drafts/worker-task`, {
    method: "POST",
    headers: workerHeaders,
    body: JSON.stringify({ uid, ...draftPayload }),
  });
} else {
  draftResponse = await fetch(`${baseUrl}/api/social/drafts`, {
    method: "POST",
    headers: userHeaders,
    body: JSON.stringify(draftPayload),
  });
}

const draftBody = await readJsonResponse(draftResponse);
if (!draftResponse.ok) {
  throw new Error(
    `Draft creation failed (status ${draftResponse.status}): ${JSON.stringify(draftBody)}`
  );
}

const draftId = asString(draftBody?.draft?.draftId);
const approvalApproveUrl = asString(draftBody?.approvalUrls?.approve);
const approvalRejectUrl = asString(draftBody?.approvalUrls?.reject);

let decisionBody = null;
let decisionStatus = null;
let decisionUrl = null;
if (requestApproval && autoDecision) {
  decisionUrl = decision === "approve" ? approvalApproveUrl : approvalRejectUrl;
  if (!decisionUrl) {
    throw new Error(
      "Approval URL missing from draft response; verify SOCIAL_DRAFT_APPROVAL_BASE_URL + webhook config."
    );
  }

  const decisionResponse = await fetch(decisionUrl, {
    method: "GET",
    headers: { Accept: "application/json" },
  });
  decisionBody = await readJsonResponse(decisionResponse);
  decisionStatus = decisionResponse.status;
  if (!decisionResponse.ok) {
    throw new Error(
      `Decision call failed (status ${decisionResponse.status}): ${JSON.stringify(decisionBody)}`
    );
  }
}

let listedDraftStatus = null;
if (authMode === "user") {
  const listResponse = await fetch(`${baseUrl}/api/social/drafts?limit=10`, {
    method: "GET",
    headers: { Authorization: userAuthHeader },
  });
  const listBody = await readJsonResponse(listResponse);
  if (listResponse.ok && Array.isArray(listBody.drafts)) {
    const row = listBody.drafts.find((item) => asString(item?.draftId) === draftId);
    listedDraftStatus = asString(row?.status) || null;
  }
}

let dispatchBody = null;
let dispatchStatus = null;
if (dispatchAfterDecision) {
  const dispatchResponse = await fetch(`${baseUrl}/api/social/drafts/dispatch/worker-task`, {
    method: "POST",
    headers: workerHeaders,
    body: JSON.stringify({
      uid,
      maxTasks: maxDispatchTasks,
      retryFailed: false,
      dryRun: dispatchDryRun,
    }),
  });
  dispatchBody = await readJsonResponse(dispatchResponse);
  dispatchStatus = dispatchResponse.status;
  if (!dispatchResponse.ok) {
    throw new Error(
      `Dispatch worker call failed (status ${dispatchResponse.status}): ${JSON.stringify(dispatchBody)}`
    );
  }
}

process.stdout.write(
  JSON.stringify(
    {
      ok: true,
      authMode,
      baseUrl,
      uid,
      draftId,
      requestApproval,
      autoDecision,
      decision,
      decisionUrl,
      draftStatus: draftResponse.status,
      decisionStatus,
      listedDraftStatus,
      dispatchStatus,
      dispatchDryRun,
      workerResult: {
        replayed: Boolean(draftBody?.replayed),
        approvalNotified: Boolean(draftBody?.approvalNotified),
        warning: draftBody?.warning || null,
      },
      decisionResult: decisionBody,
      dispatchResult: dispatchBody,
      generatedAt: new Date().toISOString(),
    },
    null,
    2
  ) + "\n"
);
