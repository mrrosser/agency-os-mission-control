import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import { warmReconnectFingerprint } from "@/lib/crm/warm-reconnect-dedupe";
import historical from "@/tests/fixtures/warm-reconnect-qa-original.json";
import { WARM_RECONNECT_QA_ORIGINAL_TEST_ID as ORIGINAL, WARM_RECONNECT_QA_REVISED_TEST_ID as REVISED } from "@/lib/crm/warm-reconnect-qa-version";

const mocks = vi.hoisted(() => ({
  access: vi.fn(), summary: vi.fn(), account: vi.fn(), accessToken: vi.fn(), sender: vi.fn(), scope: vi.fn(),
}));
vi.mock("@/lib/crm/portfolio-registry", () => ({ assertPortfolioRegistryAccess: mocks.access, loadPortfolioCrmSummaryForUid: mocks.summary }));
vi.mock("@/lib/google/account-token-store", () => ({ resolveGoogleAccountTokens: mocks.account }));
vi.mock("@/lib/google/oauth", () => ({ getAccessTokenForUser: mocks.accessToken, isGoogleTokenScopeBoundedForPreset: mocks.scope }));
vi.mock("@/lib/google/gmail-campaign-sender", () => ({ sendWarmReconnectCampaignEmail: mocks.sender }));
vi.mock("@/lib/crm/warm-reconnect-qa-recipient", () => ({
  isWarmReconnectQaRecipient: (value: string) => typeof value === "string" && value.trim().toLowerCase() === "owner-qa@example.test",
}));

import {
  prepareWarmReconnectQa, readWarmReconnectQaForOwner, sendWarmReconnectQa,
  processWarmReconnectQaPreference, unsubscribeWarmReconnectQaToken,
  WARM_RECONNECT_QA_COLLECTIONS as C,
} from "@/lib/crm/warm-reconnect-qa";

type Stored = Record<string, unknown>;
function fakeDb() {
  const records = new Map<string, Stored>();
  const writes: string[] = [];
  let pending = Promise.resolve();
  let failStatus: string | null = null;
  const snapshot = (path: string, store = records) => ({ exists: store.has(path), data: () => store.get(path), id: path.split("/").at(-1) });
  const ref = (path: string): Record<string, unknown> => ({ path, id: path.split("/").at(-1), get: async () => snapshot(path) });
  const db = {
    collection: (name: string) => ({ doc: (id: string) => ref(`${name}/${id}`) }),
    runTransaction: (callback: (tx: unknown) => Promise<unknown>) => {
      const run = pending.then(async () => {
        const working = new Map(records);
        const paths: string[] = [];
        const tx = {
          get: async (r: { path: string }) => snapshot(r.path, working),
          create: (r: { path: string }, data: Stored) => {
            if (working.has(r.path)) throw new Error("exists");
            working.set(r.path, structuredClone(data)); paths.push(r.path);
          },
          set: (r: { path: string }, data: Stored) => {
            if (data.status === failStatus) throw new Error("simulated receipt persistence failure");
            working.set(r.path, structuredClone(data)); paths.push(r.path);
          },
        };
        const result = await callback(tx);
        records.clear(); for (const [key, value] of working) records.set(key, value);
        writes.push(...paths); return result;
      });
      pending = run.then(() => undefined, () => undefined);
      return run;
    },
  } as unknown as Firestore;
  return { db, records, writes, failStatus: (value: string) => { failStatus = value; } };
}
const NOW = Date.parse("2026-10-04T21:00:00Z");
const uid = "owner";
const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const recipient = "owner-qa@example.test";
const hash = (token: string) => createHash("sha256").update(token).digest("hex");
function account() {
  return { profileMapped: true, record: {
    profileId: "rosser_gallery_send", accountId: "gallery-account", tokens: {
      refreshToken: "fixture-refresh", accountEmail: "mrosser@rossergallery.com", scopePreset: "gmail_send", scope: "https://www.googleapis.com/auth/gmail.send",
    },
  } };
}
async function prepare(fixture: ReturnType<typeof fakeDb>) {
  return prepareWarmReconnectQa({ uid, recipient, log, db: fixture.db, now: NOW });
}
async function send(fixture: ReturnType<typeof fakeDb>, artifactFingerprint: string) {
  return sendWarmReconnectQa({ uid, recipient, artifactFingerprint, confirmSendOneTest: true, db: fixture.db, now: NOW + 1000 });
}
async function delivered() {
  const fixture = fakeDb();
  const prepared = await prepare(fixture);
  await send(fixture, prepared.artifactFingerprint);
  const message = mocks.sender.mock.calls[0][1];
  const preferenceToken = new URLSearchParams(new URL(message.preferencesUrl).hash.slice(1)).get("token")!;
  const unsubscribeToken = new URL(message.oneClickUnsubscribeUrl).pathname.split("/").at(-1)!;
  const inspected = await processWarmReconnectQaPreference({ action: "inspect", token: preferenceToken }, { db: fixture.db, now: NOW });
  return { ...fixture, preferenceToken, unsubscribeToken, nonce: inspected.confirmationNonce!, message };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("REVENUE_AUTOMATION_UID", uid);
  vi.stubEnv("WARM_RECONNECT_PROVIDER_SEND_ENABLED", "true");
  vi.stubEnv("WARM_RECONNECT_PUBLIC_ORIGIN", "https://leadflow-review.web.app");
  mocks.access.mockResolvedValue({ workspaceId: "workspace_default_owner", role: "owner" });
  mocks.summary.mockResolvedValue({
    schemaVersion: 1, sourceOfTruth: "firestore_portfolio_registry", dataClassification: "aggregate_only", readOnly: true,
    outreach: { status: "blocked", eligibleContacts: 0 },
    permissions: { contactPointStates: { unknown: 0 }, sourceRecordsWithNoPermissionBasis: 0 },
    totals: { people: 0, contactPoints: 0, emailContactPoints: 0 }, brands: { unassigned: 0 }, freshness: { observedAt: "2026-10-04T21:00:00Z" },
  });
  mocks.account.mockResolvedValue(account());
  mocks.scope.mockReturnValue(true);
  mocks.accessToken.mockResolvedValue("fixture-access");
  mocks.sender.mockResolvedValue({ id: "provider-message", threadId: "provider-thread" });
});

