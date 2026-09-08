import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Firestore } from "firebase-admin/firestore";
import {
  ASSISTANT_LIMITS, assistantFingerprint, assistantOwnerHash, attachAssistantVoiceCall,
  consumeAssistantRateLimit, finishAssistantChat, getActiveAssistantVoiceSession, getAssistantVoiceSession,
  markAssistantVoiceStopped, markAssistantVoiceUncertain, reserveAssistantRequest,
} from "@/lib/crm/assistant/limits";

vi.mock("@/lib/firebase-admin", () => ({ getAdminDb: vi.fn(() => { throw new Error("Live database forbidden"); }) }));
const requestId = "a819a7e8-1933-4fd8-8c7d-224289fb1f42";
const requestId2 = "580f9317-439c-420e-ae65-f32846c54fbe";
const fingerprint = assistantFingerprint({ text: "fixture only" });

function mockDb() {
  const records = new Map<string, Record<string, unknown>>();
  function merge(a: Record<string, unknown>, b: Record<string, unknown>): Record<string, unknown> {
    const result = { ...a };
    for (const [key, value] of Object.entries(b)) result[key] = value && typeof value === "object" && !Array.isArray(value)
      ? merge((a[key] as Record<string, unknown>) || {}, value as Record<string, unknown>) : value;
    return result;
  }
  const snapshot = (path: string) => ({ exists: records.has(path), data: () => records.get(path) });
  let serial = Promise.resolve();
  const db = {
    collection: (name: string) => ({ doc: (id: string) => ({ path: `${name}/${id}`, get: async () => snapshot(`${name}/${id}`) }) }),
    runTransaction: vi.fn((fn: (tx: unknown) => Promise<unknown>) => {
      const execution = serial.then(async () => {
        const writes: Array<() => void> = [];
        const tx = {
          get: async (ref: { path: string }) => snapshot(ref.path),
          create: (ref: { path: string }, value: Record<string, unknown>) => writes.push(() => { if (records.has(ref.path)) throw new Error("duplicate"); records.set(ref.path, value); }),
          set: (ref: { path: string }, value: Record<string, unknown>, options?: { merge: boolean }) => writes.push(() => records.set(ref.path, options?.merge ? merge(records.get(ref.path) || {}, value) : value)),
          update: (ref: { path: string }, value: Record<string, unknown>) => writes.push(() => { if (!records.has(ref.path)) throw new Error("missing"); records.set(ref.path, merge(records.get(ref.path)!, value)); }),
        };
        const result = await fn(tx);
        writes.forEach((write) => write());
        return result;
      });
      serial = execution.then(() => undefined, () => undefined);
      return execution;
    }),
  };
  return { db: db as unknown as Firestore, records };
}

