import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase-admin";
import { computeDncEntryId } from "@/lib/outreach/dnc";
import {
  normalizeWarmReconnectEmail,
  warmReconnectEmailKey,
} from "@/lib/crm/warm-reconnect-dedupe";

export const WARM_RECONNECT_TOPICS = [
  "marcus_rosser_art",
  "rosser_gallery",
  "rt_solutions",
] as const;
export const WARM_RECONNECT_CAPABILITY_LIFETIME_DAYS = 90 as const;

export type WarmReconnectTopic = (typeof WARM_RECONNECT_TOPICS)[number];
export type WarmReconnectTopics = Record<WarmReconnectTopic, boolean>;
export type WarmReconnectTokenScope = "preferences" | "unsubscribe_only";

const COLLECTIONS = {
  tokens: "crm_preference_tokens",
  contactPoints: "crm_contact_points",
  preferences: "crm_contact_preferences",
  permissionEvents: "crm_permission_events",
  suppressions: "crm_suppressions",
  legacyDnc: "lead_run_org_dnc",
  pilots: "crm_warm_reconnect_pilots",
} as const;

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43,128}$/;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9_.:-]{1,160}$/;
const GENERIC_MESSAGE =
  "If this preference link is available, your request has been processed.";

type PreferenceTokenDocument = {
  schemaVersion: 1;
  scope: WarmReconnectTokenScope;
  workspaceId: string;
  personId: string;
  contactPointId: string;
  emailKey: string;
  legacyDncOrgId: string;
  pilotId: string;
  recipientId: string;
  recipientDecisionId: string;
  campaignApprovalId: string;
  audienceFingerprint: string;
  artifactFingerprint: string;
  actionFingerprint: string;
  capabilityExpiresAtMs: number;
};

type PreferenceStateDocument = {
  topics?: Partial<WarmReconnectTopics>;
  globallyUnsubscribed?: boolean;
};

export type WarmReconnectPreferenceResult = {
  ok: true;
  message: string;
  available: boolean;
  expired: boolean;
  canUpdatePreferences: boolean;
  canUnsubscribe: boolean;
  globallyUnsubscribed: boolean;
  topics: WarmReconnectTopics;
};

export type WarmReconnectPreferenceMutation =
  | { action: "inspect"; token: string }
  | {
      action: "save_preferences";
      token: string;
      requestId: string;
      topics: WarmReconnectTopics;
    }
  | { action: "unsubscribe"; token: string };

export type WarmReconnectCapabilityIssueInput = {
  workspaceId: string;
  personId: string;
  contactPointId: string;
  emailKey: string;
  legacyDncOrgId: string;
  pilotId: string;
  recipientId: string;
  recipientDecisionId: string;
  campaignApprovalId: string;
  audienceFingerprint: string;
  artifactFingerprint: string;
  actionFingerprint: string;
  capabilityExpiresAtMs: number;
};

export type WarmReconnectIssuedCapabilities = {
  preferenceToken: string;
  unsubscribeOnlyToken: string;
  preferenceFragment: string;
  oneClickPath: string;
};

function emptyTopics(): WarmReconnectTopics {
  return {
    marcus_rosser_art: false,
    rosser_gallery: false,
    rt_solutions: false,
  };
}

function normalizeTopics(value: unknown): WarmReconnectTopics {
  const source = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    marcus_rosser_art: source.marcus_rosser_art === true,
    rosser_gallery: source.rosser_gallery === true,
    rt_solutions: source.rt_solutions === true,
  };
}

function genericResult(): WarmReconnectPreferenceResult {
  return {
    ok: true,
    message: GENERIC_MESSAGE,
    available: false,
    expired: false,
    canUpdatePreferences: false,
    canUnsubscribe: false,
    globallyUnsubscribed: false,
    topics: emptyTopics(),
  };
}

function validIdentifier(value: unknown): value is string {
  return typeof value === "string" && IDENTIFIER_PATTERN.test(value);
}

