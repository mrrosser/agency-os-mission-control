import "server-only";

import { GoogleAuth } from "google-auth-library";
import { FieldValue } from "firebase-admin/firestore";
import { ApiError } from "@/lib/api/handler";
import { getAdminDb } from "@/lib/firebase-admin";
import type { Logger } from "@/lib/logging";
import type { SocialDraftChannel, SocialDraftMediaAsset } from "@/lib/social/drafts";

type SocialDispatchQueueStatus = "pending_external_tool" | "dispatched" | "failed";
type SmAutoAuthMode = "none" | "api_key" | "id_token";

const DEFAULT_MAX_TASKS = 10;
const MAX_TASKS = 50;
const DEFAULT_LEASE_SECONDS = 120;
const googleAuth = new GoogleAuth();

interface SocialDispatchQueueDoc {
  queueId?: unknown;
  uid?: unknown;
  draftId?: unknown;
  businessKey?: unknown;
  channels?: unknown;
  caption?: unknown;
  media?: unknown;
  source?: unknown;
  status?: unknown;
  correlationId?: unknown;
  queuedAt?: unknown;
  attempts?: unknown;
}

export interface SocialDispatchQueueTask {
  queueId: string;
  uid: string;
  draftId: string;
  businessKey: "aicf" | "rng" | "rts";
  channels: SocialDraftChannel[];
  caption: string;
  media: SocialDraftMediaAsset[];
  source: string;
  status: SocialDispatchQueueStatus;
  correlationId: string;
  queuedAt: string | null;
}

export interface SmAutoDispatchResult {
  transport: "mcp_tools_call" | "webhook";
  status: number;
  responseSnippet: string | null;
}

export interface SocialDispatchWorkerResult {
  uid: string;
  dryRun: boolean;
  retryFailed: boolean;
  scanned: number;
  attempted: number;
  dispatched: number;
  failed: number;
  skipped: number;
  items: Array<{
    queueId: string;
    draftId: string | null;
    status: "dispatched" | "failed" | "skipped" | "pending_dry_run";
    transport: "mcp_tools_call" | "webhook" | null;
    error: string | null;
  }>;
}

interface RunSocialDispatchWorkerArgs {
  uid: string;
  maxTasks?: number;
  retryFailed?: boolean;
  dryRun?: boolean;
  correlationId: string;
  log: Logger;
}

