import "server-only";

import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { FieldValue } from "firebase-admin/firestore";
import { ApiError } from "@/lib/api/handler";
import { getAdminDb } from "@/lib/firebase-admin";
import type { Logger } from "@/lib/logging";

export type SocialDraftStatus =
  | "draft"
  | "pending_approval"
  | "approved"
  | "rejected"
  | "scheduled"
  | "posted"
  | "failed";

export type SocialDraftDispatchState = "pending_external_tool" | "dispatched" | "failed";

export type SocialDraftChannel =
  | "instagram_story"
  | "instagram_post"
  | "facebook_story"
  | "facebook_post";

export interface SocialDraftMediaAsset {
  type: "image" | "video";
  url: string;
  thumbnailUrl?: string;
  title?: string;
}

export interface SocialDraftRecord {
  draftId: string;
  uid: string;
  businessKey: "aicf" | "rng" | "rts";
  channels: SocialDraftChannel[];
  caption: string;
  media: SocialDraftMediaAsset[];
  status: SocialDraftStatus;
  source: string;
  correlationId: string;
  publishAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  dispatch: {
    status: SocialDraftDispatchState | null;
    queueDocId: string | null;
    queuedAt: string | null;
    externalTool: string | null;
    lastError: string | null;
  };
  approval: {
    decision: "approve" | "reject" | null;
    decisionSource: string | null;
    decidedAt: string | null;
    expiresAt: string | null;
    requestedAt: string | null;
  };
}

export interface CreateSocialDraftInput {
  uid: string;
  businessKey: "aicf" | "rng" | "rts";
  channels: SocialDraftChannel[];
  caption: string;
  media: SocialDraftMediaAsset[];
  source: string;
  publishAt?: string | null;
  correlationId: string;
  requestApproval: boolean;
  approvalTtlHours?: number;
  log: Logger;
}

export interface SocialDraftApprovalDispatchResult {
  draft: SocialDraftRecord;
  approvalNotified: boolean;
  approvalUrls: {
    approve: string | null;
    reject: string | null;
  };
  warning: string | null;
}

export interface SocialDraftExecutionQueuePayload {
  queueId: string;
  uid: string;
  draftId: string;
  businessKey: "aicf" | "rng" | "rts";
  channels: SocialDraftChannel[];
  caption: string;
  media: SocialDraftMediaAsset[];
  status: "pending_external_tool";
  externalTool: "SMAuto";
  source: "social_draft_approval";
  correlationId: string;
  queuedAt: string;
}

interface CreateSocialDraftResult {
  draft: SocialDraftRecord;
  approvalToken: string;
}

interface SocialDraftDoc {
  draftId?: unknown;
  uid?: unknown;
  businessKey?: unknown;
  channels?: unknown;
  caption?: unknown;
  media?: unknown;
  status?: unknown;
  source?: unknown;
  correlationId?: unknown;
  publishAt?: unknown;
  dispatch?: unknown;
  approval?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
}

function socialDraftCollection(uid: string) {
  return getAdminDb().collection("identities").doc(uid).collection("social_drafts");
}

function socialDispatchQueueCollection(uid: string) {
  return getAdminDb().collection("identities").doc(uid).collection("social_dispatch_queue");
}

export function socialDispatchQueueDocId(draftId: string): string {
  return `draft_${asString(draftId) || "unknown"}`;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asNullableString(value: unknown): string | null {
  const normalized = asString(value);
  return normalized || null;
}

function asTimestampIso(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.valueOf()) ? null : parsed.toISOString();
  }
  const candidate = value as { toDate?: () => Date };
  if (typeof candidate.toDate === "function") {
    try {
      const parsed = candidate.toDate();
      return Number.isNaN(parsed.valueOf()) ? null : parsed.toISOString();
    } catch {
      return null;
    }
  }
  return null;
}

