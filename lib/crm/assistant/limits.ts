import "server-only";

import { createHash, randomUUID } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase-admin";
import { ApiError } from "@/lib/api/handler";

type RateKind = "chat" | "tools" | "voice" | "stop";
export const ASSISTANT_LIMITS = {
  chat: { minute: 8, day: 100 }, tools: { minute: 30, day: 500 },
  voice: { minute: 3, day: 12 }, stop: { minute: 20, day: 200 },
  chatLeaseMs: 120_000,
} as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CALL_ID = /^rtc_[a-zA-Z0-9_-]{1,200}$/;
export function assistantOwnerHash(uid: string): string {
  if (!uid || uid.length > 128 || uid.includes("/")) throw new ApiError(403, "Assistant account is unavailable.");
  return createHash("sha256").update(`crm-assistant:v1:${uid}`).digest("hex");
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  return JSON.stringify(value ?? null);
}
export function assistantFingerprint(value: unknown): string {
  return createHash("sha256").update(canonical(value)).digest("hex");
}
async function safeStore<T>(operation: () => Promise<T>): Promise<T> {
  try { return await operation(); } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(503, "Assistant safety controls are unavailable. No automatic retry was started.");
  }
}

/** Fixed-window limits are shared across processes; no in-memory fallback when Firestore is down. */
export async function consumeAssistantRateLimit(uid: string, kind: RateKind, db = getAdminDb(), now = Date.now()): Promise<void> {
  const owner = assistantOwnerHash(uid);
  const ref = db.collection("crm_assistant_controls").doc(owner);
  await safeStore(() => db.runTransaction(async (tx) => {
    const doc = await tx.get(ref);
    const old = doc.data()?.rates?.[kind];
    const minute = Math.floor(now / 60_000), day = Math.floor(now / 86_400_000);
    const minuteCount = old?.minute === minute ? Number(old.minuteCount) : 0;
    const dayCount = old?.day === day ? Number(old.dayCount) : 0;
    if (!Number.isSafeInteger(minuteCount) || !Number.isSafeInteger(dayCount) || minuteCount < 0 || dayCount < 0) throw new ApiError(503, "Assistant safety controls are unavailable.");
    if (minuteCount >= ASSISTANT_LIMITS[kind].minute || dayCount >= ASSISTANT_LIMITS[kind].day) throw new ApiError(429, "Assistant request limit reached. Please try again later.");
    tx.set(ref, { rates: { [kind]: { minute, day, minuteCount: minuteCount + 1, dayCount: dayCount + 1 } } }, { merge: true });
  }));
}

/** Receipts never contain messages, SDP, drafts, keys, or provider bodies. Same request ID never bills twice. */
export async function reserveAssistantRequest(
  uid: string, kind: "chat" | "voice", requestId: string, fingerprint: string,
  db: Firestore = getAdminDb(), now = Date.now(),
): Promise<{ reservationId: string; sessionId?: string }> {
  if (!UUID.test(requestId) || !/^[a-f0-9]{64}$/.test(fingerprint)) throw new ApiError(400, "Invalid assistant request identifier.");
  const owner = assistantOwnerHash(uid);
  const reservationId = assistantFingerprint([owner, kind, requestId]);
  const receipt = db.collection("crm_assistant_requests").doc(reservationId);
  const control = db.collection("crm_assistant_controls").doc(owner);
  const sessionId = kind === "voice" ? randomUUID() : undefined;
  const session = sessionId ? db.collection("crm_assistant_voice_sessions").doc(sessionId) : null;
  return safeStore(() => db.runTransaction(async (tx) => {
    const [existing, controls] = await Promise.all([tx.get(receipt), tx.get(control)]);
    if (existing.exists) {
      if (existing.data()?.fingerprint !== fingerprint) throw new ApiError(409, "That request identifier was already used for different content.");
      throw new ApiError(409, "That assistant request was already reserved. It will not be repeated automatically.");
    }
    const active = controls.data()?.[kind];
    if (kind === "voice" && active && active.state !== "stopped") throw new ApiError(409, "A voice session is active or unconfirmed. Stop it before starting another.");
    if (kind === "chat" && active?.state === "pending" && Number(active.startedAtMs) + ASSISTANT_LIMITS.chatLeaseMs > now) throw new ApiError(409, "An assistant reply is already in progress.");
    tx.create(receipt, { owner, kind, fingerprint, state: "pending", createdAtMs: now, updatedAtMs: now });
    tx.set(control, { [kind]: { reservationId, ...(sessionId ? { sessionId } : {}), state: "pending", startedAtMs: now } }, { merge: true });
    if (session) tx.create(session, { owner, reservationId, state: "pending", callId: null, createdAtMs: now, updatedAtMs: now });
    return { reservationId, ...(sessionId ? { sessionId } : {}) };
  }));
}