interface DispatchAttemptArgs {
  task: SocialDispatchQueueTask;
  correlationId: string;
  log: Logger;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asInt(value: unknown, fallback = 0): number {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = asInt(value, fallback);
  return Math.min(max, Math.max(min, parsed));
}

function asIsoTimestamp(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  const candidate = value as { toDate?: () => Date };
  if (typeof candidate.toDate === "function") {
    try {
      const parsed = candidate.toDate();
      return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
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

function normalizeStatus(value: unknown): SocialDispatchQueueStatus {
  const normalized = asString(value).toLowerCase();
  if (normalized === "pending_external_tool") return "pending_external_tool";
  if (normalized === "dispatched") return "dispatched";
  if (normalized === "failed") return "failed";
  return "pending_external_tool";
}

function normalizeChannels(value: unknown): SocialDraftChannel[] {
  if (!Array.isArray(value)) return [];
  const allowed = new Set<SocialDraftChannel>([
    "instagram_story",
    "instagram_post",
    "facebook_story",
    "facebook_post",
  ]);
  const channels: SocialDraftChannel[] = [];
  for (const raw of value) {
    const candidate = asString(raw) as SocialDraftChannel;
    if (!allowed.has(candidate)) continue;
    if (!channels.includes(candidate)) channels.push(candidate);
  }
  return channels;
}

function normalizeMedia(value: unknown): SocialDraftMediaAsset[] {
  if (!Array.isArray(value)) return [];
  const media: SocialDraftMediaAsset[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    const type = asString(row.type).toLowerCase();
    if (type !== "image" && type !== "video") continue;
    const url = asString(row.url);
    if (!url) continue;
    media.push({
      type,
      url,
      thumbnailUrl: asString(row.thumbnailUrl) || undefined,
      title: asString(row.title) || undefined,
    });
  }
  return media;
}

function toQueueTask(docId: string, uid: string, data: SocialDispatchQueueDoc): SocialDispatchQueueTask | null {
  const draftId = asString(data.draftId);
  if (!draftId) return null;

  return {
    queueId: asString(data.queueId) || docId,
    uid,
    draftId,
    businessKey: normalizeBusinessKey(data.businessKey),
    channels: normalizeChannels(data.channels),
    caption: asString(data.caption),
    media: normalizeMedia(data.media),
    source: asString(data.source) || "social_draft_approval",
    status: normalizeStatus(data.status),
    correlationId: asString(data.correlationId),
    queuedAt: asIsoTimestamp(data.queuedAt),
  };
}

function socialDispatchQueueCollection(uid: string) {
  return getAdminDb().collection("identities").doc(uid).collection("social_dispatch_queue");
}

function socialDraftCollection(uid: string) {
  return getAdminDb().collection("identities").doc(uid).collection("social_drafts");
}

function readSmAutoEndpoint(): string {
  const raw = asString(process.env.SMAUTO_MCP_SERVER_URL);
  if (!raw) {
    throw new ApiError(503, "SMAUTO_MCP_SERVER_URL is not configured");
  }
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new ApiError(503, "SMAUTO_MCP_SERVER_URL is invalid");
  }
  const protocol = parsed.protocol.toLowerCase();
  if (protocol !== "http:" && protocol !== "https:") {
    throw new ApiError(503, "SMAUTO_MCP_SERVER_URL must use http(s)");
  }
  return parsed.toString();
}

function readSmAutoAuthMode(): SmAutoAuthMode {
  const raw = asString(process.env.SMAUTO_MCP_AUTH_MODE || "none").toLowerCase();
  if (!raw || raw === "none") return "none";
  if (raw === "api_key") return "api_key";
  if (raw === "id_token") return "id_token";
  throw new ApiError(503, "SMAUTO_MCP_AUTH_MODE must be one of: none, api_key, id_token");
}

function readBoolEnv(name: string, fallback: boolean): boolean {
  const normalized = asString(process.env[name] || "").toLowerCase();
  if (!normalized) return fallback;
  if (normalized === "true" || normalized === "1" || normalized === "yes") return true;
  if (normalized === "false" || normalized === "0" || normalized === "no") return false;
  return fallback;
}

function readSocialDispatchToolName(): string {
  return asString(process.env.SMAUTO_MCP_SOCIAL_DISPATCH_TOOL) || "social.dispatch.enqueue";
}

async function buildSmAutoAuthHeaders(serverUrl: string): Promise<Record<string, string>> {
  const mode = readSmAutoAuthMode();
  if (mode === "none") return {};

  if (mode === "api_key") {
    const apiKey = asString(process.env.SMAUTO_MCP_API_KEY);
    if (!apiKey) {
      throw new ApiError(503, "SMAUTO_MCP_AUTH_MODE=api_key requires SMAUTO_MCP_API_KEY");
    }
    return {
      Authorization: `Bearer ${apiKey}`,
      "x-api-key": apiKey,
    };
  }

  const audience = asString(process.env.SMAUTO_MCP_ID_TOKEN_AUDIENCE);
  if (!audience) {
    throw new ApiError(503, "SMAUTO_MCP_AUTH_MODE=id_token requires SMAUTO_MCP_ID_TOKEN_AUDIENCE");
  }
  try {
    const client = await googleAuth.getIdTokenClient(audience);
    const headers = (await client.getRequestHeaders(serverUrl)) as Record<string, string | undefined>;
    const authHeader = asString(headers.Authorization || headers.authorization);
    if (!authHeader) {
      throw new Error("Missing authorization header from id-token client");
    }
    return { Authorization: authHeader };
  } catch (error) {
    throw new ApiError(503, "Unable to mint SMAuto id token", {
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

function buildDispatchPayload(task: SocialDispatchQueueTask, correlationId: string) {
  return {
    taskType: "social_draft_dispatch",
    source: "mission_control",
    queueId: task.queueId,
    uid: task.uid,
    draftId: task.draftId,
    businessKey: task.businessKey,
    channels: task.channels,
    caption: task.caption,
    media: task.media,
    queuedAt: task.queuedAt,
    correlationId,
  };
}

export function buildSmAutoToolCallRequest(task: SocialDispatchQueueTask, correlationId: string) {
  const payload = buildDispatchPayload(task, correlationId);
  return {
    jsonrpc: "2.0",
    id: `social-dispatch-${task.queueId}`,
    method: "tools/call",
    params: {
      name: readSocialDispatchToolName(),
      arguments: payload,
    },
  };
}

function snippet(value: string, maxLength = 800): string | null {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return null;
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized;
}

async function readResponseBody(response: Response): Promise<{ raw: string; snippet: string | null }> {
  const raw = await response.text().catch(() => "");
  return { raw, snippet: snippet(raw) };
}

function safeParseJson(value: string): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function shouldFallbackToWebhook(status: number): boolean {
  return status === 400 || status === 404 || status === 405 || status === 415 || status === 422;
}

export async function dispatchSocialQueueItemToSmAuto(args: DispatchAttemptArgs): Promise<SmAutoDispatchResult> {
  const endpoint = readSmAutoEndpoint();
  const authHeaders = await buildSmAutoAuthHeaders(endpoint);
  const payload = buildDispatchPayload(args.task, args.correlationId);
  const mcpRequest = buildSmAutoToolCallRequest(args.task, args.correlationId);
  const webhookFallbackEnabled = readBoolEnv("SMAUTO_MCP_WEBHOOK_FALLBACK_ENABLED", true);

  const baseHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Correlation-Id": args.correlationId,
    "X-Idempotency-Key": args.task.queueId,
    ...authHeaders,
  };

  const mcpResponse = await fetch(endpoint, {
    method: "POST",
    headers: baseHeaders,
    body: JSON.stringify(mcpRequest),
  });

  const mcpBody = await readResponseBody(mcpResponse);
  if (mcpResponse.ok) {
    const parsed = safeParseJson(mcpBody.raw);
    if (parsed && typeof parsed === "object" && "error" in (parsed as Record<string, unknown>)) {
      const errorPayload = (parsed as Record<string, unknown>).error;
      throw new ApiError(502, "SMAuto MCP tools/call returned an error payload", {
        status: mcpResponse.status,
        transport: "mcp_tools_call",
        error: errorPayload,
      });
    }
    args.log.info("social.dispatch.smauto_call_ok", {
      queueId: args.task.queueId,
      draftId: args.task.draftId,
      transport: "mcp_tools_call",
      status: mcpResponse.status,
      correlationId: args.correlationId,
    });
    return {
      transport: "mcp_tools_call",
      status: mcpResponse.status,
      responseSnippet: mcpBody.snippet,
    };
  }

  if (!webhookFallbackEnabled || !shouldFallbackToWebhook(mcpResponse.status)) {
    throw new ApiError(502, "SMAuto dispatch failed", {
      status: mcpResponse.status,
      transport: "mcp_tools_call",
      body: mcpBody.snippet,
    });
  }

  args.log.warn("social.dispatch.smauto_mcp_fallback", {
    queueId: args.task.queueId,
    draftId: args.task.draftId,
    status: mcpResponse.status,
    correlationId: args.correlationId,
  });

  const webhookResponse = await fetch(endpoint, {
    method: "POST",
    headers: baseHeaders,
    body: JSON.stringify(payload),
  });
  const webhookBody = await readResponseBody(webhookResponse);

  if (!webhookResponse.ok) {
    throw new ApiError(502, "SMAuto webhook fallback dispatch failed", {
      status: webhookResponse.status,
      transport: "webhook",
      body: webhookBody.snippet,
    });
  }

  args.log.info("social.dispatch.smauto_call_ok", {
    queueId: args.task.queueId,
    draftId: args.task.draftId,
    transport: "webhook",
    status: webhookResponse.status,
    correlationId: args.correlationId,
  });

  return {
    transport: "webhook",
    status: webhookResponse.status,
    responseSnippet: webhookBody.snippet,
  };
}

async function claimDispatchTask(args: {
  uid: string;
  queueId: string;
  retryFailed: boolean;
  correlationId: string;
}): Promise<
  | { state: "claimed"; task: SocialDispatchQueueTask; attempt: number }
  | { state: "skip" }
  | { state: "invalid"; reason: string }
> {
  const queueRef = socialDispatchQueueCollection(args.uid).doc(args.queueId);
  const nowMs = Date.now();
  const leaseUntil = new Date(nowMs + DEFAULT_LEASE_SECONDS * 1000).toISOString();

  return getAdminDb().runTransaction(async (tx) => {
    const snap = await tx.get(queueRef);
    if (!snap.exists) return { state: "skip" as const };
    const data = (snap.data() || {}) as SocialDispatchQueueDoc;
    const status = normalizeStatus(data.status);
    if (status !== "pending_external_tool" && !(args.retryFailed && status === "failed")) {
      return { state: "skip" as const };
    }

    const leaseUntilMs = Date.parse(asString((data as Record<string, unknown>).leaseUntil));
    if (Number.isFinite(leaseUntilMs) && leaseUntilMs > nowMs) {
      return { state: "skip" as const };
    }

    const task = toQueueTask(snap.id, args.uid, data);
    if (!task) {
      tx.set(
        queueRef,
        {
          status: "failed",
          leaseUntil: null,
          lastError: "invalid_queue_payload",
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      return { state: "invalid" as const, reason: "invalid_queue_payload" };
    }

    const attempt = clampInt(data.attempts, 0, 0, 999) + 1;
    tx.set(
      queueRef,
      {
        status: "pending_external_tool",
        attempts: attempt,
        lastAttemptAt: FieldValue.serverTimestamp(),
        leaseUntil,
        leaseOwner: args.correlationId,
        lastError: null,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    return { state: "claimed" as const, task, attempt };
  });
}

async function setDraftDispatchState(args: {
  uid: string;
  draftId: string;
  queueId: string;
  status: "dispatched" | "failed";
  error: string | null;
  transport: "mcp_tools_call" | "webhook" | null;
  log: Logger;
  correlationId: string;
}): Promise<void> {
  const draftRef = socialDraftCollection(args.uid).doc(args.draftId);
  const snap = await draftRef.get();
  if (!snap.exists) {
    args.log.warn("social.dispatch.draft_missing", {
      uid: args.uid,
      draftId: args.draftId,
      queueId: args.queueId,
      correlationId: args.correlationId,
    });
    return;
  }

  await draftRef.set(
    {
      dispatch: {
        status: args.status,
        queueDocId: args.queueId,
        externalTool: "SMAuto",
        transport: args.transport,
        lastError: args.error,
        updatedAt: new Date().toISOString(),
      },
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
}

async function markDispatchSucceeded(args: {
  uid: string;
  task: SocialDispatchQueueTask;
  attempt: number;
  result: SmAutoDispatchResult;
  log: Logger;
  correlationId: string;
}): Promise<void> {
  await socialDispatchQueueCollection(args.uid)
    .doc(args.task.queueId)
    .set(
      {
        status: "dispatched",
        attempts: args.attempt,
        dispatchedAt: FieldValue.serverTimestamp(),
        leaseUntil: null,
        leaseOwner: null,
        lastError: null,
        externalTool: "SMAuto",
        dispatchTransport: args.result.transport,
        responseStatus: args.result.status,
        responseSnippet: args.result.responseSnippet,
        correlationId: args.correlationId,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

  await setDraftDispatchState({
    uid: args.uid,
    draftId: args.task.draftId,
    queueId: args.task.queueId,
    status: "dispatched",
    error: null,
    transport: args.result.transport,
    log: args.log,
    correlationId: args.correlationId,
  });
}

async function markDispatchFailed(args: {
  uid: string;
  task: SocialDispatchQueueTask;
  attempt: number;
  error: string;
  log: Logger;
  correlationId: string;
}): Promise<void> {
  await socialDispatchQueueCollection(args.uid)
    .doc(args.task.queueId)
    .set(
      {
        status: "failed",
        attempts: args.attempt,
        leaseUntil: null,
        leaseOwner: null,
        lastError: args.error,
        failedAt: FieldValue.serverTimestamp(),
        correlationId: args.correlationId,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

  await setDraftDispatchState({
    uid: args.uid,
    draftId: args.task.draftId,
    queueId: args.task.queueId,
    status: "failed",
    error: args.error,
    transport: null,
    log: args.log,
    correlationId: args.correlationId,
  });
}

export async function runSocialDispatchWorker(
  args: RunSocialDispatchWorkerArgs
): Promise<SocialDispatchWorkerResult> {
  const maxTasks = clampInt(args.maxTasks, DEFAULT_MAX_TASKS, 1, MAX_TASKS);
  const retryFailed = Boolean(args.retryFailed);
  const dryRun = Boolean(args.dryRun);
  const queueRoot = socialDispatchQueueCollection(args.uid);

  const queueQuery = retryFailed
    ? queueRoot.where("status", "in", ["pending_external_tool", "failed"])
    : queueRoot.where("status", "==", "pending_external_tool");

  const snap = await queueQuery.limit(maxTasks).get();

  const result: SocialDispatchWorkerResult = {
    uid: args.uid,
    dryRun,
    retryFailed,
    scanned: snap.size,
    attempted: 0,
    dispatched: 0,
    failed: 0,
    skipped: 0,
    items: [],
  };

  args.log.info("social.dispatch.worker.started", {
    uid: args.uid,
    dryRun,
    retryFailed,
    scanned: snap.size,
    maxTasks,
    correlationId: args.correlationId,
  });

  for (const doc of snap.docs) {
    const rawTask = toQueueTask(doc.id, args.uid, (doc.data() || {}) as SocialDispatchQueueDoc);
    if (!rawTask) {
      result.failed += 1;
      result.items.push({
        queueId: doc.id,
        draftId: null,
        status: "failed",
        transport: null,
        error: "invalid_queue_payload",
      });
      if (!dryRun) {
        await socialDispatchQueueCollection(args.uid)
          .doc(doc.id)
          .set(
            {
              status: "failed",
              lastError: "invalid_queue_payload",
              updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true }
          );
      }
      continue;
    }

    if (dryRun) {
      result.attempted += 1;
      result.items.push({
        queueId: rawTask.queueId,
        draftId: rawTask.draftId,
        status: "pending_dry_run",
        transport: null,
        error: null,
      });
      continue;
    }

    const claim = await claimDispatchTask({
      uid: args.uid,
      queueId: rawTask.queueId,
      retryFailed,
      correlationId: args.correlationId,
    });
    if (claim.state === "skip") {
      result.skipped += 1;
      result.items.push({
        queueId: rawTask.queueId,
        draftId: rawTask.draftId,
        status: "skipped",
        transport: null,
        error: null,
      });
      continue;
    }
    if (claim.state === "invalid") {
      result.failed += 1;
      result.items.push({
        queueId: rawTask.queueId,
        draftId: rawTask.draftId,
        status: "failed",
        transport: null,
        error: claim.reason,
      });
      continue;
    }

    result.attempted += 1;
    try {
      const dispatchResult = await dispatchSocialQueueItemToSmAuto({
        task: claim.task,
        correlationId: args.correlationId,
        log: args.log,
      });
      await markDispatchSucceeded({
        uid: args.uid,
        task: claim.task,
        attempt: claim.attempt,
        result: dispatchResult,
        log: args.log,
        correlationId: args.correlationId,
      });
      result.dispatched += 1;
      result.items.push({
        queueId: claim.task.queueId,
        draftId: claim.task.draftId,
        status: "dispatched",
        transport: dispatchResult.transport,
        error: null,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await markDispatchFailed({
        uid: args.uid,
        task: claim.task,
        attempt: claim.attempt,
        error: message,
        log: args.log,
        correlationId: args.correlationId,
      });
      result.failed += 1;
      result.items.push({
        queueId: claim.task.queueId,
        draftId: claim.task.draftId,
        status: "failed",
        transport: null,
        error: message,
      });
      args.log.warn("social.dispatch.worker.item_failed", {
        uid: args.uid,
        queueId: claim.task.queueId,
        draftId: claim.task.draftId,
        message,
        correlationId: args.correlationId,
      });
    }
  }

  args.log.info("social.dispatch.worker.completed", {
    uid: args.uid,
    dryRun,
    retryFailed,
    scanned: result.scanned,
    attempted: result.attempted,
    dispatched: result.dispatched,
    failed: result.failed,
    skipped: result.skipped,
    correlationId: args.correlationId,
  });

  return result;
}