function parseTokenDocument(value: unknown): PreferenceTokenDocument | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  const scope = candidate.scope;
  if (candidate.schemaVersion !== 1) return null;
  if (scope !== "preferences" && scope !== "unsubscribe_only") return null;
  if (
    !validIdentifier(candidate.workspaceId) ||
    !validIdentifier(candidate.personId) ||
    !validIdentifier(candidate.contactPointId) ||
    !validIdentifier(candidate.legacyDncOrgId) ||
    !validIdentifier(candidate.pilotId) ||
    !validIdentifier(candidate.recipientId) ||
    !validIdentifier(candidate.recipientDecisionId) ||
    !validIdentifier(candidate.campaignApprovalId) ||
    typeof candidate.emailKey !== "string" ||
    !/^sha256:[a-f0-9]{64}$/.test(candidate.emailKey) ||
    typeof candidate.audienceFingerprint !== "string" ||
    typeof candidate.artifactFingerprint !== "string" ||
    typeof candidate.actionFingerprint !== "string" ||
    !/^sha256:[a-f0-9]{64}$/.test(candidate.audienceFingerprint) ||
    !/^sha256:[a-f0-9]{64}$/.test(candidate.artifactFingerprint) ||
    !/^sha256:[a-f0-9]{64}$/.test(candidate.actionFingerprint) ||
    !Number.isSafeInteger(candidate.capabilityExpiresAtMs) ||
    Number(candidate.capabilityExpiresAtMs) <= 0
  ) {
    return null;
  }
  return candidate as PreferenceTokenDocument;
}

function safeRawToken(value: string): string | null {
  const normalized = String(value || "").trim();
  return TOKEN_PATTERN.test(normalized) ? normalized : null;
}