function normalizeBusinessKey(value: unknown): "aicf" | "rng" | "rts" {
  const normalized = asString(value).toLowerCase();
  if (normalized === "aicf" || normalized === "rng" || normalized === "rts") return normalized;
  return "aicf";
}

function normalizeStatus(value: unknown): SocialDraftStatus {
  const normalized = asString(value).toLowerCase();
  if (
    normalized === "draft" ||
    normalized === "pending_approval" ||
    normalized === "approved" ||
    normalized === "rejected" ||
    normalized === "scheduled" ||
    normalized === "posted" ||
    normalized === "failed"
  ) {
    return normalized;
  }
  return "draft";
}

function normalizeChannels(value: unknown): SocialDraftChannel[] {
  if (!Array.isArray(value)) return [];
  const allowed = new Set<SocialDraftChannel>([
    "instagram_story",
    "instagram_post",
    "facebook_story",
    "facebook_post",
  ]);
  const out: SocialDraftChannel[] = [];
  for (const raw of value) {
    const candidate = asString(raw) as SocialDraftChannel;
    if (!allowed.has(candidate)) continue;
    if (!out.includes(candidate)) out.push(candidate);
  }
  return out;
}

function normalizeMedia(value: unknown): SocialDraftMediaAsset[] {
  if (!Array.isArray(value)) return [];
  const out: SocialDraftMediaAsset[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    const type = asString(row.type).toLowerCase();
    if (type !== "image" && type !== "video") continue;
    const url = asString(row.url);
    if (!url) continue;
    out.push({
      type,
      url,
      thumbnailUrl: asNullableString(row.thumbnailUrl) || undefined,
      title: asNullableString(row.title) || undefined,
    });
  }
  return out;
}

function normalizeApproval(value: unknown): SocialDraftRecord["approval"] {
  if (!value || typeof value !== "object") {
    return {
      decision: null,
      decisionSource: null,
      decidedAt: null,
      expiresAt: null,
      requestedAt: null,
    };
  }
  const row = value as Record<string, unknown>;
  const decisionRaw = asString(row.decision).toLowerCase();
  const decision = decisionRaw === "approve" || decisionRaw === "reject" ? decisionRaw : null;
  return {
    decision,
    decisionSource: asNullableString(row.decisionSource),
    decidedAt: asTimestampIso(row.decidedAt),
    expiresAt: asTimestampIso(row.expiresAt),
    requestedAt: asTimestampIso(row.requestedAt),
  };
}

function normalizeDispatch(value: unknown): SocialDraftRecord["dispatch"] {
  if (!value || typeof value !== "object") {
    return {
      status: null,
      queueDocId: null,
      queuedAt: null,
      externalTool: null,
      lastError: null,
    };
  }

  const row = value as Record<string, unknown>;
  const statusRaw = asString(row.status).toLowerCase();
  const status: SocialDraftDispatchState | null =
    statusRaw === "pending_external_tool" || statusRaw === "dispatched" || statusRaw === "failed"
      ? statusRaw
      : null;

  return {
    status,
    queueDocId: asNullableString(row.queueDocId),
    queuedAt: asTimestampIso(row.queuedAt),
    externalTool: asNullableString(row.externalTool),
    lastError: asNullableString(row.lastError),
  };
}

function toSocialDraftRecord(docId: string, data: SocialDraftDoc): SocialDraftRecord {
  return {
    draftId: asString(data.draftId) || docId,
    uid: asString(data.uid),
    businessKey: normalizeBusinessKey(data.businessKey),
    channels: normalizeChannels(data.channels),
    caption: asString(data.caption),
    media: normalizeMedia(data.media),
    status: normalizeStatus(data.status),
    source: asString(data.source),
    correlationId: asString(data.correlationId),
    publishAt: asTimestampIso(data.publishAt),
    createdAt: asTimestampIso(data.createdAt),
    updatedAt: asTimestampIso(data.updatedAt),
    dispatch: normalizeDispatch(data.dispatch),
    approval: normalizeApproval(data.approval),
  };
}

