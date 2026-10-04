import "server-only";

import { createHash, randomBytes } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import { ApiError } from "@/lib/api/handler";
import { getAdminDb } from "@/lib/firebase-admin";
import { assertPortfolioRegistryAccess, loadPortfolioCrmSummaryForUid } from "@/lib/crm/portfolio-registry";
import { buildWarmReconnectCampaignDraft } from "@/lib/crm/warm-reconnect";
import { warmReconnectFingerprint as fingerprint } from "@/lib/crm/warm-reconnect-dedupe";
import { renderWarmReconnectEmail, warmReconnectRendererImplementationFingerprint } from "@/lib/crm/warm-reconnect-email-renderer";
import { isWarmReconnectProviderSendEnabled } from "@/lib/crm/warm-reconnect-provider-config";
import { isWarmReconnectQaRecipient } from "@/lib/crm/warm-reconnect-qa-recipient";
import type { WarmReconnectPreferenceResult, WarmReconnectTopics } from "@/lib/crm/warm-reconnect-preferences";
import { resolveGoogleAccountTokens } from "@/lib/google/account-token-store";
import { getAccessTokenForUser, isGoogleTokenScopeBoundedForPreset } from "@/lib/google/oauth";
import { ROSSER_GALLERY_SENDING_EMAIL, ROSSER_GALLERY_SENDING_PROFILE } from "@/lib/google/business-profiles";
import { buildWarmReconnectCampaignMime, warmReconnectMimeImplementationFingerprint, type WarmReconnectCampaignMessage } from "@/lib/google/gmail-campaign";
import { sendWarmReconnectCampaignEmail } from "@/lib/google/gmail-campaign-sender";
import type { Logger } from "@/lib/logging";

/** This is one individually authorized test, not a reusable mailing endpoint. */
export const WARM_RECONNECT_QA_SUBJECT = "[TEST] A quick hello from Marcus" as const;
export const WARM_RECONNECT_QA_COLLECTIONS = {
  runs: "crm_warm_reconnect_qa_runs",
  tokens: "crm_warm_reconnect_qa_tokens",
  choices: "crm_warm_reconnect_qa_choices",
  requests: "crm_warm_reconnect_qa_requests",
} as const;
const TEST_ID = "gallery-owner-single-test-2026-10-04";
const PREVIEW_PREFERENCE_TOKEN = "p".repeat(43);
const PREVIEW_UNSUBSCRIBE_TOKEN = "u".repeat(43);
const CAPABILITY_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const PREPARATION_TTL_MS = 24 * 60 * 60 * 1000;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43,128}$/;
const REQUEST_PATTERN = /^[A-Za-z0-9_.:-]{1,160}$/;
const MAX_CONFIRMATIONS = 100;
type QaStatus = "prepared" | "provider_inflight" | "sent" | "delivery_unknown";
type QaRun = {
  schemaVersion: 1;
  testId: typeof TEST_ID;
  ownerUid: string;
  workspaceId: string;
  accountId: string;
  status: QaStatus;
  preparedAtMs: number;
  artifactFingerprint: string;
  rendererImplementationFingerprint: string;
  mimeImplementationFingerprint: string;
  message: WarmReconnectCampaignMessage;
  providerStartedAtMs?: number;
  providerMessageId?: string;
  providerThreadId?: string;
  deliveredArtifactFingerprint?: string;
  capabilityExpiresAtMs?: number;
  terminalAtMs?: number;
};
type QaToken = {
  schemaVersion: 1;
  purpose: "owner_qa";
  runId: string;
  scope: "preferences" | "unsubscribe_only";
  artifactFingerprint: string;
  expiresAtMs: number;
};
type QaState = { topics: WarmReconnectTopics; globallyUnsubscribed: boolean; confirmations: number };
export type WarmReconnectQaPreferenceResult = WarmReconnectPreferenceResult & {
  testMode: true;
  confirmationNonce?: string;
};
export type WarmReconnectQaMutation =
  | { action: "inspect"; token: string }
  | { action: "save_preferences"; token: string; requestId: string; confirmationNonce: string; topics: WarmReconnectTopics }
  | { action: "unsubscribe"; token: string; requestId: string; confirmationNonce: string };