export function digestWarmReconnectToken(rawToken: string): string {
  const token = safeRawToken(rawToken);
  if (!token) throw new Error("Invalid preference capability.");
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function preferenceId(token: PreferenceTokenDocument): string {
  return createHash("sha256")
    .update(`preference:${token.workspaceId}:${token.contactPointId}`)
    .digest("hex")
    .slice(0, 40);
}

function suppressionId(token: PreferenceTokenDocument): string {
  return createHash("sha256")
    .update(`suppression:${token.workspaceId}:${token.contactPointId}:email:global`)
    .digest("hex")
    .slice(0, 40);
}

function permissionEventId(parts: string[]): string {
  return createHash("sha256").update(parts.join(":"), "utf8").digest("hex").slice(0, 40);
}

function preferenceRequestFingerprint(
  tokenDigest: string,
  requestId: string,
  topics: WarmReconnectTopics
): string {
  return `sha256:${createHash("sha256")
    .update(
      `warm-reconnect-preference-request.v1:${tokenDigest}:${requestId}:${JSON.stringify(topics)}`,
      "utf8"
    )
    .digest("hex")}`;
}

function currentPilotAuthorizesCapability(
  value: unknown,
  input: WarmReconnectCapabilityIssueInput,
  issuedAtMs: number
): boolean {
  if (!value || typeof value !== "object") return false;
  const pilot = value as Record<string, unknown>;
  const approval =
    pilot.approval && typeof pilot.approval === "object"
      ? (pilot.approval as Record<string, unknown>)
      : null;
  const fingerprints =
    pilot.fingerprints && typeof pilot.fingerprints === "object"
      ? (pilot.fingerprints as Record<string, unknown>)
      : null;
  const recipients = Array.isArray(pilot.recipients)
    ? (pilot.recipients as Array<Record<string, unknown>>)
    : [];
  const recipient = recipients.find((candidate) => candidate.recipientId === input.recipientId);
  const decision =
    recipient?.decision && typeof recipient.decision === "object"
      ? (recipient.decision as Record<string, unknown>)
      : null;
  const approvalExpiresAt =
    typeof approval?.expiresAt === "string" ? Date.parse(approval.expiresAt) : Number.NaN;

  return Boolean(
    pilot.pilotId === input.pilotId &&
      pilot.workspaceId === input.workspaceId &&
      pilot.legacyDncOrgId === input.legacyDncOrgId &&
      pilot.status === "launch_requested" &&
      typeof pilot.launchRequestedAt === "string" &&
      Number.isFinite(Date.parse(pilot.launchRequestedAt)) &&
      Date.parse(pilot.launchRequestedAt) <= issuedAtMs &&
      approval?.decision === "approved" &&
      approval.approvalId === input.campaignApprovalId &&
      Number.isFinite(approvalExpiresAt) &&
      approvalExpiresAt > issuedAtMs &&
      fingerprints?.artifactFingerprint === input.artifactFingerprint &&
      fingerprints?.audienceFingerprint === input.audienceFingerprint &&
      fingerprints?.actionFingerprint === input.actionFingerprint &&
      approval.artifactFingerprint === input.artifactFingerprint &&
      approval.audienceFingerprint === input.audienceFingerprint &&
      approval.actionFingerprint === input.actionFingerprint &&
      recipient?.personId === input.personId &&
      recipient?.contactPointId === input.contactPointId &&
      recipient?.emailKey === input.emailKey &&
      decision?.status === "eligible_one_time_reconnection" &&
      decision.decisionId === input.recipientDecisionId &&
      decision.relationshipAttested === true
  );
}

function contactMatchesToken(
  data: Record<string, unknown>,
  token: PreferenceTokenDocument
): boolean {
  const contactPersonId = [data.personId, data.crmPersonId, data.personRef]
    .find((value) => typeof value === "string" && value.trim());
  const candidate =
    typeof data.normalizedValue === "string" && data.normalizedValue.trim()
      ? data.normalizedValue
      : data.value;
  const email = typeof candidate === "string" ? normalizeWarmReconnectEmail(candidate) : null;
  return (
    data.workspaceId === token.workspaceId &&
    typeof contactPersonId === "string" &&
    contactPersonId.trim() === token.personId &&
    data.type === "email" &&
    Boolean(email) &&
    warmReconnectEmailKey(token.workspaceId, email!) === token.emailKey
  );
}

function normalizedContactEmail(data: Record<string, unknown>): string | null {
  const candidate =
    typeof data.normalizedValue === "string" && data.normalizedValue.trim()
      ? data.normalizedValue
      : data.value;
  if (typeof candidate !== "string") return null;
  const normalized = normalizeWarmReconnectEmail(candidate);
  return normalized && normalized.includes("@") && normalized.length <= 320 ? normalized : null;
}

function tokenRef(db: Firestore, digest: string) {
  return db.collection(COLLECTIONS.tokens).doc(digest);
}

function preferenceRef(db: Firestore, token: PreferenceTokenDocument) {
  return db.collection(COLLECTIONS.preferences).doc(preferenceId(token));
}

function suppressionRef(db: Firestore, token: PreferenceTokenDocument) {
  return db.collection(COLLECTIONS.suppressions).doc(suppressionId(token));
}

function contactRef(db: Firestore, token: PreferenceTokenDocument) {
  return db.collection(COLLECTIONS.contactPoints).doc(token.contactPointId);
}

function legacyDncRef(db: Firestore, token: PreferenceTokenDocument, normalizedEmail: string) {
  const entryId = computeDncEntryId("email", normalizedEmail);
  return db
    .collection(COLLECTIONS.legacyDnc)
    .doc(token.legacyDncOrgId)
    .collection("entries")
    .doc(entryId);
}

function nowMs(value?: number): number {
  return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : Date.now();
}

export async function issueWarmReconnectPreferenceCapabilities(
  input: WarmReconnectCapabilityIssueInput,
  db: Firestore = getAdminDb(),
  generateToken: () => string = () => randomBytes(32).toString("base64url")
): Promise<WarmReconnectIssuedCapabilities> {
  const issuedAtMs = Date.now();
  for (const value of [
    input.workspaceId,
    input.personId,
    input.contactPointId,
    input.legacyDncOrgId,
    input.pilotId,
    input.recipientId,
    input.recipientDecisionId,
    input.campaignApprovalId,
  ]) {
    if (!validIdentifier(value)) throw new Error("Invalid exact-recipient capability binding.");
  }
  if (
    !/^sha256:[a-f0-9]{64}$/.test(input.emailKey) ||
    !/^sha256:[a-f0-9]{64}$/.test(input.audienceFingerprint) ||
    !/^sha256:[a-f0-9]{64}$/.test(input.artifactFingerprint) ||
    !/^sha256:[a-f0-9]{64}$/.test(input.actionFingerprint) ||
    !Number.isSafeInteger(input.capabilityExpiresAtMs) ||
    input.capabilityExpiresAtMs <= issuedAtMs + 24 * 60 * 60 * 1_000 ||
    input.capabilityExpiresAtMs >
      issuedAtMs + WARM_RECONNECT_CAPABILITY_LIFETIME_DAYS * 24 * 60 * 60 * 1_000
  ) {
    throw new Error("Invalid approved-pilot capability binding.");
  }

  const preferenceToken = safeRawToken(generateToken());
  const unsubscribeOnlyToken = safeRawToken(generateToken());
  if (!preferenceToken || !unsubscribeOnlyToken || preferenceToken === unsubscribeOnlyToken) {
    throw new Error("Secure capability generation failed.");
  }
  const preferenceDigest = digestWarmReconnectToken(preferenceToken);
  const unsubscribeDigest = digestWarmReconnectToken(unsubscribeOnlyToken);
  const common = {
    schemaVersion: 1 as const,
    workspaceId: input.workspaceId,
    personId: input.personId,
    contactPointId: input.contactPointId,
    emailKey: input.emailKey,
    legacyDncOrgId: input.legacyDncOrgId,
    pilotId: input.pilotId,
    recipientId: input.recipientId,
    recipientDecisionId: input.recipientDecisionId,
    campaignApprovalId: input.campaignApprovalId,
    audienceFingerprint: input.audienceFingerprint,
    artifactFingerprint: input.artifactFingerprint,
    actionFingerprint: input.actionFingerprint,
    capabilityExpiresAtMs: input.capabilityExpiresAtMs,
  };

  await db.runTransaction(async (transaction) => {
    const pilotRef = db.collection(COLLECTIONS.pilots).doc(input.pilotId);
    const canonicalContactRef = db.collection(COLLECTIONS.contactPoints).doc(input.contactPointId);
    const [pilotSnapshot, contact] = await Promise.all([
      transaction.get(pilotRef),
      transaction.get(canonicalContactRef),
    ]);
    if (
      !pilotSnapshot.exists ||
      !currentPilotAuthorizesCapability(pilotSnapshot.data(), input, issuedAtMs)
    ) {
      throw new Error("Exact launched pilot approval could not be reconciled.");
    }
    const contactData = contact.data() || {};
    if (!contact.exists || !contactMatchesToken(contactData, { ...common, scope: "preferences" })) {
      throw new Error("Exact pilot recipient could not be reconciled.");
    }
    const preferenceCapabilityRef = tokenRef(db, preferenceDigest);
    const unsubscribeCapabilityRef = tokenRef(db, unsubscribeDigest);
    const [existingPreference, existingUnsubscribe] = await Promise.all([
      transaction.get(preferenceCapabilityRef),
      transaction.get(unsubscribeCapabilityRef),
    ]);
    if (existingPreference.exists || existingUnsubscribe.exists) {
      throw new Error("Secure capability generation collided.");
    }
    transaction.create(preferenceCapabilityRef, {
      ...common,
      scope: "preferences",
      createdAt: FieldValue.serverTimestamp(),
    });
    transaction.create(unsubscribeCapabilityRef, {
      ...common,
      scope: "unsubscribe_only",
      createdAt: FieldValue.serverTimestamp(),
    });
  });

  return {
    preferenceToken,
    unsubscribeOnlyToken,
    preferenceFragment: `/preferences#token=${preferenceToken}`,
    // RFC 8058 requires the down-scoped capability in the HTTPS path. The raw
    // value is never application-logged/stored, but platform access logs may
    // observe this path. Human preference capabilities remain fragment/body-only.
    oneClickPath: `/api/crm/warm-reconnect/unsubscribe/${unsubscribeOnlyToken}`,
  };
}

async function inspectPreferences(
  rawToken: string,
  db: Firestore,
  observedNowMs: number
): Promise<WarmReconnectPreferenceResult> {
  const token = safeRawToken(rawToken);
  if (!token) return genericResult();
  const digest = digestWarmReconnectToken(token);
  const tokenSnapshot = await tokenRef(db, digest).get();
  const tokenDocument = parseTokenDocument(tokenSnapshot.data());
  if (!tokenSnapshot.exists || !tokenDocument || tokenDocument.scope !== "preferences") {
    return genericResult();
  }

  const [contactSnapshot, stateSnapshot, suppressionSnapshot] = await Promise.all([
    contactRef(db, tokenDocument).get(),
    preferenceRef(db, tokenDocument).get(),
    suppressionRef(db, tokenDocument).get(),
  ]);
  const contactData = contactSnapshot.data() || {};
  if (!contactSnapshot.exists || !contactMatchesToken(contactData, tokenDocument)) {
    return genericResult();
  }
  const state = (stateSnapshot.data() || {}) as PreferenceStateDocument;
  const globallyUnsubscribed = suppressionSnapshot.exists || state.globallyUnsubscribed === true;
  const expired = tokenDocument.capabilityExpiresAtMs <= observedNowMs;
  return {
    ok: true,
    message: GENERIC_MESSAGE,
    available: true,
    expired,
    canUpdatePreferences: !expired && !globallyUnsubscribed,
    canUnsubscribe: true,
    globallyUnsubscribed,
    topics: globallyUnsubscribed ? emptyTopics() : normalizeTopics(state.topics),
  };
}

async function savePreferences(
  mutation: Extract<WarmReconnectPreferenceMutation, { action: "save_preferences" }>,
  db: Firestore,
  observedNowMs: number
): Promise<WarmReconnectPreferenceResult> {
  const rawToken = safeRawToken(mutation.token);
  if (!rawToken || !IDENTIFIER_PATTERN.test(mutation.requestId)) return genericResult();
  const digest = digestWarmReconnectToken(rawToken);
  const requestedTopics = normalizeTopics(mutation.topics);
  if (!Object.values(requestedTopics).some(Boolean)) return genericResult();

  let outcome = genericResult();
  await db.runTransaction(async (transaction) => {
    const tokenDocumentRef = tokenRef(db, digest);
    const tokenSnapshot = await transaction.get(tokenDocumentRef);
    const tokenDocument = parseTokenDocument(tokenSnapshot.data());
    if (!tokenSnapshot.exists || !tokenDocument || tokenDocument.scope !== "preferences") return;

    const canonicalContactRef = contactRef(db, tokenDocument);
    const stateRef = preferenceRef(db, tokenDocument);
    const stickySuppressionRef = suppressionRef(db, tokenDocument);
    const eventRef = db.collection(COLLECTIONS.permissionEvents).doc(
      permissionEventId([
        "warm-reconnect-preferences",
        tokenDocument.workspaceId,
        tokenDocument.contactPointId,
        digest,
        mutation.requestId,
      ])
    );
    const requestFingerprint = preferenceRequestFingerprint(
      digest,
      mutation.requestId,
      requestedTopics
    );
    const [contactSnapshot, stateSnapshot, suppressionSnapshot, eventSnapshot] =
      await Promise.all([
        transaction.get(canonicalContactRef),
        transaction.get(stateRef),
        transaction.get(stickySuppressionRef),
        transaction.get(eventRef),
      ]);
    const contactData = contactSnapshot.data() || {};
    if (!contactSnapshot.exists || !contactMatchesToken(contactData, tokenDocument)) return;
    const expired = tokenDocument.capabilityExpiresAtMs <= observedNowMs;
    const suppressed = suppressionSnapshot.exists;
    if (expired || suppressed) {
      outcome = {
        ...genericResult(),
        available: true,
        expired,
        canUnsubscribe: true,
        globallyUnsubscribed: suppressed,
      };
      return;
    }

    if (eventSnapshot.exists) {
      if (eventSnapshot.data()?.requestFingerprint !== requestFingerprint) return;
      outcome = {
        ok: true,
        message: "Your email choices have been saved.",
        available: true,
        expired: false,
        canUpdatePreferences: true,
        canUnsubscribe: true,
        globallyUnsubscribed: false,
        topics: requestedTopics,
      };
      return;
    }

    const timestamp = FieldValue.serverTimestamp();
    transaction.create(eventRef, {
      schemaVersion: 1,
      workspaceId: tokenDocument.workspaceId,
      personId: tokenDocument.personId,
      contactPointId: tokenDocument.contactPointId,
      channel: "email",
      eventType: "preferences_updated",
      permissionState: "topic_opted_in",
      topics: requestedTopics,
      source: "recipient_preference_center",
      requestFingerprint,
      pilotId: tokenDocument.pilotId,
      campaignApprovalId: tokenDocument.campaignApprovalId,
      recipientId: tokenDocument.recipientId,
      recipientDecisionId: tokenDocument.recipientDecisionId,
      audienceFingerprint: tokenDocument.audienceFingerprint,
      artifactFingerprint: tokenDocument.artifactFingerprint,
      actionFingerprint: tokenDocument.actionFingerprint,
      preferenceContractVersion: "warm-reconnect-preferences.v1",
      occurredAt: timestamp,
    });
    transaction.set(
      stateRef,
      {
        schemaVersion: 1,
        workspaceId: tokenDocument.workspaceId,
        personId: tokenDocument.personId,
        contactPointId: tokenDocument.contactPointId,
        topics: requestedTopics,
        globallyUnsubscribed: false,
        updatedAt: timestamp,
        createdAt: stateSnapshot.exists
          ? stateSnapshot.data()?.createdAt || timestamp
          : timestamp,
      },
      { merge: true }
    );
    // Topic choices are intentionally not promoted to the contact point's
    // global default permission. Future sends must evaluate the topic ledger.
    outcome = {
      ok: true,
      message: "Your email choices have been saved.",
      available: true,
      expired: false,
      canUpdatePreferences: true,
      canUnsubscribe: true,
      globallyUnsubscribed: false,
      topics: requestedTopics,
    };
  });
  return outcome;
}

export async function globallyUnsubscribeWarmReconnectCapability(
  rawToken: string,
  options: {
    requiredScope?: WarmReconnectTokenScope;
    db?: Firestore;
    observedNowMs?: number;
  } = {}
): Promise<WarmReconnectPreferenceResult> {
  const token = safeRawToken(rawToken);
  if (!token) return genericResult();
  const db = options.db || getAdminDb();
  const digest = digestWarmReconnectToken(token);
  let outcome = genericResult();

  await db.runTransaction(async (transaction) => {
    const tokenDocumentRef = tokenRef(db, digest);
    const tokenSnapshot = await transaction.get(tokenDocumentRef);
    const tokenDocument = parseTokenDocument(tokenSnapshot.data());
    if (!tokenSnapshot.exists || !tokenDocument) return;
    if (options.requiredScope && tokenDocument.scope !== options.requiredScope) return;

    const canonicalContactRef = contactRef(db, tokenDocument);
    const stateRef = preferenceRef(db, tokenDocument);
    const stickySuppressionRef = suppressionRef(db, tokenDocument);
    const eventRef = db.collection(COLLECTIONS.permissionEvents).doc(
      permissionEventId([
        "warm-reconnect-unsubscribe",
        tokenDocument.workspaceId,
        tokenDocument.contactPointId,
        "email",
        "global",
      ])
    );
    const contactSnapshot = await transaction.get(canonicalContactRef);
    const contactData = contactSnapshot.data() || {};
    if (!contactSnapshot.exists || !contactMatchesToken(contactData, tokenDocument)) return;
    const normalizedEmail = normalizedContactEmail(contactData);
    if (!normalizedEmail || !validIdentifier(tokenDocument.legacyDncOrgId)) return;
    const legacyRef = legacyDncRef(db, tokenDocument, normalizedEmail);
    const [stateSnapshot, suppressionSnapshot, eventSnapshot, legacySnapshot] =
      await Promise.all([
        transaction.get(stateRef),
        transaction.get(stickySuppressionRef),
        transaction.get(eventRef),
        transaction.get(legacyRef),
      ]);

    if (
      eventSnapshot.exists &&
      suppressionSnapshot.exists &&
      (stateSnapshot.data() as PreferenceStateDocument | undefined)
        ?.globallyUnsubscribed === true &&
      legacySnapshot.exists &&
      contactData.defaultPermissionState === "opted_out"
    ) {
      outcome = {
        ok: true,
        message: "You have been unsubscribed from promotional email.",
        available: true,
        expired: tokenDocument.capabilityExpiresAtMs <= nowMs(options.observedNowMs),
        canUpdatePreferences: false,
        canUnsubscribe: true,
        globallyUnsubscribed: true,
        topics: emptyTopics(),
      };
      return;
    }

    const timestamp = FieldValue.serverTimestamp();
    if (!eventSnapshot.exists) {
      transaction.create(eventRef, {
        schemaVersion: 1,
        workspaceId: tokenDocument.workspaceId,
        personId: tokenDocument.personId,
        contactPointId: tokenDocument.contactPointId,
        channel: "email",
        eventType: "unsubscribed",
        permissionState: "opted_out",
        scope: "global",
        source: "recipient_preference_center",
        pilotId: tokenDocument.pilotId,
        campaignApprovalId: tokenDocument.campaignApprovalId,
        recipientId: tokenDocument.recipientId,
        recipientDecisionId: tokenDocument.recipientDecisionId,
        audienceFingerprint: tokenDocument.audienceFingerprint,
        artifactFingerprint: tokenDocument.artifactFingerprint,
        actionFingerprint: tokenDocument.actionFingerprint,
        preferenceContractVersion: "warm-reconnect-preferences.v1",
        occurredAt: timestamp,
      });
    }
    transaction.set(
      stickySuppressionRef,
      {
        schemaVersion: 1,
        workspaceId: tokenDocument.workspaceId,
        personId: tokenDocument.personId,
        contactPointId: tokenDocument.contactPointId,
        channel: "email",
        scope: "global",
        state: "suppressed",
        reason: "recipient_unsubscribe",
        source: "recipient_preference_center",
        createdAt: suppressionSnapshot.exists
          ? suppressionSnapshot.data()?.createdAt || timestamp
          : timestamp,
        updatedAt: timestamp,
      },
      { merge: true }
    );
    transaction.set(
      stateRef,
      {
        schemaVersion: 1,
        workspaceId: tokenDocument.workspaceId,
        personId: tokenDocument.personId,
        contactPointId: tokenDocument.contactPointId,
        topics: emptyTopics(),
        globallyUnsubscribed: true,
        createdAt: stateSnapshot.exists
          ? stateSnapshot.data()?.createdAt || timestamp
          : timestamp,
        updatedAt: timestamp,
      },
      { merge: true }
    );
    transaction.set(
      canonicalContactRef,
      { defaultPermissionState: "opted_out", updatedAt: timestamp },
      { merge: true }
    );
    transaction.set(
      legacyRef,
      {
        type: "email",
        value: normalizedEmail,
        normalized: normalizedEmail,
        reason: "Recipient unsubscribed through warm reconnect preferences",
        createdBy: "recipient_preference_center",
        createdAt: legacySnapshot.exists
          ? legacySnapshot.data()?.createdAt || timestamp
          : timestamp,
        updatedAt: timestamp,
      },
      { merge: true }
    );
    outcome = {
      ok: true,
      message: "You have been unsubscribed from promotional email.",
      available: true,
      expired: tokenDocument.capabilityExpiresAtMs <= nowMs(options.observedNowMs),
      canUpdatePreferences: false,
      canUnsubscribe: true,
      globallyUnsubscribed: true,
      topics: emptyTopics(),
    };
  });
  return outcome;
}

export async function processWarmReconnectPreferenceMutation(
  mutation: WarmReconnectPreferenceMutation,
  options: { db?: Firestore; observedNowMs?: number } = {}
): Promise<WarmReconnectPreferenceResult> {
  const db = options.db || getAdminDb();
  const observedNowMs = nowMs(options.observedNowMs);
  if (mutation.action === "inspect") {
    return inspectPreferences(mutation.token, db, observedNowMs);
  }
  if (mutation.action === "save_preferences") {
    return savePreferences(mutation, db, observedNowMs);
  }
  return globallyUnsubscribeWarmReconnectCapability(mutation.token, {
    db,
    observedNowMs,
  });
}