function generateApprovalToken(): string {
  return randomBytes(24).toString("hex");
}

export function hashSocialDraftApprovalToken(token: string): string {
  return createHash("sha256").update(String(token || "")).digest("hex");
}

function compareTokenHash(token: string, expectedHash: string): boolean {
  const tokenHash = hashSocialDraftApprovalToken(token);
  if (!tokenHash || !expectedHash) return false;
  try {
    const lhs = Buffer.from(tokenHash, "hex");
    const rhs = Buffer.from(expectedHash, "hex");
    if (!lhs.length || !rhs.length || lhs.length !== rhs.length) return false;
    return timingSafeEqual(lhs, rhs);
  } catch {
    return false;
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

export function buildSocialDraftDecisionUrl(args: {
  baseUrl: string;
  uid: string;
  draftId: string;
  token: string;
  decision: "approve" | "reject";
}): string {
  const normalizedBaseUrl = String(args.baseUrl || "").trim().replace(/\/+$/, "");
  if (!normalizedBaseUrl) {
    throw new ApiError(500, "Approval base URL is not configured");
  }
  const url = new URL(
    `${normalizedBaseUrl}/api/social/drafts/${encodeURIComponent(args.draftId)}/decision`
  );
  url.searchParams.set("uid", args.uid);
  url.searchParams.set("token", args.token);
  url.searchParams.set("decision", args.decision);
  url.searchParams.set("source", "google_space_link");
  return url.toString();
}

function summarizeChannels(channels: SocialDraftChannel[]): string {
  if (!channels.length) return "unspecified channels";
  return channels.join(", ");
}

export function buildGoogleChatSocialDraftCard(args: {
  draft: SocialDraftRecord;
  approveUrl: string;
  rejectUrl: string;
}) {
  const caption = escapeHtml(args.draft.caption || "");
  const trimmedCaption = caption.length > 1200 ? `${caption.slice(0, 1200)}...` : caption;
  const media = args.draft.media.slice(0, 6);
  const imageMedia = media.filter((asset) => asset.type === "image").slice(0, 2);
  const videoMedia = media.filter((asset) => asset.type === "video");

  const sections: Array<{ widgets: Array<Record<string, unknown>> }> = [
    {
      widgets: [
        {
          textParagraph: {
            text: `<b>Channels:</b> ${escapeHtml(summarizeChannels(args.draft.channels))}`,
          },
        },
        {
          textParagraph: {
            text: `<b>Caption Draft:</b><br>${trimmedCaption || "(empty)"}`,
          },
        },
      ],
    },
  ];

  if (imageMedia.length) {
    sections.push({
      widgets: imageMedia.map((asset, index) => ({
        image: {
          imageUrl: asset.url,
          altText: asset.title || `social draft image ${index + 1}`,
        },
      })),
    });
  }

  if (videoMedia.length) {
    sections.push({
      widgets: [
        {
          buttonList: {
            buttons: videoMedia.map((asset, index) => ({
              text: asset.title || `Preview Video ${index + 1}`,
              onClick: {
                openLink: {
                  url: asset.url,
                },
              },
            })),
          },
        },
      ],
    });
  }

  sections.push({
    widgets: [
      {
        buttonList: {
          buttons: [
            {
              text: "Approve Draft",
              onClick: {
                openLink: {
                  url: args.approveUrl,
                },
              },
            },
            {
              text: "Reject Draft",
              onClick: {
                openLink: {
                  url: args.rejectUrl,
                },
              },
            },
          ],
        },
      },
    ],
  });

  return {
    text: `Social draft ready for approval (${args.draft.businessKey.toUpperCase()})`,
    cardsV2: [
      {
        cardId: "social_draft_approval",
        card: {
          header: {
            title: "Social Draft Approval",
            subtitle: `${args.draft.businessKey.toUpperCase()} - ${summarizeChannels(args.draft.channels)}`,
          },
          sections,
        },
      },
    ],
  };
}

function resolveBusinessWebhookEnvKey(businessKey: "aicf" | "rng" | "rts"): string {
  return `SOCIAL_DRAFT_GOOGLE_CHAT_WEBHOOK_URL_${businessKey.toUpperCase()}`;
}

export function resolveSocialDraftWebhookUrl(businessKey: "aicf" | "rng" | "rts"): string | null {
  const businessSpecific = asString(process.env[resolveBusinessWebhookEnvKey(businessKey)]);
  if (businessSpecific) return businessSpecific;
  const defaultWebhook = asString(process.env.SOCIAL_DRAFT_GOOGLE_CHAT_WEBHOOK_URL);
  if (defaultWebhook) return defaultWebhook;
  return asString(process.env.GOOGLE_CHAT_MKT_SOCIAL_WEBHOOK_URL) || null;
}

export function buildSocialDispatchQueuePayload(args: {
  draft: SocialDraftRecord;
  correlationId: string;
  queuedAt: string;
}): SocialDraftExecutionQueuePayload {
  return {
    queueId: socialDispatchQueueDocId(args.draft.draftId),
    uid: args.draft.uid,
    draftId: args.draft.draftId,
    businessKey: args.draft.businessKey,
    channels: args.draft.channels,
    caption: args.draft.caption,
    media: args.draft.media,
    status: "pending_external_tool",
    externalTool: "SMAuto",
    source: "social_draft_approval",
    correlationId: args.correlationId,
    queuedAt: args.queuedAt,
  };
}

export async function createSocialDraft(args: CreateSocialDraftInput): Promise<CreateSocialDraftResult> {
  const now = new Date();
  const approvalTtlHours = Math.max(1, Math.min(24 * 14, args.approvalTtlHours ?? 168));
  const expiresAt = new Date(now.getTime() + approvalTtlHours * 60 * 60 * 1000);
  const approvalToken = generateApprovalToken();
  const approvalTokenHash = hashSocialDraftApprovalToken(approvalToken);
  const status: SocialDraftStatus = args.requestApproval ? "pending_approval" : "draft";

  const draftRef = socialDraftCollection(args.uid).doc();
  await draftRef.set(
    {
      draftId: draftRef.id,
      uid: args.uid,
      businessKey: args.businessKey,
      channels: args.channels,
      caption: args.caption,
      media: args.media,
      source: args.source,
      correlationId: args.correlationId,
      publishAt: args.publishAt || null,
      status,
      dispatch: {
        status: null,
        queueDocId: null,
        queuedAt: null,
        externalTool: null,
        lastError: null,
      },
      approval: {
        tokenHash: approvalTokenHash,
        decision: null,
        decisionSource: null,
        decidedAt: null,
        expiresAt: expiresAt.toISOString(),
        requestedAt: args.requestApproval ? now.toISOString() : null,
      },
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  const draft: SocialDraftRecord = {
    draftId: draftRef.id,
    uid: args.uid,
    businessKey: args.businessKey,
    channels: args.channels,
    caption: args.caption,
    media: args.media,
    source: args.source,
    correlationId: args.correlationId,
    publishAt: args.publishAt || null,
    status,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    dispatch: {
      status: null,
      queueDocId: null,
      queuedAt: null,
      externalTool: null,
      lastError: null,
    },
    approval: {
      decision: null,
      decisionSource: null,
      decidedAt: null,
      expiresAt: expiresAt.toISOString(),
      requestedAt: args.requestApproval ? now.toISOString() : null,
    },
  };

  args.log.info("social.draft.created", {
    uid: args.uid,
    draftId: draft.draftId,
    businessKey: draft.businessKey,
    channels: draft.channels,
    mediaCount: draft.media.length,
    requestApproval: args.requestApproval,
  });

  return { draft, approvalToken };
}

export async function postSocialDraftApprovalToGoogleChat(args: {
  webhookUrl: string;
  draft: SocialDraftRecord;
  approveUrl: string;
  rejectUrl: string;
  correlationId: string;
  log: Logger;
}): Promise<void> {
  const payload = buildGoogleChatSocialDraftCard({
    draft: args.draft,
    approveUrl: args.approveUrl,
    rejectUrl: args.rejectUrl,
  });

  const response = await fetch(args.webhookUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const message = await response.text();
    args.log.warn("social.draft.google_space_post_failed", {
      draftId: args.draft.draftId,
      status: response.status,
      body: message.slice(0, 600),
      correlationId: args.correlationId,
    });
    throw new ApiError(502, `Google Space approval post failed (status ${response.status})`);
  }

  await socialDraftCollection(args.draft.uid)
    .doc(args.draft.draftId)
    .set(
      {
        approval: {
          requestedAt: new Date().toISOString(),
          channel: "google_space_webhook",
        },
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

  args.log.info("social.draft.google_space_posted", {
    uid: args.draft.uid,
    draftId: args.draft.draftId,
    correlationId: args.correlationId,
  });
}

export async function createSocialDraftWithApprovalDispatch(args: CreateSocialDraftInput & {
  approvalBaseUrl: string;
}): Promise<SocialDraftApprovalDispatchResult> {
  const created = await createSocialDraft(args);

  if (!args.requestApproval) {
    return {
      draft: created.draft,
      approvalNotified: false,
      approvalUrls: { approve: null, reject: null },
      warning: null,
    };
  }

  const webhookUrl = resolveSocialDraftWebhookUrl(args.businessKey);
  if (!webhookUrl) {
    args.log.warn("social.draft.webhook_missing", {
      uid: args.uid,
      draftId: created.draft.draftId,
      businessKey: args.businessKey,
    });
    return {
      draft: created.draft,
      approvalNotified: false,
      approvalUrls: { approve: null, reject: null },
      warning: "Google Space webhook is not configured",
    };
  }

  const approveUrl = buildSocialDraftDecisionUrl({
    baseUrl: args.approvalBaseUrl,
    uid: args.uid,
    draftId: created.draft.draftId,
    token: created.approvalToken,
    decision: "approve",
  });
  const rejectUrl = buildSocialDraftDecisionUrl({
    baseUrl: args.approvalBaseUrl,
    uid: args.uid,
    draftId: created.draft.draftId,
    token: created.approvalToken,
    decision: "reject",
  });

  await postSocialDraftApprovalToGoogleChat({
    webhookUrl,
    draft: created.draft,
    approveUrl,
    rejectUrl,
    correlationId: args.correlationId,
    log: args.log,
  });

  return {
    draft: created.draft,
    approvalNotified: true,
    approvalUrls: { approve: approveUrl, reject: rejectUrl },
    warning: null,
  };
}

export async function listSocialDrafts(args: {
  uid: string;
  status?: SocialDraftStatus;
  limit?: number;
}): Promise<SocialDraftRecord[]> {
  const requestedLimit = Math.max(1, Math.min(50, args.limit ?? 20));
  const snap = await socialDraftCollection(args.uid)
    .orderBy("updatedAt", "desc")
    .limit(requestedLimit * 3)
    .get();

  const rows = snap.docs
    .map((doc) => toSocialDraftRecord(doc.id, (doc.data() || {}) as SocialDraftDoc))
    .filter((row) => {
      if (!args.status) return true;
      return row.status === args.status;
    })
    .slice(0, requestedLimit);

  return rows;
}

export async function decideSocialDraftWithToken(args: {
  uid: string;
  draftId: string;
  token: string;
  decision: "approve" | "reject";
  source: string;
  log: Logger;
  correlationId: string;
}): Promise<{
  draftId: string;
  status: SocialDraftStatus;
  decision: "approve" | "reject";
  replayed: boolean;
  queueDocId: string | null;
  queuedForExternalDispatch: boolean;
}> {
  const ref = socialDraftCollection(args.uid).doc(args.draftId);
  const queueRef = socialDispatchQueueCollection(args.uid).doc(socialDispatchQueueDocId(args.draftId));
  const nowIso = new Date().toISOString();
  let outcome: {
    draftId: string;
    status: SocialDraftStatus;
    decision: "approve" | "reject";
    replayed: boolean;
    queueDocId: string | null;
    queuedForExternalDispatch: boolean;
  } = {
    draftId: args.draftId,
    status: "draft",
    decision: args.decision,
    replayed: false,
    queueDocId: null,
    queuedForExternalDispatch: false,
  };

  await getAdminDb().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) {
      throw new ApiError(404, "Social draft not found");
    }

    const data = (snap.data() || {}) as Record<string, unknown>;
    const approval = (data.approval || {}) as Record<string, unknown>;
    const storedTokenHash = asString(approval.tokenHash);
    if (!storedTokenHash || !compareTokenHash(args.token, storedTokenHash)) {
      throw new ApiError(403, "Invalid approval token");
    }

    const expiresAt = asTimestampIso(approval.expiresAt);
    if (expiresAt) {
      const expiresMs = Date.parse(expiresAt);
      if (Number.isFinite(expiresMs) && expiresMs < Date.now()) {
        throw new ApiError(410, "Approval link has expired");
      }
    }

    const existingDecision = asString(approval.decision).toLowerCase();
    if (existingDecision === "approve" || existingDecision === "reject") {
      if (existingDecision !== args.decision) {
        throw new ApiError(409, "Draft already has a final decision");
      }

      const existingDispatch = normalizeDispatch(data.dispatch);
      outcome = {
        draftId: args.draftId,
        status: normalizeStatus(data.status),
        decision: args.decision,
        replayed: true,
        queueDocId: existingDispatch.queueDocId,
        queuedForExternalDispatch: Boolean(existingDispatch.queueDocId),
      };
      return;
    }

    const status: SocialDraftStatus = args.decision === "approve" ? "approved" : "rejected";
    const draftRecord = toSocialDraftRecord(args.draftId, data as SocialDraftDoc);
    let queueDocId: string | null = null;
    let queuedForExternalDispatch = false;

    if (args.decision === "approve") {
      const queuePayload = buildSocialDispatchQueuePayload({
        draft: {
          ...draftRecord,
          status,
          updatedAt: nowIso,
          approval: {
            ...draftRecord.approval,
            decision: args.decision,
            decisionSource: args.source || "google_space_link",
            decidedAt: nowIso,
          },
        },
        correlationId: args.correlationId,
        queuedAt: nowIso,
      });
      queueDocId = queuePayload.queueId;
      queuedForExternalDispatch = true;
      tx.set(
        queueRef,
        {
          ...queuePayload,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
          attempts: 0,
          lastAttemptAt: null,
          lastError: null,
        },
        { merge: true }
      );
    }

    tx.set(
      ref,
      {
        status,
        approval: {
          decision: args.decision,
          decisionSource: args.source || "google_space_link",
          decidedAt: nowIso,
        },
        dispatch: {
          status: queuedForExternalDispatch ? "pending_external_tool" : null,
          queueDocId,
          queuedAt: queuedForExternalDispatch ? nowIso : null,
          externalTool: queuedForExternalDispatch ? "SMAuto" : null,
          lastError: null,
        },
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    outcome = {
      draftId: args.draftId,
      status,
      decision: args.decision,
      replayed: false,
      queueDocId,
      queuedForExternalDispatch,
    };
  });

  args.log.info("social.draft.decision_recorded", {
    uid: args.uid,
    draftId: args.draftId,
    decision: args.decision,
    replayed: outcome.replayed,
    queueDocId: outcome.queueDocId,
    queuedForExternalDispatch: outcome.queuedForExternalDispatch,
    correlationId: args.correlationId,
  });

  return outcome;
}