export async function finishAssistantChat(uid: string, reservationId: string, state: "completed" | "uncertain", db = getAdminDb()): Promise<void> {
  const owner = assistantOwnerHash(uid);
  if (!/^[a-f0-9]{64}$/.test(reservationId)) throw new ApiError(400, "Invalid assistant request identifier.");
  const receipt = db.collection("crm_assistant_requests").doc(reservationId);
  const control = db.collection("crm_assistant_controls").doc(owner);
  await safeStore(() => db.runTransaction(async (tx) => {
    const [record, controls] = await Promise.all([tx.get(receipt), tx.get(control)]);
    if (!record.exists || record.data()?.owner !== owner || record.data()?.kind !== "chat") throw new ApiError(404, "Assistant request was not found.");
    tx.update(receipt, { state, updatedAtMs: Date.now() });
    if (controls.data()?.chat?.reservationId === reservationId) tx.set(control, { chat: { state } }, { merge: true });
  }));
}

export async function getAssistantVoiceSession(uid: string, sessionId: string, db = getAdminDb()): Promise<{ callId: string | null; state: string }> {
  const owner = assistantOwnerHash(uid);
  if (!UUID.test(sessionId)) throw new ApiError(400, "Invalid voice session identifier.");
  return safeStore(async () => {
    const doc = await db.collection("crm_assistant_voice_sessions").doc(sessionId).get();
    const data = doc.data();
    if (!doc.exists || data?.owner !== owner) throw new ApiError(404, "Voice session was not found.");
    if (data.callId !== null && (typeof data.callId !== "string" || !CALL_ID.test(data.callId))) throw new ApiError(503, "Voice session controls are unavailable.");
    return { callId: data.callId, state: String(data.state) };
  });
}

/** Recovery metadata only. This never resolves a key or calls the provider. */
export async function getActiveAssistantVoiceSession(uid: string, db = getAdminDb()): Promise<{ sessionId: string; state: "connecting" | "active" | "uncertain"; canStop: boolean } | undefined> {
  const owner = assistantOwnerHash(uid);
  return safeStore(async () => {
    const control = await db.collection("crm_assistant_controls").doc(owner).get();
    const voice = control.data()?.voice;
    if (!voice || voice.state === "stopped") return undefined;
    if (typeof voice.sessionId !== "string" || !UUID.test(voice.sessionId)) throw new ApiError(503, "Voice session controls are unavailable.");
    const session = await getAssistantVoiceSession(uid, voice.sessionId, db);
    if (session.state === "stopped") return undefined;
    return { sessionId: voice.sessionId, state: session.state === "pending" ? "connecting" : session.state === "active" ? "active" : "uncertain", canStop: Boolean(session.callId) };
  });
}

async function updateVoice(uid: string, sessionId: string, state: "active" | "uncertain" | "stopped", callId: string | undefined, db: Firestore): Promise<void> {
  const owner = assistantOwnerHash(uid);
  if (!UUID.test(sessionId) || (callId !== undefined && !CALL_ID.test(callId))) throw new ApiError(400, "Invalid voice session identifier.");
  const session = db.collection("crm_assistant_voice_sessions").doc(sessionId);
  const control = db.collection("crm_assistant_controls").doc(owner);
  await safeStore(() => db.runTransaction(async (tx) => {
    const [record, controls] = await Promise.all([tx.get(session), tx.get(control)]);
    const data = record.data();
    if (!record.exists || data?.owner !== owner) throw new ApiError(404, "Voice session was not found.");
    if (data.state === "stopped") {
      if (state === "active") throw new ApiError(409, "Voice session has already stopped.");
      return;
    }
    if (callId && data.callId && data.callId !== callId) throw new ApiError(409, "Voice call binding cannot change.");
    tx.update(session, { state, ...(callId ? { callId } : {}), updatedAtMs: Date.now() });
    tx.update(db.collection("crm_assistant_requests").doc(data.reservationId), { state, updatedAtMs: Date.now() });
    if (controls.data()?.voice?.sessionId === sessionId) tx.set(control, { voice: { state } }, { merge: true });
  }));
}
export const attachAssistantVoiceCall = (uid: string, sessionId: string, callId: string, db = getAdminDb()) => updateVoice(uid, sessionId, "active", callId, db);
export const markAssistantVoiceUncertain = (uid: string, sessionId: string, db = getAdminDb()) => updateVoice(uid, sessionId, "uncertain", undefined, db);
export const markAssistantVoiceStopped = (uid: string, sessionId: string, db = getAdminDb()) => updateVoice(uid, sessionId, "stopped", undefined, db);