describe("CRM assistant distributed controls", () => {
  beforeEach(() => vi.clearAllMocks());
  it("hashes identities and canonicalizes argument fingerprints", () => {
    expect(assistantOwnerHash("fixture-owner")).toMatch(/^[a-f0-9]{64}$/);
    expect(assistantFingerprint({ b: 2, a: 1 })).toBe(assistantFingerprint({ a: 1, b: 2 }));
    expect(() => assistantOwnerHash("other/path")).toThrow();
  });
  it("enforces per-UID limits across requests and isolates other owners", async () => {
    const { db } = mockDb();
    for (let index = 0; index < ASSISTANT_LIMITS.chat.minute; index++) await consumeAssistantRateLimit("owner", "chat", db, 1000);
    await expect(consumeAssistantRateLimit("owner", "chat", db, 1000)).rejects.toMatchObject({ status: 429 });
    await expect(consumeAssistantRateLimit("other", "chat", db, 1000)).resolves.toBeUndefined();
    await expect(consumeAssistantRateLimit("owner", "chat", db, 61_000)).resolves.toBeUndefined();
  });
  it("enforces the daily voice budget across minute windows", async () => {
    const { db } = mockDb();
    for (let index = 0; index < ASSISTANT_LIMITS.voice.day; index++) await consumeAssistantRateLimit("owner", "voice", db, index * 60_000);
    await expect(consumeAssistantRateLimit("owner", "voice", db, 80 * 60_000)).rejects.toMatchObject({ status: 429 });
    await expect(consumeAssistantRateLimit("owner", "voice", db, 86_400_000)).resolves.toBeUndefined();
  });
  it("allows exactly one concurrent reservation and rejects changed-payload replay", async () => {
    const { db } = mockDb();
    const attempts = await Promise.allSettled([1, 2].map(() => reserveAssistantRequest("owner", "chat", requestId, fingerprint, db)));
    expect(attempts.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    expect(attempts.filter((item) => item.status === "rejected")).toHaveLength(1);
    await expect(reserveAssistantRequest("owner", "chat", requestId, assistantFingerprint("different"), db)).rejects.toThrow("different content");
  });
  it("retains only metadata and never repeats completed or uncertain chat IDs", async () => {
    const { db, records } = mockDb();
    const { reservationId } = await reserveAssistantRequest("owner", "chat", requestId, fingerprint, db);
    await expect(reserveAssistantRequest("owner", "chat", requestId2, fingerprint, db)).rejects.toMatchObject({ status: 409 });
    await finishAssistantChat("owner", reservationId, "uncertain", db);
    await expect(reserveAssistantRequest("owner", "chat", requestId, fingerprint, db)).rejects.toMatchObject({ status: 409 });
    await expect(reserveAssistantRequest("owner", "chat", requestId2, fingerprint, db)).resolves.toBeDefined();
    const stored = JSON.stringify([...records.entries()]);
    expect(stored).not.toContain("fixture only");
    expect(stored).not.toContain(requestId);
    await expect(finishAssistantChat("other", reservationId, "completed", db)).rejects.toMatchObject({ status: 404 });
  });
  it("bounds orphaned chat leases without allowing the same request to replay", async () => {
    const { db } = mockDb();
    await reserveAssistantRequest("owner", "chat", requestId, fingerprint, db, 0);
    await expect(reserveAssistantRequest("owner", "chat", requestId2, fingerprint, db, ASSISTANT_LIMITS.chatLeaseMs + 1)).resolves.toBeDefined();
    await expect(reserveAssistantRequest("owner", "chat", requestId, fingerprint, db, ASSISTANT_LIMITS.chatLeaseMs * 3)).rejects.toMatchObject({ status: 409 });
  });
  it("pins voice call ownership and blocks new sessions until confirmed stopped", async () => {
    const { db } = mockDb();
    const { sessionId } = await reserveAssistantRequest("owner", "voice", requestId, fingerprint, db);
    expect(sessionId).toMatch(/^[a-f0-9-]{36}$/);
    await attachAssistantVoiceCall("owner", sessionId!, "rtc_fixture", db);
    await expect(getAssistantVoiceSession("other", sessionId!, db)).rejects.toMatchObject({ status: 404 });
    await expect(markAssistantVoiceStopped("other", sessionId!, db)).rejects.toMatchObject({ status: 404 });
    await expect(attachAssistantVoiceCall("owner", sessionId!, "rtc_other", db)).rejects.toMatchObject({ status: 409 });
    await markAssistantVoiceUncertain("owner", sessionId!, db);
    await expect(reserveAssistantRequest("owner", "voice", requestId2, fingerprint, db, Date.now() + 86_400_000)).rejects.toMatchObject({ status: 409 });
    await markAssistantVoiceStopped("owner", sessionId!, db);
    await expect(getAssistantVoiceSession("owner", sessionId!, db)).resolves.toEqual({ state: "stopped", callId: "rtc_fixture" });
    await expect(reserveAssistantRequest("owner", "voice", requestId2, fingerprint, db)).resolves.toBeDefined();
    await expect(attachAssistantVoiceCall("owner", sessionId!, "rtc_fixture", db)).rejects.toMatchObject({ status: 409 });
  });
  it("rejects invalid IDs before reading a session", async () => {
    const { db } = mockDb();
    await expect(getAssistantVoiceSession("owner", "rtc_not-an-app-session", db)).rejects.toMatchObject({ status: 400 });
    await expect(reserveAssistantRequest("owner", "voice", "not-uuid", fingerprint, db)).rejects.toMatchObject({ status: 400 });
  });
  it("exposes only owned recovery metadata, including uncertain sessions after a refresh", async () => {
    const { db } = mockDb();
    expect(await getActiveAssistantVoiceSession("owner", db)).toBeUndefined();
    const { sessionId } = await reserveAssistantRequest("owner", "voice", requestId, fingerprint, db);
    expect(await getActiveAssistantVoiceSession("owner", db)).toEqual({ sessionId, state: "connecting", canStop: false });
    await attachAssistantVoiceCall("owner", sessionId!, "rtc_fixture", db);
    await markAssistantVoiceUncertain("owner", sessionId!, db);
    expect(await getActiveAssistantVoiceSession("owner", db)).toEqual({ sessionId, state: "uncertain", canStop: true });
    expect(await getActiveAssistantVoiceSession("other", db)).toBeUndefined();
    await markAssistantVoiceStopped("owner", sessionId!, db);
    expect(await getActiveAssistantVoiceSession("owner", db)).toBeUndefined();
  });
  it("fails closed with sanitized database errors", async () => {
    const db = { collection: () => ({ doc: () => ({}) }), runTransaction: async () => { throw new Error("private database credential fixture"); } } as unknown as Firestore;
    await expect(consumeAssistantRateLimit("owner", "chat", db)).rejects.toMatchObject({ status: 503, message: expect.not.stringContaining("credential") });
  });
});
