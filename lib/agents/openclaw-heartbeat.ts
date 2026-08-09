import "server-only";

import { FieldValue } from "firebase-admin/firestore";
import { OAuth2Client } from "google-auth-library";
import { z } from "zod";
import { ApiError } from "@/lib/api/handler";
import { getAdminDb } from "@/lib/firebase-admin";
import type { Logger } from "@/lib/logging";

const HEARTBEAT_COLLECTION = "runtime_heartbeats";
const DEFAULT_RUNTIME_ID = "openclaw-gateway";
const DEFAULT_STALE_AFTER_SECONDS = 15 * 60;
const DEFAULT_MAX_SENT_AGE_SECONDS = 10 * 60;
const DEFAULT_MAX_FUTURE_SKEW_SECONDS = 60;
const GOOGLE_OIDC_ISSUERS = new Set(["https://accounts.google.com", "accounts.google.com"]);
const googleOidcClient = new OAuth2Client();

const RuntimeServiceStateSchema = z.enum(["active", "inactive", "failed", "unknown"]);
const RuntimeIdSchema = z.string().trim().regex(/^[a-z0-9][a-z0-9_-]{2,63}$/);

export const OpenClawHeartbeatEnvelopeSchema = z
  .object({
    schema_version: z.literal(1),
    runtime_id: RuntimeIdSchema,
    heartbeat_id: z.string().trim().regex(/^[A-Za-z0-9._:-]{8,200}$/),
    sequence: z.number().int().nonnegative().safe(),
    sent_at: z.string().datetime({ offset: true }),
    source_commit: z.string().trim().regex(/^[0-9a-f]{40}$/),
    correlation_id: z.string().trim().regex(/^[A-Za-z0-9._:-]{8,128}$/),
    services: z
      .object({
        openclaw_gateway: RuntimeServiceStateSchema,
        voice_mcp_rt: RuntimeServiceStateSchema,
        voice_mcp_rosser: RuntimeServiceStateSchema,
        voice_mcp_router: RuntimeServiceStateSchema,
        paperclip_api: RuntimeServiceStateSchema.optional(),
        paperclip_bridge: RuntimeServiceStateSchema.optional(),
      })
      .strict(),
  })
  .strict();

export type OpenClawHeartbeatEnvelope = z.infer<typeof OpenClawHeartbeatEnvelopeSchema>;
export type OpenClawRuntimeServiceState = z.infer<typeof RuntimeServiceStateSchema>;

export interface OpenClawOidcIdentity {
  email: string;
  subject: string;
}

export interface OpenClawHeartbeatStatus {
  state: "operational" | "degraded" | "offline";
  reason: "fresh" | "stale" | "service_unhealthy" | "missing" | "store_unavailable" | "invalid_receipt";
  runtimeId: string;
  receivedAt: string | null;
  sentAt: string | null;
  ageSeconds: number | null;
  sourceCommit: string | null;
  services: Record<string, OpenClawRuntimeServiceState>;
}

interface StoredOpenClawHeartbeat {
  schemaVersion: 1;
  runtimeId: string;
  heartbeatId: string;
  sequence: number;
  sentAt: string;
  sourceCommit: string;
  services: Record<string, OpenClawRuntimeServiceState>;
  publisherEmail: string;
  publisherSubject: string;
  envelopeCorrelationId: string;
  requestCorrelationId: string;
  receivedAt: unknown;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function parseCsv(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean)
    )
  );
}

function readPositiveInteger(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function readRuntimeId(): string {
  const configured = asString(process.env.OPENCLAW_HEARTBEAT_RUNTIME_ID);
  const parsed = RuntimeIdSchema.safeParse(configured || DEFAULT_RUNTIME_ID);
  if (!parsed.success) throw new ApiError(503, "OpenClaw heartbeat runtime ID is invalid.");
  return parsed.data;
}

function readBearerToken(request: Request): string {
  const authorization = request.headers.get("authorization") || "";
  if (!authorization.toLowerCase().startsWith("bearer ")) return "";
  return authorization.slice(7).trim();
}

function readRequiredOidcConfiguration(): { audiences: string[]; serviceAccounts: string[] } {
  const audiences = parseCsv(asString(process.env.OPENCLAW_HEARTBEAT_OIDC_AUDIENCES));
  const serviceAccounts = parseCsv(
    asString(process.env.OPENCLAW_HEARTBEAT_OIDC_SERVICE_ACCOUNT_EMAILS)
  ).map((email) => email.toLowerCase());

  if (audiences.length === 0 || serviceAccounts.length === 0) {
    throw new ApiError(
      503,
      "OpenClaw heartbeat OIDC is not configured. Set audiences and service-account allowlist."
    );
  }

  for (const audience of audiences) {
    let url: URL;
    try {
      url = new URL(audience);
    } catch {
      throw new ApiError(503, "OpenClaw heartbeat OIDC audience must be a valid URL.");
    }
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      audience !== url.origin
    ) {
      throw new ApiError(503, "OpenClaw heartbeat OIDC audience must be an HTTPS origin.");
    }
  }

  return { audiences, serviceAccounts };
}