function hash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
function emptyState(): QaState {
  return { topics: { rosser_gallery: false, rt_solutions: false }, globallyUnsubscribed: false, confirmations: 0 };
}
function unavailable(): WarmReconnectQaPreferenceResult {
  return {
    ok: true, testMode: true, message: "This test link does not change any real subscription.",
    available: false, expired: false, canUpdatePreferences: false, canUnsubscribe: false,
    ...emptyState(),
  };
}
function confirmationNonce(token: string): string {
  return hash(`warm-reconnect-owner-qa-confirmation:v1:${token}`);
}
function runId(workspaceId: string): string {
  return hash(`${TEST_ID}:${workspaceId}`);
}
function publicOrigin(): string {
  const value = process.env.WARM_RECONNECT_PUBLIC_ORIGIN || process.env.NEXT_PUBLIC_APP_URL || "https://leadflow-review.web.app";
  let url: URL;
  try { url = new URL(value); } catch { throw new ApiError(503, "QA public origin is unavailable."); }
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new ApiError(503, "QA public origin is unavailable.");
  }
  return url.origin;
}

async function assertOwner(uid: string, db: Firestore) {
  // Reuse the already configured exact portfolio/worker identity, never a new grant.
  const configuredUid = process.env.REVENUE_AUTOMATION_UID?.trim();
  if (!configuredUid || configuredUid !== uid) throw new ApiError(403, "Only the configured CRM owner can use this test.");
  const access = await assertPortfolioRegistryAccess(uid, db);
  if (access.role !== "owner") throw new ApiError(403, "Only the exact workspace owner can use this test.");
  return access;
}

async function assertGalleryAccount(uid: string, expectedAccountId?: string): Promise<string> {
  const result = await resolveGoogleAccountTokens(uid, ROSSER_GALLERY_SENDING_PROFILE.profileId);
  const record = result.record;
  const tokens = record?.tokens;
  if (!result.profileMapped || !record || record.profileId !== ROSSER_GALLERY_SENDING_PROFILE.profileId ||
      (expectedAccountId !== undefined && record.accountId !== expectedAccountId) ||
      !tokens?.refreshToken || tokens.accountEmail?.trim().toLowerCase() !== ROSSER_GALLERY_SENDING_EMAIL ||
      tokens.scopePreset !== "gmail_send" || !isGoogleTokenScopeBoundedForPreset("gmail_send", tokens.scope)) {
    throw new ApiError(409, "The existing dedicated Gallery sending account must be healthy and unchanged.");
  }
  return record.accountId;
}

function artifactFingerprint(run: Pick<QaRun, "message" | "accountId" | "rendererImplementationFingerprint" | "mimeImplementationFingerprint">): string {
  return fingerprint({
    message: run.message, accountId: run.accountId,
    rendererImplementationFingerprint: run.rendererImplementationFingerprint,
    mimeImplementationFingerprint: run.mimeImplementationFingerprint,
  });
}
function assertImplementationCurrent(run: QaRun) {
  if (run.rendererImplementationFingerprint !== warmReconnectRendererImplementationFingerprint() ||
      run.mimeImplementationFingerprint !== warmReconnectMimeImplementationFingerprint()) {
    throw new ApiError(409, "The reviewed QA renderer or MIME implementation changed.");
  }
}
function assertFrozenRun(run: QaRun, uid: string, workspaceId: string) {
  if (run.schemaVersion !== 1 || run.testId !== TEST_ID || run.ownerUid !== uid || run.workspaceId !== workspaceId ||
      !isWarmReconnectQaRecipient(run.message?.to) || run.message?.from !== ROSSER_GALLERY_SENDING_EMAIL ||
      run.message.replyTo !== ROSSER_GALLERY_SENDING_EMAIL || run.message.subject !== WARM_RECONNECT_QA_SUBJECT ||
      run.message.purpose !== "owner_qa" || run.message.contentMode !== "preference_buttons" ||
      !/^sha256:[a-f0-9]{64}$/.test(run.rendererImplementationFingerprint) ||
      !/^sha256:[a-f0-9]{64}$/.test(run.mimeImplementationFingerprint) ||
      run.artifactFingerprint !== artifactFingerprint(run)) {
    throw new ApiError(409, "The frozen QA artifact could not be verified.");
  }
  buildWarmReconnectCampaignMime(run.message);
}
function review(run: QaRun) {
  return {
    testMode: true as const, recipient: run.message.to,
    from: ROSSER_GALLERY_SENDING_EMAIL, status: run.status,
    artifactFingerprint: run.artifactFingerprint, preparedAtMs: run.preparedAtMs,
    capabilityExpiresAtMs: run.capabilityExpiresAtMs ?? null,
    rendererImplementationFingerprint: run.rendererImplementationFingerprint,
    mimeImplementationFingerprint: run.mimeImplementationFingerprint,
    subject: run.message.subject, plainText: run.message.plainText, html: run.message.html,
    previewLinksOnly: true, maximumProviderAttempts: 1,
    providerMessageId: run.providerMessageId || null,
  };
}