describe("fixed-recipient owner QA preparation and execution", () => {
  it("freezes the actual button renderer in a single QA record, with no capabilities or send", async () => {
    const f = fakeDb(); const result = await prepare(f);
    expect(result.subject).toBe("[TEST] A quick hello from Marcus");
    expect(result.plainText).toContain("Hi Marcus,");
    expect(result.html).toContain("choice=both");
    expect(result.html).not.toContain("<img");
    expect(result.recipient).toBe(recipient);
    expect(result.from).toBe("mrosser@rossergallery.com");
    expect(f.writes).toHaveLength(1);
    expect(f.writes[0]).toMatch(new RegExp(`^${C.runs}/`));
    expect(mocks.accessToken).not.toHaveBeenCalled(); expect(mocks.sender).not.toHaveBeenCalled();
    expect(await prepare(f)).toMatchObject({ replayed: true, artifactFingerprint: result.artifactFingerprint });
    expect(f.writes).toHaveLength(1);
  });

  it("owner reads do not prepare or write", async () => {
    const f = fakeDb(); expect(await readWarmReconnectQaForOwner(uid, f.db)).toMatchObject({ testMode: true, status: "not_prepared", testId: ORIGINAL });
    expect(f.writes).toEqual([]); expect(mocks.account).not.toHaveBeenCalled();
  });

  it("rejects a different recipient, configured UID, or nonowner role", async () => {
    const f = fakeDb();
    await expect(prepareWarmReconnectQa({ uid, recipient: "someone@example.com" as never, log, db: f.db })).rejects.toMatchObject({ status: 400 });
    await expect(prepareWarmReconnectQa({ uid: "someone", recipient, log, db: f.db })).rejects.toMatchObject({ status: 403 });
    mocks.access.mockResolvedValue({ workspaceId: "workspace_default_owner", role: "admin" });
    await expect(prepare(f)).rejects.toMatchObject({ status: 403 }); expect(f.writes).toEqual([]);
  });

  it.each(["different-mailbox", "wrong-profile", "wrong-preset", "broad-scope", "unmapped"])("rejects Gallery identity/scope drift: %s", async (kind) => {
    const record = account();
    if (kind === "different-mailbox") record.record.tokens.accountEmail = "mrosser@rt.solutions";
    if (kind === "wrong-profile") record.record.profileId = "rosser_gallery_work";
    if (kind === "wrong-preset") record.record.tokens.scopePreset = "full";
    if (kind === "broad-scope") mocks.scope.mockReturnValue(false);
    if (kind === "unmapped") record.profileMapped = false;
    mocks.account.mockResolvedValue(record);
    const f = fakeDb(); await expect(prepare(f)).rejects.toMatchObject({ status: 409 }); expect(f.writes).toEqual([]);
  });

  it("sends at most once under concurrency; stores only capability digests and QA records", async () => {
    const f = fakeDb(); const prepared = await prepare(f);
    await Promise.all([send(f, prepared.artifactFingerprint), send(f, prepared.artifactFingerprint)]);
    expect(mocks.sender).toHaveBeenCalledTimes(1);
    const message = mocks.sender.mock.calls[0][1];
    expect(message).toMatchObject({ to: recipient, from: "mrosser@rossergallery.com", replyTo: "mrosser@rossergallery.com", purpose: "owner_qa" });
    const token = new URLSearchParams(new URL(message.preferencesUrl).hash.slice(1)).get("token")!;
    expect(token).not.toBe("p".repeat(43));
    expect(f.records.has(`${C.tokens}/${hash(token)}`)).toBe(true);
    expect(JSON.stringify([...f.records.values()])).not.toContain(token);
    expect(f.writes.every((path) => Object.values(C).some((name) => path.startsWith(`${name}/`)))).toBe(true);
    expect(await send(f, prepared.artifactFingerprint)).toMatchObject({ status: "sent", replayed: true, providerAction: false });
    expect(mocks.sender).toHaveBeenCalledTimes(1);
  });

  it("requires exact reviewed content, enabled sending, current review and unchanged account", async () => {
    const f = fakeDb(); const prepared = await prepare(f);
    await expect(send(f, `sha256:${"f".repeat(64)}`)).rejects.toMatchObject({ status: 409 });
    vi.stubEnv("WARM_RECONNECT_PROVIDER_SEND_ENABLED", "false");
    await expect(send(f, prepared.artifactFingerprint)).rejects.toMatchObject({ status: 503 });
    vi.stubEnv("WARM_RECONNECT_PROVIDER_SEND_ENABLED", "true");
    await expect(sendWarmReconnectQa({ uid, recipient, artifactFingerprint: prepared.artifactFingerprint, confirmSendOneTest: true, db: f.db, now: NOW + 25 * 3600000 })).rejects.toMatchObject({ status: 409 });
    const changed = account(); changed.record.accountId = "new-account"; mocks.account.mockResolvedValue(changed);
    await expect(send(f, prepared.artifactFingerprint)).rejects.toMatchObject({ status: 409 });
    expect(mocks.sender).not.toHaveBeenCalled(); expect(f.writes).toHaveLength(1);
  });

  it.each(["provider-timeout", "missing-receipt", "receipt-write-failure"])("makes %s terminal without retry", async (kind) => {
    const f = fakeDb(); const prepared = await prepare(f);
    if (kind === "provider-timeout") mocks.sender.mockRejectedValue(new Error("unknown outcome"));
    if (kind === "missing-receipt") mocks.sender.mockResolvedValue({ id: "", threadId: "" });
    if (kind === "receipt-write-failure") f.failStatus("sent");
    expect(await send(f, prepared.artifactFingerprint)).toMatchObject({ status: "delivery_unknown" });
    expect(await send(f, prepared.artifactFingerprint)).toMatchObject({ status: "delivery_unknown", providerAction: false });
    expect(mocks.sender).toHaveBeenCalledTimes(1);
  });

  it("an interrupted inflight process cannot be retried", async () => {
    const f = fakeDb(); const prepared = await prepare(f);
    const [id, value] = [...f.records.entries()][0]; f.records.set(id, { ...value, status: "provider_inflight" });
    expect(await send(f, prepared.artifactFingerprint)).toMatchObject({ status: "provider_inflight", providerAction: false });
    expect(mocks.sender).not.toHaveBeenCalled();
  });

  it("rejects artifact tampering and a historically valid but changed renderer implementation", async () => {
    const f = fakeDb(); const prepared = await prepare(f);
    const [id, value] = [...f.records.entries()][0];
    const message = value.message as Stored;
    f.records.set(id, { ...value, message: { ...message, plainText: "Changed after review" } });
    await expect(send(f, prepared.artifactFingerprint)).rejects.toMatchObject({ status: 409 });
    const historical: Stored = { ...value, rendererImplementationFingerprint: `sha256:${"a".repeat(64)}` };
    const historicalFingerprint = warmReconnectFingerprint({
      message: historical.message, accountId: historical.accountId,
      rendererImplementationFingerprint: historical.rendererImplementationFingerprint,
      mimeImplementationFingerprint: historical.mimeImplementationFingerprint,
    });
    f.records.set(id, { ...historical, artifactFingerprint: historicalFingerprint });
    await expect(send(f, historicalFingerprint)).rejects.toThrow("renderer or MIME implementation changed");
    expect(mocks.sender).not.toHaveBeenCalled();
  });

  it("rechecks the pinned sender after token refresh and before claiming", async () => {
    const f = fakeDb(); const prepared = await prepare(f);
    const changed = account(); changed.record.accountId = "replacement-account";
    mocks.account.mockResolvedValueOnce(account()).mockResolvedValueOnce(changed);
    await expect(send(f, prepared.artifactFingerprint)).rejects.toMatchObject({ status: 409 });
    expect(mocks.accessToken).toHaveBeenCalledTimes(1);
    expect(mocks.sender).not.toHaveBeenCalled(); expect(f.writes).toHaveLength(1);
  });

  it("preserves the reviewed fingerprint after Firestore map key reordering", async () => {
    const f = fakeDb(); const prepared = await prepare(f);
    const [id, value] = [...f.records.entries()][0];
    const message = Object.fromEntries(Object.entries(value.message as Stored).sort(([a], [b]) => a.localeCompare(b)));
    f.records.set(id, Object.fromEntries(Object.entries({ ...value, message }).sort(([a], [b]) => a.localeCompare(b))));
    expect(await send(f, prepared.artifactFingerprint)).toMatchObject({ status: "sent" });
    expect(mocks.sender).toHaveBeenCalledTimes(1);
  });
});