function toIso(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.valueOf()) ? null : value.toISOString();
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.valueOf()) ? null : parsed.toISOString();
  }
  const candidate = value as { toDate?: () => Date };
  if (typeof candidate.toDate === "function") {
    try {
      const date = candidate.toDate();
      return Number.isNaN(date.valueOf()) ? null : date.toISOString();
    } catch {
      return null;
    }
  }
  return null;
}

function normalizeStoredServices(value: unknown): Record<string, OpenClawRuntimeServiceState> {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).flatMap(([key, state]) => {
      const parsed = RuntimeServiceStateSchema.safeParse(state);
      return parsed.success ? [[key, parsed.data]] : [];
    })
  );
}

function validateEnvelopeFreshness(envelope: OpenClawHeartbeatEnvelope, nowMs: number): void {
  const sentAtMs = Date.parse(envelope.sent_at);
  if (!Number.isFinite(sentAtMs)) throw new ApiError(400, "Invalid heartbeat sent_at.");

  const maxAgeMs =
    readPositiveInteger("OPENCLAW_HEARTBEAT_MAX_SENT_AGE_SECONDS", DEFAULT_MAX_SENT_AGE_SECONDS) *
    1000;
  const futureSkewMs =
    readPositiveInteger(
      "OPENCLAW_HEARTBEAT_MAX_FUTURE_SKEW_SECONDS",
      DEFAULT_MAX_FUTURE_SKEW_SECONDS
    ) * 1000;

  if (nowMs - sentAtMs > maxAgeMs) {
    throw new ApiError(409, "Heartbeat envelope is too old.");
  }
  if (sentAtMs - nowMs > futureSkewMs) {
    throw new ApiError(409, "Heartbeat envelope is too far in the future.");
  }
  if (Math.abs(envelope.sequence - sentAtMs) > futureSkewMs) {
    throw new ApiError(409, "Heartbeat sequence does not match sent_at.");
  }
}

export async function authorizeOpenClawHeartbeat(
  request: Request,
  log?: Logger
): Promise<OpenClawOidcIdentity> {
  const { audiences, serviceAccounts } = readRequiredOidcConfiguration();
  const token = readBearerToken(request);
  if (!token) throw new ApiError(401, "Missing Google OIDC bearer token.");

  try {
    const ticket = await googleOidcClient.verifyIdToken({
      idToken: token,
      audience: audiences,
    });
    const payload = ticket.getPayload();
    if (!payload) throw new Error("Google OIDC token payload is missing.");

    const issuer = asString(payload.iss);
    const email = asString(payload.email).toLowerCase();
    const subject = asString(payload.sub);
    if (!GOOGLE_OIDC_ISSUERS.has(issuer)) throw new Error("Google OIDC issuer is not allowed.");
    if (payload.email_verified !== true) throw new Error("Google OIDC email is not verified.");
    if (!subject) throw new Error("Google OIDC subject is missing.");
    if (!email || !serviceAccounts.includes(email)) {
      log?.warn("agents.openclaw_heartbeat.oidc_email_not_allowed", {
        publisherEmail: email || null,
      });
      throw new ApiError(403, "OpenClaw heartbeat publisher is not allowed.");
    }

    return { email, subject };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    log?.warn("agents.openclaw_heartbeat.oidc_invalid", {
      message: error instanceof Error ? error.message : String(error),
    });
    throw new ApiError(403, "Invalid Google OIDC token.");
  }
}