export async function readWarmReconnectQaForOwner(uid: string, db: Firestore = getAdminDb()) {
  const access = await assertOwner(uid, db);
  const snapshot = await db.collection(WARM_RECONNECT_QA_COLLECTIONS.runs).doc(runId(access.workspaceId)).get();
  if (!snapshot.exists) return { testMode: true as const, status: "not_prepared" as const };
  const run = snapshot.data() as QaRun;
  assertFrozenRun(run, uid, access.workspaceId);
  const state = await db.collection(WARM_RECONNECT_QA_COLLECTIONS.choices).doc(snapshot.id).get();
  const stored = state.data() as QaState | undefined;
  return {
    ...review(run),
    qaPreferenceState: stored ? {
      topics: { rosser_gallery: stored.topics?.rosser_gallery === true, rt_solutions: stored.topics?.rt_solutions === true },
      globallyUnsubscribed: stored.globallyUnsubscribed === true,
      confirmations: Number.isSafeInteger(stored.confirmations) && stored.confirmations >= 0 ? stored.confirmations : 0,
    } : null,
  };
}

/** Freeze placeholder-based content for owner review; no capability or provider action. */
export async function prepareWarmReconnectQa(input: {
  uid: string; recipient: string; log: Logger; db?: Firestore; now?: number;
}) {
  const recipient = typeof input.recipient === "string" ? input.recipient.trim().toLowerCase() : "";
  if (!isWarmReconnectQaRecipient(recipient)) throw new ApiError(400, "The test recipient is fixed.");
  const db = input.db || getAdminDb();
  const access = await assertOwner(input.uid, db);
  const ref = db.collection(WARM_RECONNECT_QA_COLLECTIONS.runs).doc(runId(access.workspaceId));
  const existing = await ref.get();
  if (existing.exists) {
    const run = existing.data() as QaRun;
    assertFrozenRun(run, input.uid, access.workspaceId);
    return { ...review(run), replayed: true };
  }
  const accountId = await assertGalleryAccount(input.uid);
  const summary = await loadPortfolioCrmSummaryForUid(input.uid, input.log, db);
  const campaign = buildWarmReconnectCampaignDraft(summary);
  const origin = publicOrigin();
  const preferencesUrl = `${origin}/preferences#token=${PREVIEW_PREFERENCE_TOKEN}&mode=qa`;
  const unsubscribeUrl = `${origin}/api/crm/warm-reconnect/qa/unsubscribe/${PREVIEW_UNSUBSCRIBE_TOKEN}`;
  const rendered = renderWarmReconnectEmail({
    purpose: "owner_qa", campaign,
    contentMode: "preference_buttons", firstName: "Marcus", senderName: "Marcus Rosser",
    legalEntity: "Marcus Rosser / Rosser Gallery", physicalPostalAddress: "2505 N Tonti St, New Orleans, LA 70117",
    preferencesUrl, unsubscribeUrl, publicOrigin: origin,
  });
  const message: WarmReconnectCampaignMessage = {
    purpose: "owner_qa", contentMode: "preference_buttons", to: recipient,
    from: ROSSER_GALLERY_SENDING_EMAIL, senderName: "Marcus Rosser", replyTo: ROSSER_GALLERY_SENDING_EMAIL,
    subject: WARM_RECONNECT_QA_SUBJECT, plainText: rendered.plainText, html: rendered.html,
    messageId: `<qa-${ref.id}@rossergallery.com>`, preferencesUrl, oneClickUnsubscribeUrl: unsubscribeUrl,
  };
  const implementations = {
    rendererImplementationFingerprint: warmReconnectRendererImplementationFingerprint(),
    mimeImplementationFingerprint: warmReconnectMimeImplementationFingerprint(),
  };
  const candidate: QaRun = {
    schemaVersion: 1, testId: TEST_ID, ownerUid: input.uid, workspaceId: access.workspaceId, accountId,
    status: "prepared", preparedAtMs: input.now ?? Date.now(), ...implementations,
    artifactFingerprint: artifactFingerprint({ message, accountId, ...implementations }), message,
  };
  assertFrozenRun(candidate, input.uid, access.workspaceId);
  return db.runTransaction(async (tx) => {
    const current = await tx.get(ref);
    if (current.exists) {
      const run = current.data() as QaRun;
      assertFrozenRun(run, input.uid, access.workspaceId);
      return { ...review(run), replayed: true };
    }
    tx.create(ref, candidate);
    return { ...review(candidate), replayed: false };
  });
}