describe("separately authorized revised design", () => {
  const revisedPrepare = (f: ReturnType<typeof fakeDb>) => prepareWarmReconnectQa({ uid, recipient, log, db: f.db, now: NOW, testId: REVISED });
  const revisedSend = (f: ReturnType<typeof fakeDb>, artifactFingerprint: string) => sendWarmReconnectQa({ uid, recipient, artifactFingerprint, confirmSendOneTest: true, db: f.db, now: NOW + 1000, testId: REVISED });
  function historicalDb() {
    const f = fakeDb();
    for (const [key, value] of historical.records) f.records.set(key as string, structuredClone(value) as Stored);
    return f;
  }

  it("reads the immutable baseline-generated original receipt and keeps its links functional", async () => {
    const f = historicalDb(); const before = JSON.stringify([...f.records]);
    const original = await readWarmReconnectQaForOwner(uid, f.db);
    expect(original).toMatchObject({ testId: ORIGINAL, status: "sent", providerMessageId: "provider-message" });
    expect(await processWarmReconnectQaPreference({ action: "inspect", token: historical.preferenceToken }, { db: f.db, now: NOW })).toMatchObject({ available: true, testMode: true });
    expect(f.writes).toEqual([]); expect(JSON.stringify([...f.records])).toBe(before);
    expect(await send(f, "artifactFingerprint" in original ? original.artifactFingerprint : "missing")).toMatchObject({ testId: ORIGINAL, status: "sent", providerAction: false });
    expect(mocks.sender).not.toHaveBeenCalled();
  });

  it("freezes exact CID assets and version separately without changing the original receipt", async () => {
    const f = historicalDb(); const originalEntries = JSON.stringify([...f.records]);
    const revised = await revisedPrepare(f);
    expect(revised).toMatchObject({ testId: REVISED, designVersion: "rosser-rt-library-kit-v1", designReady: true, status: "prepared" });
    expect(revised.html).toContain('src="cid:nurturer-v1@rosser-owner-qa"');
    expect(revised.html).not.toMatch(/preview\.invalid|assets\/|\{\{|data:/);
    expect(revised).toHaveProperty("previewHtml", expect.stringContaining("data:image/jpeg;base64,"));
    expect(revised.inlineAssetManifest).toHaveLength(3);
    const saved = [...f.records.values()].find(value => value.testId === REVISED)!;
    expect(JSON.stringify(saved)).not.toContain("base64");
    expect(saved).toHaveProperty("inlineAssetManifest");
    expect(JSON.stringify([...f.records].filter(([, value]) => value.testId !== REVISED))).toBe(originalEntries);
    expect(await revisedPrepare(f)).toMatchObject({ replayed: true, artifactFingerprint: revised.artifactFingerprint });
    expect(f.writes).toHaveLength(1);
    expect(mocks.sender).not.toHaveBeenCalled();
  });

  it("rejects cross-version artifacts, arbitrary identities and changed recipient", async () => {
    const f = fakeDb(); const original = await prepare(f); const revised = await revisedPrepare(f);
    expect(original.artifactFingerprint).not.toBe(revised.artifactFingerprint);
    await expect(revisedSend(f, original.artifactFingerprint)).rejects.toMatchObject({ status: 409 });
    await expect(send(f, revised.artifactFingerprint)).rejects.toMatchObject({ status: 409 });
    await expect(prepareWarmReconnectQa({ uid, recipient, log, db: f.db, testId: "arbitrary" as never })).rejects.toMatchObject({ status: 400 });
    await expect(prepareWarmReconnectQa({ uid, recipient: "other@example.test", log, db: f.db, testId: REVISED })).rejects.toMatchObject({ status: 400 });
    expect(mocks.sender).not.toHaveBeenCalled(); expect(mocks.accessToken).not.toHaveBeenCalled();
  });

  it("returns only revised identity under concurrent sends even when the original was already sent", async () => {
    const f = historicalDb(); const revised = await revisedPrepare(f);
    mocks.sender.mockResolvedValue({ id: "revised-provider-message", threadId: "revised-thread" });
    const results = await Promise.all([revisedSend(f, revised.artifactFingerprint), revisedSend(f, revised.artifactFingerprint)]);
    expect(mocks.sender).toHaveBeenCalledTimes(1);
    for (const result of results) {
      expect(result.testId).toBe(REVISED);
      expect(result).not.toMatchObject({ providerMessageId: "provider-message" });
    }
    expect(mocks.sender.mock.calls[0][1].inlineAssets).toHaveLength(3);
    expect(await readWarmReconnectQaForOwner(uid, f.db)).toMatchObject({ testId: ORIGINAL, status: "sent", providerMessageId: "provider-message" });
    expect(await revisedSend(f, revised.artifactFingerprint)).toMatchObject({ testId: REVISED, providerAction: false });
    expect(mocks.sender).toHaveBeenCalledTimes(1);
  });

  it.each(["timeout", "receipt-write-failure", "inflight"])("never retries revised ambiguous outcome: %s", async kind => {
    const f = historicalDb(); const revised = await revisedPrepare(f);
    if (kind === "inflight") {
      const [key, value] = [...f.records].find(([, value]) => value.testId === REVISED)!;
      f.records.set(key, { ...value, status: "provider_inflight" });
    } else if (kind === "timeout") mocks.sender.mockRejectedValue(new Error("synthetic provider timeout"));
    else f.failStatus("sent");
    await revisedSend(f, revised.artifactFingerprint);
    expect(await revisedSend(f, revised.artifactFingerprint)).toMatchObject({ testId: REVISED, providerAction: false, status: kind === "inflight" ? "provider_inflight" : "delivery_unknown" });
    expect(mocks.sender).toHaveBeenCalledTimes(kind === "inflight" ? 0 : 1);
    expect(await readWarmReconnectQaForOwner(uid, f.db)).toMatchObject({ providerMessageId: "provider-message", status: "sent" });
  });

  it("rejects asset-manifest tampering before token resolution or provider activity", async () => {
    const f = fakeDb(); const revised = await revisedPrepare(f);
    const [key, value] = [...f.records].find(([, value]) => value.testId === REVISED)!;
    f.records.set(key, { ...value, inlineAssetManifest: [] });
    await expect(revisedSend(f, revised.artifactFingerprint)).rejects.toMatchObject({ status: 409 });
    expect(mocks.accessToken).not.toHaveBeenCalled(); expect(mocks.sender).not.toHaveBeenCalled();
  });

  it("keeps confirmation state and replay IDs isolated across original and revised capabilities", async () => {
    const f = historicalDb(); const revised = await revisedPrepare(f); await revisedSend(f, revised.artifactFingerprint);
    const message = mocks.sender.mock.calls[0][1];
    const revisedToken = new URLSearchParams(new URL(message.preferencesUrl).hash.slice(1)).get("token")!;
    for (const [token, topics] of [[historical.preferenceToken, { rosser_gallery: true, rt_solutions: false }], [revisedToken, { rosser_gallery: false, rt_solutions: true }]] as const) {
      const inspected = await processWarmReconnectQaPreference({ action: "inspect", token }, { db: f.db, now: NOW });
      expect(await processWarmReconnectQaPreference({ action: "save_preferences", token, topics, confirmationNonce: inspected.confirmationNonce!, requestId: "same-request-id" }, { db: f.db, now: NOW })).toMatchObject({ topics });
    }
    expect(await readWarmReconnectQaForOwner(uid, f.db)).toMatchObject({ qaPreferenceState: { topics: { rosser_gallery: true, rt_solutions: false } } });
    expect(await readWarmReconnectQaForOwner(uid, f.db, REVISED)).toMatchObject({ qaPreferenceState: { topics: { rosser_gallery: false, rt_solutions: true } } });
    expect(f.writes.every(path => Object.values(C).some(collection => path.startsWith(`${collection}/`)))).toBe(true);
  });
});

describe("isolated QA preference capabilities", () => {
  it("inspect is read only; confirmation is required and only QA state changes", async () => {
    const f = await delivered(); const before = f.writes.length;
    const inspected = await processWarmReconnectQaPreference({ action: "inspect", token: f.preferenceToken }, { db: f.db, now: NOW });
    expect(inspected).toMatchObject({ testMode: true, canUpdatePreferences: true, topics: { rosser_gallery: false, rt_solutions: false } });
    expect(f.writes).toHaveLength(before);
    const mutation = { action: "save_preferences" as const, token: f.preferenceToken, requestId: "first", confirmationNonce: "bad", topics: { rosser_gallery: true, rt_solutions: false } };
    expect(await processWarmReconnectQaPreference(mutation, { db: f.db, now: NOW })).toMatchObject({ available: false });
    expect(f.writes).toHaveLength(before);
    expect(await processWarmReconnectQaPreference({ ...mutation, confirmationNonce: f.nonce }, { db: f.db, now: NOW })).toMatchObject({ topics: mutation.topics });
    expect(f.writes.slice(before).every((p) => p.startsWith(C.choices) || p.startsWith(C.requests))).toBe(true);
  });

  it("enforces token scope and rejects unissued/production tokens", async () => {
    const f = await delivered(); const before = f.writes.length;
    expect(await processWarmReconnectQaPreference({ action: "inspect", token: f.unsubscribeToken }, { db: f.db })).toMatchObject({ available: false });
    expect(await unsubscribeWarmReconnectQaToken(f.preferenceToken, { db: f.db })).toMatchObject({ available: false });
    f.records.set(`crm_preference_tokens/${hash("x".repeat(43))}`, { scope: "preferences" });
    expect(await processWarmReconnectQaPreference({ action: "inspect", token: "x".repeat(43) }, { db: f.db })).toMatchObject({ available: false });
    expect(f.writes).toHaveLength(before);
  });

  it("request replay cannot replace a newer choice; conflicting replay is rejected", async () => {
    const f = await delivered();
    const base = { action: "save_preferences" as const, token: f.preferenceToken, confirmationNonce: f.nonce };
    const first = { ...base, requestId: "one", topics: { rosser_gallery: true, rt_solutions: false } };
    const second = { ...base, requestId: "two", topics: { rosser_gallery: false, rt_solutions: true } };
    await processWarmReconnectQaPreference(first, { db: f.db, now: NOW });
    await processWarmReconnectQaPreference(second, { db: f.db, now: NOW });
    const before = f.writes.length;
    expect(await processWarmReconnectQaPreference(first, { db: f.db, now: NOW })).toMatchObject({ topics: second.topics });
    expect(await processWarmReconnectQaPreference({ ...first, topics: second.topics }, { db: f.db, now: NOW })).toMatchObject({ available: false });
    expect(f.writes).toHaveLength(before);
  });

  it("expired tokens cannot add choices but unsubscribe stays available and sticky", async () => {
    const f = await delivered(); const expired = NOW + 8 * 24 * 3600000;
    const mutation = { action: "save_preferences" as const, token: f.preferenceToken, confirmationNonce: f.nonce, requestId: "save", topics: { rosser_gallery: true, rt_solutions: true } };
    const before = f.writes.length;
    expect(await processWarmReconnectQaPreference(mutation, { db: f.db, now: expired })).toMatchObject({ expired: true, canUpdatePreferences: false, topics: { rosser_gallery: false, rt_solutions: false } });
    expect(f.writes).toHaveLength(before);
    expect(await unsubscribeWarmReconnectQaToken(f.unsubscribeToken, { db: f.db, now: expired })).toMatchObject({ globallyUnsubscribed: true });
    expect(await processWarmReconnectQaPreference(mutation, { db: f.db, now: NOW })).toMatchObject({ globallyUnsubscribed: true, canUpdatePreferences: false });
    const after = f.writes.length;
    await unsubscribeWarmReconnectQaToken(f.unsubscribeToken, { db: f.db, now: expired }); expect(f.writes).toHaveLength(after);
  });

  it("explicit UI unsubscribe uses nonce/requestId and cannot affect production suppression", async () => {
    const f = await delivered();
    const result = await processWarmReconnectQaPreference({ action: "unsubscribe", token: f.preferenceToken, confirmationNonce: f.nonce, requestId: "unsubscribe" }, { db: f.db, now: NOW });
    expect(result.globallyUnsubscribed).toBe(true);
    expect(f.writes.every((path) => Object.values(C).some((name) => path.startsWith(`${name}/`)))).toBe(true);
    const before = f.writes.length;
    const ownerView = await readWarmReconnectQaForOwner(uid, f.db);
    expect(ownerView).toMatchObject({
      capabilityExpiresAtMs: NOW + 1000 + 7 * 24 * 3600000,
      qaPreferenceState: { topics: { rosser_gallery: false, rt_solutions: false }, globallyUnsubscribed: true, confirmations: 1 },
    });
    expect(JSON.stringify(ownerView)).not.toContain(f.preferenceToken);
    expect(JSON.stringify(ownerView)).not.toContain(f.nonce);
    expect(f.writes).toHaveLength(before);
  });

  it("rejects empty choices and binds each capability to its frozen QA run", async () => {
    const f = await delivered(); const before = f.writes.length;
    expect(await processWarmReconnectQaPreference({ action: "save_preferences", token: f.preferenceToken, confirmationNonce: f.nonce, requestId: "empty", topics: { rosser_gallery: false, rt_solutions: false } }, { db: f.db, now: NOW })).toMatchObject({ available: false });
    const path = `${C.tokens}/${hash(f.preferenceToken)}`;
    f.records.set(path, { ...f.records.get(path), artifactFingerprint: `sha256:${"a".repeat(64)}` });
    expect(await processWarmReconnectQaPreference({ action: "inspect", token: f.preferenceToken }, { db: f.db, now: NOW })).toMatchObject({ available: false });
    expect(f.writes).toHaveLength(before);
  });
});