export async function recordOpenClawHeartbeat(args: {
  envelope: OpenClawHeartbeatEnvelope;
  identity: OpenClawOidcIdentity;
  requestCorrelationId: string;
  log?: Logger;
  nowMs?: number;
}): Promise<{ replayed: boolean; runtimeId: string }> {
  const runtimeId = readRuntimeId();
  if (args.envelope.runtime_id !== runtimeId) {
    throw new ApiError(403, "Heartbeat runtime_id is not allowed.");
  }

  validateEnvelopeFreshness(args.envelope, args.nowMs ?? Date.now());

  const db = getAdminDb();
  const ref = db.collection(HEARTBEAT_COLLECTION).doc(runtimeId);
  let replayed = false;

  await db.runTransaction(async (transaction) => {
    const currentSnapshot = await transaction.get(ref);
    const current = currentSnapshot.exists
      ? (currentSnapshot.data() as Partial<StoredOpenClawHeartbeat> | undefined)
      : undefined;

    if (current?.heartbeatId === args.envelope.heartbeat_id) {
      replayed = true;
      return;
    }

    const currentSequence = Number(current?.sequence);
    if (Number.isSafeInteger(currentSequence) && args.envelope.sequence <= currentSequence) {
      throw new ApiError(409, "Heartbeat sequence is not newer than the stored receipt.");
    }

    transaction.set(
      ref,
      {
        schemaVersion: 1,
        runtimeId,
        heartbeatId: args.envelope.heartbeat_id,
        sequence: args.envelope.sequence,
        sentAt: args.envelope.sent_at,
        sourceCommit: args.envelope.source_commit,
        services: args.envelope.services,
        publisherEmail: args.identity.email,
        publisherSubject: args.identity.subject,
        envelopeCorrelationId: args.envelope.correlation_id,
        requestCorrelationId: args.requestCorrelationId,
        receivedAt: FieldValue.serverTimestamp(),
      } satisfies StoredOpenClawHeartbeat,
      { merge: false }
    );
  });

  args.log?.info("agents.openclaw_heartbeat.receipt_recorded", {
    runtimeId,
    publisherEmail: args.identity.email,
    heartbeatId: args.envelope.heartbeat_id,
    envelopeCorrelationId: args.envelope.correlation_id,
    replayed,
  });

  return { replayed, runtimeId };
}

export function deriveOpenClawHeartbeatStatus(
  data: Record<string, unknown> | null,
  options?: { nowMs?: number; runtimeId?: string; staleAfterSeconds?: number }
): OpenClawHeartbeatStatus {
  const runtimeId = options?.runtimeId || readRuntimeId();
  if (!data) {
    return {
      state: "offline",
      reason: "missing",
      runtimeId,
      receivedAt: null,
      sentAt: null,
      ageSeconds: null,
      sourceCommit: null,
      services: {},
    };
  }

  const receivedAt = toIso(data.receivedAt);
  const sentAt = toIso(data.sentAt);
  const sourceCommit = asString(data.sourceCommit) || null;
  const services = normalizeStoredServices(data.services);
  if (!receivedAt) {
    return {
      state: "offline",
      reason: "invalid_receipt",
      runtimeId,
      receivedAt: null,
      sentAt,
      ageSeconds: null,
      sourceCommit,
      services,
    };
  }

  const nowMs = options?.nowMs ?? Date.now();
  const receivedAtMs = Date.parse(receivedAt);
  const ageSeconds = Math.max(0, Math.floor((nowMs - receivedAtMs) / 1000));
  const staleAfterSeconds =
    options?.staleAfterSeconds ??
    readPositiveInteger("OPENCLAW_HEARTBEAT_STALE_AFTER_SECONDS", DEFAULT_STALE_AFTER_SECONDS);
  if (ageSeconds > staleAfterSeconds) {
    return {
      state: "degraded",
      reason: "stale",
      runtimeId,
      receivedAt,
      sentAt,
      ageSeconds,
      sourceCommit,
      services,
    };
  }

  const requiredServiceIds = [
    "openclaw_gateway",
    "voice_mcp_rt",
    "voice_mcp_rosser",
    "voice_mcp_router",
  ];
  if ("paperclip_api" in services || "paperclip_bridge" in services) {
    requiredServiceIds.push("paperclip_api", "paperclip_bridge");
  }
  if (requiredServiceIds.some((serviceId) => services[serviceId] !== "active")) {
    return {
      state: "degraded",
      reason: "service_unhealthy",
      runtimeId,
      receivedAt,
      sentAt,
      ageSeconds,
      sourceCommit,
      services,
    };
  }

  return {
    state: "operational",
    reason: "fresh",
    runtimeId,
    receivedAt,
    sentAt,
    ageSeconds,
    sourceCommit,
    services,
  };
}

export async function readOpenClawHeartbeatStatus(log?: Logger): Promise<OpenClawHeartbeatStatus> {
  const runtimeId = readRuntimeId();
  try {
    const snapshot = await getAdminDb().collection(HEARTBEAT_COLLECTION).doc(runtimeId).get();
    if (!snapshot.exists) return deriveOpenClawHeartbeatStatus(null, { runtimeId });
    return deriveOpenClawHeartbeatStatus(snapshot.data() || null, { runtimeId });
  } catch (error) {
    log?.warn("agents.control_plane.openclaw_heartbeat_store_unavailable", {
      runtimeId,
      message: error instanceof Error ? error.message : String(error),
    });
    return {
      state: "offline",
      reason: "store_unavailable",
      runtimeId,
      receivedAt: null,
      sentAt: null,
      ageSeconds: null,
      sourceCommit: null,
      services: {},
    };
  }
}