/** Claim once before the provider call. Neither failures nor repeats may send again. */
export async function sendWarmReconnectQa(input: {
  uid: string; recipient: string; artifactFingerprint: string;
  confirmSendOneTest: true; db?: Firestore; now?: number;
}) {
  const recipient = typeof input.recipient === "string" ? input.recipient.trim().toLowerCase() : "";
  if (!isWarmReconnectQaRecipient(recipient) || input.confirmSendOneTest !== true) throw new ApiError(400, "Confirm the exact one-test recipient.");
  const db = input.db || getAdminDb();
  const access = await assertOwner(input.uid, db);
  const id = runId(access.workspaceId);
  const ref = db.collection(WARM_RECONNECT_QA_COLLECTIONS.runs).doc(id);
  const loaded = await ref.get();
  if (!loaded.exists) throw new ApiError(409, "Prepare and review the test first.");
  const run = loaded.data() as QaRun;
  assertFrozenRun(run, input.uid, access.workspaceId);
  if (run.message.to !== recipient) throw new ApiError(409, "Confirm the exact frozen test recipient.");
  if (run.artifactFingerprint !== input.artifactFingerprint) throw new ApiError(409, "Review the exact frozen test before sending.");
  if (run.status !== "prepared") return { ...review(run), replayed: true, providerAction: false };
  assertImplementationCurrent(run);
  const now = input.now ?? Date.now();
  if (now < run.preparedAtMs || now - run.preparedAtMs > PREPARATION_TTL_MS) throw new ApiError(409, "The test review has expired.");
  if (!isWarmReconnectProviderSendEnabled()) throw new ApiError(503, "Provider sending is disabled.");
  await assertGalleryAccount(input.uid, run.accountId);
  const accessToken = await getAccessTokenForUser(input.uid, undefined, { profileId: ROSSER_GALLERY_SENDING_PROFILE.profileId });
  await assertGalleryAccount(input.uid, run.accountId);
  if (!accessToken) throw new ApiError(409, "Gallery sending access is unavailable.");
  const preferenceToken = randomBytes(32).toString("base64url");
  const unsubscribeToken = randomBytes(32).toString("base64url");
  const substitute = (value: string) => value.replaceAll(PREVIEW_PREFERENCE_TOKEN, preferenceToken).replaceAll(PREVIEW_UNSUBSCRIBE_TOKEN, unsubscribeToken);
  const message: WarmReconnectCampaignMessage = {
    ...run.message, plainText: substitute(run.message.plainText), html: substitute(run.message.html),
    preferencesUrl: substitute(run.message.preferencesUrl), oneClickUnsubscribeUrl: substitute(run.message.oneClickUnsubscribeUrl),
  };
  buildWarmReconnectCampaignMime(message);
  const claimed = await db.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    const current = snapshot.data() as QaRun;
    assertFrozenRun(current, input.uid, access.workspaceId);
    assertImplementationCurrent(current);
    if (current.artifactFingerprint !== input.artifactFingerprint) throw new ApiError(409, "The reviewed artifact changed.");
    if (current.status !== "prepared") return false;
    if (!isWarmReconnectProviderSendEnabled()) throw new ApiError(503, "Provider sending is disabled.");
    for (const [token, scope] of [[preferenceToken, "preferences"], [unsubscribeToken, "unsubscribe_only"]] as const) {
      const document: QaToken = {
        schemaVersion: 1, purpose: "owner_qa", runId: id, scope,
        artifactFingerprint: current.artifactFingerprint, expiresAtMs: now + CAPABILITY_TTL_MS,
      };
      tx.create(db.collection(WARM_RECONNECT_QA_COLLECTIONS.tokens).doc(hash(token)), document);
    }
    tx.create(db.collection(WARM_RECONNECT_QA_COLLECTIONS.choices).doc(id), emptyState());
    tx.set(ref, {
      ...current, status: "provider_inflight", providerStartedAtMs: now,
      deliveredArtifactFingerprint: fingerprint(message), capabilityExpiresAtMs: now + CAPABILITY_TTL_MS,
    });
    return true;
  });
  if (!claimed) return { ...(await readWarmReconnectQaForOwner(input.uid, db)), replayed: true, providerAction: false };
  let sent: { id: string; threadId: string };
  try {
    // Shared sender performs one fetch, with no automatic retry. Do not log provider errors/content.
    sent = await sendWarmReconnectCampaignEmail(accessToken, message);
    if (!sent?.id || !sent?.threadId) throw new Error("Missing delivery evidence");
    await db.runTransaction(async (tx) => {
      const current = (await tx.get(ref)).data() as QaRun;
      if (current.status !== "provider_inflight") throw new Error("Unexpected QA state");
      tx.set(ref, { ...current, status: "sent", providerMessageId: sent.id, providerThreadId: sent.threadId, terminalAtMs: now });
    });
    return { testMode: true as const, status: "sent" as const, providerMessageId: sent.id, providerAction: true, replayed: false };
  } catch {
    // A provider error or failed receipt write is ambiguous. Persist unknown if possible;
    // even a failed persistence leaves the durable inflight claim blocking all retries.
    try {
      await db.runTransaction(async (tx) => {
        const current = (await tx.get(ref)).data() as QaRun;
        if (current.status === "provider_inflight") tx.set(ref, { ...current, status: "delivery_unknown", terminalAtMs: now });
      });
    } catch { /* durable provider_inflight claim remains terminal for sending */ }
    return { testMode: true as const, status: "delivery_unknown" as const, providerAction: true, replayed: false };
  }
}

function validTopics(topics: WarmReconnectTopics): boolean {
  return Boolean(topics && Object.keys(topics).sort().join(",") === "rosser_gallery,rt_solutions" &&
    typeof topics.rosser_gallery === "boolean" && typeof topics.rt_solutions === "boolean" &&
    (topics.rosser_gallery || topics.rt_solutions));
}

async function processQa(input: WarmReconnectQaMutation | { action: "one_click"; token: string }, db: Firestore, now: number) {
  if (!TOKEN_PATTERN.test(input.token)) return unavailable();
  const tokenDigest = hash(input.token);
  return db.runTransaction(async (tx) => {
    const tokenSnapshot = await tx.get(db.collection(WARM_RECONNECT_QA_COLLECTIONS.tokens).doc(tokenDigest));
    const token = tokenSnapshot.data() as QaToken | undefined;
    const requiredScope = input.action === "one_click" ? "unsubscribe_only" : "preferences";
    if (!token || token.schemaVersion !== 1 || token.purpose !== "owner_qa" || token.scope !== requiredScope ||
        !/^[a-f0-9]{64}$/.test(token.runId) || !Number.isSafeInteger(token.expiresAtMs)) return unavailable();
    const runSnapshot = await tx.get(db.collection(WARM_RECONNECT_QA_COLLECTIONS.runs).doc(token.runId));
    const run = runSnapshot.data() as QaRun | undefined;
    if (!run || run.testId !== TEST_ID || !["provider_inflight", "sent", "delivery_unknown"].includes(run.status) ||
        run.artifactFingerprint !== token.artifactFingerprint || !isWarmReconnectQaRecipient(run.message?.to)) return unavailable();
    try { assertFrozenRun(run, run.ownerUid, run.workspaceId); } catch { return unavailable(); }
    if (runId(run.workspaceId) !== token.runId) return unavailable();
    const stateRef = db.collection(WARM_RECONNECT_QA_COLLECTIONS.choices).doc(token.runId);
    const stateSnapshot = await tx.get(stateRef);
    let state = stateSnapshot.exists ? stateSnapshot.data() as QaState : emptyState();
    const expired = now >= token.expiresAtMs;
    const result = (): WarmReconnectQaPreferenceResult => ({
      ok: true, testMode: true, available: true, expired,
      canUpdatePreferences: !expired && !state.globallyUnsubscribed, canUnsubscribe: true,
      globallyUnsubscribed: state.globallyUnsubscribed, topics: state.topics,
      message: "Test choice recorded. No real newsletter subscription or contact permission changed.",
      ...(requiredScope === "preferences" ? { confirmationNonce: confirmationNonce(input.token) } : {}),
    });
    if (input.action === "inspect") return result(); // no writes, including nonce generation
    if (input.action === "one_click") {
      if (!state.globallyUnsubscribed) {
        state = { ...state, topics: emptyState().topics, globallyUnsubscribed: true };
        tx.set(stateRef, state);
      }
      return result();
    }
    if (!REQUEST_PATTERN.test(input.requestId) || input.confirmationNonce !== confirmationNonce(input.token)) return unavailable();
    if (input.action === "save_preferences" && !validTopics(input.topics)) return unavailable();
    if (state.globallyUnsubscribed || (input.action === "save_preferences" && expired)) return result();
    const requestRef = db.collection(WARM_RECONNECT_QA_COLLECTIONS.requests).doc(hash(`${token.runId}:${input.requestId}`));
    const requestSnapshot = await tx.get(requestRef);
    const requestFingerprint = fingerprint({ tokenDigest, action: input.action, ...(input.action === "save_preferences" ? { topics: input.topics } : {}) });
    if (requestSnapshot.exists) {
      if (requestSnapshot.data()?.requestFingerprint !== requestFingerprint) return unavailable();
      return result(); // never replay old choices over a newer choice
    }
    if (state.confirmations >= MAX_CONFIRMATIONS && input.action !== "unsubscribe") return unavailable();
    state = {
      topics: input.action === "unsubscribe" ? emptyState().topics : input.topics,
      globallyUnsubscribed: input.action === "unsubscribe", confirmations: state.confirmations + 1,
    };
    tx.create(requestRef, { purpose: "owner_qa", runId: token.runId, requestFingerprint, recordedAtMs: now });
    tx.set(stateRef, state);
    return result();
  });
}

export async function processWarmReconnectQaPreference(input: WarmReconnectQaMutation, options: { db?: Firestore; now?: number } = {}) {
  return processQa(input, options.db || getAdminDb(), options.now ?? Date.now());
}
export async function unsubscribeWarmReconnectQaToken(token: string, options: { db?: Firestore; now?: number } = {}) {
  return processQa({ action: "one_click", token }, options.db || getAdminDb(), options.now ?? Date.now());
}
