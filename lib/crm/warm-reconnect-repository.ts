import "server-only";

import { createHash, randomUUID } from "node:crypto";
import type {
  DocumentData,
  DocumentReference,
  Firestore,
  QueryDocumentSnapshot,
} from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { ApiError } from "@/lib/api/handler";
import { getAdminDb } from "@/lib/firebase-admin";
import type { Logger } from "@/lib/logging";
import {
  WARM_RECONNECT_ACTIVATION_SCHEMA_VERSION,
  WARM_RECONNECT_ALLOWED_GOOGLE_PROFILES,
  WARM_RECONNECT_APPROVAL_TTL_HOURS,
  WARM_RECONNECT_INITIAL_PILOT_SIZE,
  type CreateWarmReconnectPilotRequest,
  type WarmReconnectActivationResponse,
  type WarmReconnectCandidate,
  type WarmReconnectPilot,
  type WarmReconnectPilotApprovalRequest,
  type WarmReconnectPilotLaunchRequest,
  type WarmReconnectPilotStopRequest,
  type WarmReconnectPilotView,
  type WarmReconnectRecipientDecisionRequest,
  type WarmReconnectSourceEvidence,
} from "@/lib/crm/warm-reconnect-activation-types";
import {
  createWarmReconnectPilot,
  decideWarmReconnectPilotApproval,
  decideWarmReconnectRecipient,
  materializeWarmReconnectPilot,
  assertWarmReconnectStopBoundary,
  canReleaseWarmReconnectInitialPilotLock,
  isWarmReconnectPilotApprovalReplay,
  isWarmReconnectPilotLaunchReplay,
  isWarmReconnectPilotStopReplay,
  isWarmReconnectRecipientDecisionReplay,
  requestWarmReconnectPilotLaunch,
  stopWarmReconnectPilot,
  warmReconnectInitialPilotLockId,
} from "@/lib/crm/warm-reconnect-activation";
import {
  WARM_RECONNECT_INVITATION_LEDGER_COLLECTION,
  reconcileWarmReconnectInvitationTransition,
  warmReconnectInvitationReservationBindingForPilot,
} from "@/lib/crm/warm-reconnect-invitation-ledger";
import {
  dedupeWarmReconnectCandidates,
  normalizeWarmReconnectEmail,
  warmReconnectEmailKey,
  warmReconnectFingerprint,
  type WarmReconnectRawCandidate,
} from "@/lib/crm/warm-reconnect-dedupe";
import { assertPortfolioRegistryAccess } from "@/lib/crm/portfolio-registry";
import { resolveGoogleAccountTokens } from "@/lib/google/account-token-store";
import { isGoogleTokenScopeExactForPreset } from "@/lib/google/oauth";
import {
  WARM_RECONNECT_CAMPAIGN_ID,
  WARM_RECONNECT_CAMPAIGN_VERSION,
} from "@/lib/crm/warm-reconnect-types";

const COLLECTIONS = {
  people: "crm_people",
  contactPoints: "crm_contact_points",
  sourceRecords: "crm_source_records",
  suppressions: "crm_suppressions",
  permissionEvents: "crm_permission_events",
  importConflicts: "crm_import_conflicts",
  pilots: "crm_warm_reconnect_pilots",
  campaignLocks: "crm_warm_reconnect_campaign_locks",
} as const;

const MAX_CONTACT_POINT_SCAN = 500;
const MAX_PILOTS_RETURNED = 20;
const MAX_SOURCE_EVIDENCE_PER_CANDIDATE = 25;

type GoogleProfileState = WarmReconnectActivationResponse["googleProfiles"][number];

function asText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized || null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function timestampToIso(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
  }
  if (typeof value === "object" && value !== null) {
    const candidate = value as { toDate?: () => Date };
    try {
      return candidate.toDate?.().toISOString() || null;
    } catch {
      return null;
    }
  }
  return null;
}

function contactEmail(data: DocumentData): string | null {
  for (const key of ["normalizedValue", "email", "value", "address"]) {
    const value = asText(data[key]);
    if (value) return value;
  }
  return null;
}

function contactPersonId(data: DocumentData): string | null {
  return asText(data.personId) || asText(data.crmPersonId) || asText(data.personRef);
}

function personDisplayName(data: DocumentData): string {
  const direct = asText(data.displayName) || asText(data.name) || asText(data.fullName);
  if (direct) return direct.slice(0, 160);
  const composed = [asText(data.firstName), asText(data.lastName)].filter(Boolean).join(" ");
  return composed.slice(0, 160) || "Contact";
}

function sourcePersonIds(data: DocumentData): string[] {
  return [
    asText(data.personId),
    asText(data.crmPersonId),
    ...asStringArray(data.personIds),
  ].filter((value): value is string => Boolean(value));
}

export function sourceEvidenceFromDoc(
  snapshot: QueryDocumentSnapshot<DocumentData>
): WarmReconnectSourceEvidence {
  const data = snapshot.data();
  const sourceSystem = asText(data.sourceSystem) || "other";
  const permissionBasis = asText(data.permissionBasis) || "none";
  if (
    !/^[A-Za-z0-9_.:-]{1,160}$/.test(snapshot.id) ||
    !/^[A-Za-z0-9_.: -]{1,80}$/.test(sourceSystem) ||
    permissionBasis.length > 160 ||
    /[\0\r\n]/.test(permissionBasis)
  ) {
    throw new ApiError(
      409,
      "Source evidence contains an unsupported identifier or value. Reconcile the registry first."
    );
  }
  return {
    evidenceRef: `${COLLECTIONS.sourceRecords}/${snapshot.id}`,
    sourceSystem,
    permissionBasis,
    observedAt:
      timestampToIso(data.observedAt) ||
      timestampToIso(data.updatedAt) ||
      timestampToIso(data.createdAt),
  };
}

async function loadGoogleProfileStates(uid: string): Promise<GoogleProfileState[]> {
  return Promise.all(
    WARM_RECONNECT_ALLOWED_GOOGLE_PROFILES.map(async (profile) => {
      try {
        const resolution = await resolveGoogleAccountTokens(uid, profile.profileId);
        const tokens = resolution.record?.tokens || null;
        const connected = Boolean(tokens?.refreshToken || tokens?.accessToken);
        const gmailCapable = isGoogleTokenScopeExactForPreset(
          "gmail_send",
          tokens?.scope
        );
        const accountEmail = normalizeWarmReconnectEmail(tokens?.accountEmail || "");
        const ready = Boolean(connected && gmailCapable && accountEmail);
        return {
          ...profile,
          state: ready
            ? ("connected" as const)
            : resolution.profileMapped || connected
              ? ("reconnect_required" as const)
              : ("not_connected" as const),
          connected,
          gmailCapable,
          accountEmail,
        };
      } catch {
        return {
          ...profile,
          state: "unavailable" as const,
          connected: false,
          gmailCapable: false,
          accountEmail: null,
        };
      }
    })
  );
}

function googleReady(
  states: GoogleProfileState[],
  pilot: Pick<WarmReconnectPilot, "sender">
): boolean {
  const profile = states.find(
    (candidate) =>
      candidate.businessId === pilot.sender.businessId &&
      candidate.profileId === pilot.sender.profileId
  );
  return Boolean(
    profile?.connected &&
      profile.gmailCapable &&
      profile.accountEmail &&
      profile.accountEmail === pilot.sender.fromEmail
  );
}

async function loadCandidatePool(
  workspaceId: string,
  db: Firestore,
  legacyDncOrgId: string
): Promise<{
  candidates: WarmReconnectCandidate[];
  excludedCount: number;
  truncated: boolean;
}> {
  const contactSnapshot = await db
    .collection(COLLECTIONS.contactPoints)
    .where("workspaceId", "==", workspaceId)
    .where("type", "==", "email")
    .limit(MAX_CONTACT_POINT_SCAN + 1)
    .get();
  const contactDocs = contactSnapshot.docs.slice(0, MAX_CONTACT_POINT_SCAN);
  const truncated = contactSnapshot.docs.length > MAX_CONTACT_POINT_SCAN;
  const personIds = [...new Set(contactDocs.map((doc) => contactPersonId(doc.data())).filter(Boolean))] as string[];

  const peopleById = new Map<string, DocumentData>();
  const sourceByContact = new Map<string, QueryDocumentSnapshot<DocumentData>[]>();
  const sourceByPerson = new Map<string, QueryDocumentSnapshot<DocumentData>[]>();
  const suppressedKeys = new Set<string>();
  const suppressedContactPoints = new Set<string>();
  const suppressedPeople = new Set<string>();
  const legacyDncEmails = new Set<string>();
  const legacyDncDomains = new Set<string>();
  const permissionByContactPoint = new Map<string, { state: string; at: number; id: string }>();
  const permissionByPerson = new Map<string, { state: string; at: number; id: string }>();

  // Canonical references point to the person document id. Exact document reads
  // avoid a new composite index and keep the read plan bounded by the email scan.
  for (let offset = 0; offset < personIds.length; offset += 100) {
    const refs = personIds
      .slice(offset, offset + 100)
      .map((id) => db.collection(COLLECTIONS.people).doc(id));
    const snapshots = refs.length > 0 ? await db.getAll(...refs) : [];
    for (const snapshot of snapshots) {
      if (snapshot.exists) peopleById.set(snapshot.id, snapshot.data() || {});
    }
  }

  const sourceSnapshot = await db
    .collection(COLLECTIONS.sourceRecords)
    .where("workspaceId", "==", workspaceId)
    .limit(MAX_CONTACT_POINT_SCAN * 5 + 1)
    .get();
  if (sourceSnapshot.docs.length > MAX_CONTACT_POINT_SCAN * 5) {
    throw new ApiError(
      409,
      "Source evidence exceeded its bounded scan. Narrow or reconcile the registry first."
    );
  }
  for (const doc of sourceSnapshot.docs) {
    const data = doc.data();
    for (const contactPointId of [
      asText(data.contactPointId),
      ...asStringArray(data.contactPointIds),
    ].filter((value): value is string => Boolean(value))) {
      const values = sourceByContact.get(contactPointId) || [];
      if (values.length >= MAX_SOURCE_EVIDENCE_PER_CANDIDATE) {
        throw new ApiError(409, "A candidate has too much source evidence to review safely.");
      }
      values.push(doc);
      sourceByContact.set(contactPointId, values);
    }
    for (const personId of sourcePersonIds(data)) {
      const values = sourceByPerson.get(personId) || [];
      if (values.length >= MAX_SOURCE_EVIDENCE_PER_CANDIDATE) {
        throw new ApiError(409, "A candidate has too much source evidence to review safely.");
      }
      values.push(doc);
      sourceByPerson.set(personId, values);
    }
  }

  const suppressionSnapshot = await db
    .collection(COLLECTIONS.suppressions)
    .where("workspaceId", "==", workspaceId)
    .limit(MAX_CONTACT_POINT_SCAN * 2 + 1)
    .get();
  if (suppressionSnapshot.size > MAX_CONTACT_POINT_SCAN * 2) {
    throw new ApiError(409, "Suppression evidence exceeded its bounded scan.");
  }
  for (const doc of suppressionSnapshot.docs) {
    const data = doc.data();
    if (data.active === false || data.status === "inactive") continue;
    const storedKey = asText(data.emailKey) || asText(data.contactPointKey);
    if (storedKey) suppressedKeys.add(storedKey);
    for (const value of [
      asText(data.contactPointId),
      ...asStringArray(data.contactPointIds),
    ]) {
      if (value) suppressedContactPoints.add(value);
    }
    for (const value of sourcePersonIds(data)) suppressedPeople.add(value);
    const email = contactEmail(data);
    const normalized = email ? normalizeWarmReconnectEmail(email) : null;
    if (normalized) suppressedKeys.add(warmReconnectEmailKey(workspaceId, normalized));
  }

  const legacyDncSnapshot = await db
    .collection("lead_run_org_dnc")
    .doc(legacyDncOrgId)
    .collection("entries")
    .limit(MAX_CONTACT_POINT_SCAN * 2 + 1)
    .get();
  if (legacyDncSnapshot.size > MAX_CONTACT_POINT_SCAN * 2) {
    throw new ApiError(409, "Legacy suppression evidence exceeded its bounded scan.");
  }
  for (const doc of legacyDncSnapshot.docs) {
    const data = doc.data();
    const type = asText(data.type);
    const normalized = asText(data.normalized) || asText(data.value);
    if (!normalized) continue;
    if (type === "email") {
      const email = normalizeWarmReconnectEmail(normalized);
      if (email) legacyDncEmails.add(email);
    } else if (type === "domain") {
      const domain = normalized.toLowerCase().replace(/^@/, "").replace(/^www\./, "");
      if (/^[a-z0-9.-]+$/.test(domain)) legacyDncDomains.add(domain);
    }
  }

  const permissionSnapshot = await db
    .collection(COLLECTIONS.permissionEvents)
    .where("workspaceId", "==", workspaceId)
    .limit(MAX_CONTACT_POINT_SCAN * 10 + 1)
    .get();
  if (permissionSnapshot.size > MAX_CONTACT_POINT_SCAN * 10) {
    throw new ApiError(409, "Permission history exceeded its bounded scan.");
  }
  for (const doc of permissionSnapshot.docs) {
    const data = doc.data();
    const state =
      asText(data.permissionState) || asText(data.toState) || asText(data.state);
    if (!state) continue;
    const iso =
      timestampToIso(data.occurredAt) ||
      timestampToIso(data.updatedAt) ||
      timestampToIso(data.createdAt);
    const at = iso ? Date.parse(iso) : Number.NEGATIVE_INFINITY;
    const event = { state, at, id: doc.id };
    const setLatest = (
      map: Map<string, { state: string; at: number; id: string }>,
      key: string
    ) => {
      const existing = map.get(key);
      if (!existing || event.at > existing.at || (event.at === existing.at && event.id > existing.id)) {
        map.set(key, event);
      }
    };
    for (const value of [
      asText(data.contactPointId),
      ...asStringArray(data.contactPointIds),
    ]) {
      if (value) setLatest(permissionByContactPoint, value);
    }
    for (const value of sourcePersonIds(data)) setLatest(permissionByPerson, value);
  }

  const openConflictSnapshot = await db
    .collection(COLLECTIONS.importConflicts)
    .where("workspaceId", "==", workspaceId)
    .where("status", "==", "open")
    .limit(MAX_CONTACT_POINT_SCAN * 2 + 1)
    .get();
  if (openConflictSnapshot.size > MAX_CONTACT_POINT_SCAN * 2) {
    throw new ApiError(409, "Import conflicts exceeded their bounded scan.");
  }
  const conflictedContactPoints = new Set<string>();
  const conflictedPeople = new Set<string>();
  for (const doc of openConflictSnapshot.docs) {
    const data = doc.data();
    for (const value of [
      asText(data.contactPointId),
      ...asStringArray(data.contactPointIds),
    ]) {
      if (value) conflictedContactPoints.add(value);
    }
    for (const value of sourcePersonIds(data)) conflictedPeople.add(value);
  }

  const raw: WarmReconnectRawCandidate[] = contactDocs.map((doc) => {
    const data = doc.data();
    const personId = contactPersonId(data);
    const sources = [
      ...(sourceByContact.get(doc.id) || []),
      ...(personId ? sourceByPerson.get(personId) || [] : []),
    ];
    const uniqueSources = [...new Map(sources.map((source) => [source.id, source])).values()];
    if (uniqueSources.length > MAX_SOURCE_EVIDENCE_PER_CANDIDATE) {
      throw new ApiError(409, "A candidate has too much source evidence to review safely.");
    }
    const email = contactEmail(data);
    const normalized = email ? normalizeWarmReconnectEmail(email) : null;
    const emailKey = normalized ? warmReconnectEmailKey(workspaceId, normalized) : null;
    const emailDomain = normalized?.split("@")[1] || null;
    const legacyDncMatch = Boolean(
      normalized &&
        (legacyDncEmails.has(normalized) ||
          (emailDomain &&
            [...legacyDncDomains].some(
              (domain) => emailDomain === domain || emailDomain.endsWith(`.${domain}`)
            )))
    );
    return {
      contactPointId: doc.id,
      personId,
      displayName: personId ? personDisplayName(peopleById.get(personId) || {}) : null,
      email,
      permissionState:
        permissionByContactPoint.get(doc.id)?.state ||
        (personId ? permissionByPerson.get(personId)?.state : null) ||
        asText(data.defaultPermissionState) ||
        "unknown",
      primary: data.primary === true || data.isPrimary === true,
      evidenceUpdatedAt:
        timestampToIso(data.permissionUpdatedAt) ||
        timestampToIso(data.updatedAt) ||
        timestampToIso(data.createdAt),
      sourceEvidence: uniqueSources.map(sourceEvidenceFromDoc),
      sourcePersonIds: [
        ...new Set(uniqueSources.flatMap((source) => sourcePersonIds(source.data()))),
      ],
      suppressed: Boolean(
          data.suppressed === true ||
          permissionByContactPoint.get(doc.id)?.state === "opted_out" ||
          (personId && permissionByPerson.get(personId)?.state === "opted_out") ||
          data.defaultPermissionState === "opted_out" ||
          suppressedContactPoints.has(doc.id) ||
          (personId && suppressedPeople.has(personId)) ||
          legacyDncMatch ||
          (emailKey && suppressedKeys.has(emailKey))
      ),
      openImportConflict: Boolean(
        conflictedContactPoints.has(doc.id) ||
          (personId && conflictedPeople.has(personId))
      ),
    };
  });
  const result = dedupeWarmReconnectCandidates(workspaceId, raw);
  return {
    candidates: result.candidates,
    excludedCount: result.excluded.length,
    truncated,
  };
}

function pilotRef(db: Firestore, pilotId: string): DocumentReference<DocumentData> {
  return db.collection(COLLECTIONS.pilots).doc(pilotId);
}

function pilotFromSnapshot(snapshot: { exists: boolean; data: () => DocumentData | undefined }): WarmReconnectPilot {
  if (!snapshot.exists) throw new ApiError(404, "Warm reconnect pilot not found.");
  const pilot = snapshot.data() as WarmReconnectPilot | undefined;
  if (!pilot || pilot.schemaVersion !== "crm.warm-reconnect-pilot.v1") {
    throw new ApiError(409, "Warm reconnect pilot schema could not be reconciled.");
  }
  return pilot;
}

async function hydratePilotView(
  pilot: WarmReconnectPilot,
  db: Firestore
): Promise<WarmReconnectPilotView> {
  const personRefs = pilot.recipients.map((recipient) =>
    db.collection(COLLECTIONS.people).doc(recipient.personId)
  );
  const contactRefs = pilot.recipients.map((recipient) =>
    db.collection(COLLECTIONS.contactPoints).doc(recipient.contactPointId)
  );
  const [people, contacts] = await Promise.all([
    personRefs.length ? db.getAll(...personRefs) : [],
    contactRefs.length ? db.getAll(...contactRefs) : [],
  ]);
  const peopleById = new Map(people.map((doc) => [doc.id, doc.data() || {}]));
  const contactsById = new Map(contacts.map((doc) => [doc.id, doc.data() || {}]));
  const recipients = pilot.recipients.map((recipient) => {
    const contact = contactsById.get(recipient.contactPointId) || {};
    const normalized = normalizeWarmReconnectEmail(contactEmail(contact) || "");
    if (
      !normalized ||
      warmReconnectEmailKey(pilot.workspaceId, normalized) !== recipient.emailKey
    ) {
      return {
        ...recipient,
        displayName: personDisplayName(peopleById.get(recipient.personId) || {}),
        email: "Unavailable — source changed",
      };
    }
    return {
      ...recipient,
      displayName: personDisplayName(peopleById.get(recipient.personId) || {}),
      email: normalized,
    };
  });
  const {
    workspaceId: _workspaceId,
    ownerUid: _ownerUid,
    legacyDncOrgId: _legacyDncOrgId,
    recipients: _storedRecipients,
    ...publicPilot
  } = pilot;
  void _workspaceId;
  void _ownerUid;
  void _legacyDncOrgId;
  void _storedRecipients;
  return { ...publicPilot, recipients };
}

function assertOwnerAccess(
  uid: string,
  workspaceId: string,
  role: "owner" | "admin"
): void {
  if (role !== "owner" || !workspaceId || !uid) {
    throw new ApiError(403, "Only the exact portfolio workspace owner can control pilots.");
  }
}

async function loadOwnedPilot(
  uid: string,
  pilotId: string,
  db: Firestore
): Promise<{ pilot: WarmReconnectPilot; googleStates: GoogleProfileState[] }> {
  const access = await assertPortfolioRegistryAccess(uid, db);
  assertOwnerAccess(uid, access.workspaceId, access.role);
  const [snapshot, googleStates] = await Promise.all([
    pilotRef(db, pilotId).get(),
    loadGoogleProfileStates(uid),
  ]);
  const pilot = pilotFromSnapshot(snapshot);
  if (pilot.workspaceId !== access.workspaceId || pilot.ownerUid !== uid) {
    throw new ApiError(404, "Warm reconnect pilot not found.");
  }
  return { pilot, googleStates };
}

function createPilotId(workspaceId: string, idempotencyKey: string): string {
  return `wrp_${createHash("sha256")
    .update(`warm-reconnect-pilot:v1|${workspaceId}|${idempotencyKey}`)
    .digest("hex")
    .slice(0, 32)}`;
}

export function resolveWarmReconnectLegacyDncOrgId(
  uid: string,
  workspaceId: string
): string {
  const expected = `workspace_default_${String(uid || "").trim()}`;
  if (
    workspaceId !== expected ||
    !/^[A-Za-z0-9_-]{1,160}$/.test(workspaceId)
  ) {
    throw new ApiError(
      409,
      "The server-owned suppression workspace could not be reconciled."
    );
  }
  return workspaceId;
}

function initialPilotLockRef(db: Firestore, workspaceId: string) {
  return db
    .collection(COLLECTIONS.campaignLocks)
    .doc(warmReconnectInitialPilotLockId(workspaceId));
}

export function assertWarmReconnectInitialPilotLock(
  existing: DocumentData | undefined,
  proposedPilotId: string
): void {
  if (!existing) return;
  if (
    existing.schemaVersion !== 1 ||
    existing.campaignId !== WARM_RECONNECT_CAMPAIGN_ID ||
    existing.campaignVersion !== WARM_RECONNECT_CAMPAIGN_VERSION ||
    existing.tranche !== "initial_5" ||
    !["active", "released_before_provider"].includes(existing.state)
  ) {
    throw new ApiError(
      409,
      "The initial warm reconnect cohort already exists. Review that exact pilot instead."
    );
  }
  if (existing.state === "active" && existing.pilotId !== proposedPilotId) {
    throw new ApiError(
      409,
      "The initial warm reconnect cohort already exists. Review that exact pilot instead."
    );
  }
}

function assertOwnedActiveInitialPilotLock(
  existing: DocumentData | undefined,
  pilot: WarmReconnectPilot
): void {
  assertWarmReconnectInitialPilotLock(existing, pilot.pilotId);
  if (!existing || existing.state !== "active" || existing.pilotId !== pilot.pilotId) {
    throw new ApiError(409, "The active pilot lock changed. Reload the campaign desk.");
  }
}

function operationId(
  workspaceId: string,
  pilotId: string,
  eventKind: string,
  idempotencyKey: string
): string {
  return `wro_${createHash("sha256")
    .update(
      `warm-reconnect-operation:v1|${workspaceId}|${pilotId}|${eventKind}|${idempotencyKey}`
    )
    .digest("hex")
    .slice(0, 32)}`;
}

function preferenceOriginFromEnv(): string {
  const value = String(
    process.env.WARM_RECONNECT_PUBLIC_ORIGIN ||
      process.env.NEXT_PUBLIC_APP_URL ||
      "https://leadflow-review.web.app"
  ).trim();
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ApiError(500, "Warm reconnect public origin is not configured.");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new ApiError(500, "Warm reconnect public origin is not configured.");
  }
  return url.origin;
}

export async function loadWarmReconnectActivationForUid(
  uid: string,
  log: Logger,
  db: Firestore = getAdminDb()
): Promise<WarmReconnectActivationResponse> {
  const access = await assertPortfolioRegistryAccess(uid, db);
  assertOwnerAccess(uid, access.workspaceId, access.role);
  const legacyDncOrgId = resolveWarmReconnectLegacyDncOrgId(uid, access.workspaceId);
  const [pool, googleProfiles, pilotSnapshots] = await Promise.all([
    loadCandidatePool(access.workspaceId, db, legacyDncOrgId),
    loadGoogleProfileStates(uid),
    db
      .collection(COLLECTIONS.pilots)
      .where("workspaceId", "==", access.workspaceId)
      .where("ownerUid", "==", uid)
      .limit(MAX_PILOTS_RETURNED)
      .get(),
  ]);
  const pilots = await Promise.all(
    pilotSnapshots.docs.map(async (snapshot) => {
      const stored = pilotFromSnapshot(snapshot);
      const materialized = materializeWarmReconnectPilot(stored, {
        googleReady: googleReady(googleProfiles, stored),
      });
      return hydratePilotView(materialized, db);
    })
  );
  pilots.sort((left, right) => right.createdAt.localeCompare(left.createdAt));

  log.info("crm.warm_reconnect.activation_loaded", {
    sourceScope: "authenticated_default_workspace_owner",
    candidateCount: pool.candidates.length,
    excludedCount: pool.excludedCount,
    pilotCount: pilots.length,
    contactScanTruncated: pool.truncated,
  });
  return {
    schemaVersion: WARM_RECONNECT_ACTIVATION_SCHEMA_VERSION,
    dataClassification: "authenticated_contact_review",
    providerActions: "none",
    workspace: { accessRole: "owner" },
    googleProfiles,
    candidateSummary: {
      eligibleForReview: pool.candidates.length,
      excluded: pool.excludedCount,
      returned: pool.candidates.length,
      truncated: pool.truncated,
    },
    candidates: pool.candidates,
    pilots,
    constraints: {
      initialPilotSize: WARM_RECONNECT_INITIAL_PILOT_SIZE,
      expandedPilotRange: [6, 10],
      expandedPilotRequiresNewApproval: true,
      approvalTtlHours: WARM_RECONNECT_APPROVAL_TTL_HOURS,
      launchAuthorizesExactProviderExecution: true,
      providerExecutionEnabled: false,
    },
  };
}

export async function createWarmReconnectPilotForUid(input: {
  uid: string;
  request: CreateWarmReconnectPilotRequest;
  correlationId: string;
  log: Logger;
  db?: Firestore;
}): Promise<{ pilot: WarmReconnectPilotView; replayed: boolean }> {
  const db = input.db || getAdminDb();
  const access = await assertPortfolioRegistryAccess(input.uid, db);
  assertOwnerAccess(input.uid, access.workspaceId, access.role);
  const legacyDncOrgId = resolveWarmReconnectLegacyDncOrgId(input.uid, access.workspaceId);
  const [pool, googleStates] = await Promise.all([
    loadCandidatePool(access.workspaceId, db, legacyDncOrgId),
    loadGoogleProfileStates(input.uid),
  ]);
  if (pool.truncated) {
    throw new ApiError(
      409,
      "The email registry exceeds the bounded review window. Reconcile or index it before creating a pilot."
    );
  }
  const byId = new Map(pool.candidates.map((candidate) => [candidate.recipientId, candidate]));
  const candidates = input.request.candidateRecipientIds.map((id) => byId.get(id));
  if (candidates.some((candidate) => !candidate)) {
    throw new ApiError(409, "One or more selected candidates changed or are no longer reviewable.");
  }
  const pilotId = createPilotId(access.workspaceId, input.request.idempotencyKey);
  const senderProfile = googleStates.find(
    (profile) =>
      profile.businessId === input.request.sender.businessId &&
      profile.profileId === input.request.sender.profileId
  );
  const pilot = createWarmReconnectPilot({
    pilotId,
    workspaceId: access.workspaceId,
    ownerUid: input.uid,
    request: input.request,
    candidates: candidates as WarmReconnectCandidate[],
    googleReady: Boolean(
      senderProfile?.connected && senderProfile.gmailCapable && senderProfile.accountEmail
    ),
    fromEmail:
      senderProfile?.accountEmail ||
      (() => {
        throw new ApiError(
          409,
          "Reconnect the selected Google profile so its verified sending address can be bound."
        );
      })(),
    preferenceOrigin: preferenceOriginFromEnv(),
    legacyDncOrgId,
  });
  const ref = pilotRef(db, pilotId);
  const lockRef = initialPilotLockRef(db, access.workspaceId);
  const replayed = await db.runTransaction(async (transaction) => {
    const [existing, lockSnapshot] = await Promise.all([
      transaction.get(ref),
      transaction.get(lockRef),
    ]);
    assertWarmReconnectInitialPilotLock(lockSnapshot.data(), pilotId);
    if (existing.exists) {
      const stored = pilotFromSnapshot(existing);
      if (
        stored.workspaceId !== access.workspaceId ||
        stored.ownerUid !== input.uid ||
        warmReconnectFingerprint({
          preview: stored.campaignPreviewFingerprint,
          sender: stored.sender,
          artwork: stored.artworkEmailApproval,
          preference: stored.preferenceContract,
          recipients: stored.recipients.map((recipient) => ({
            recipientId: recipient.recipientId,
            candidateFingerprint: recipient.candidateFingerprint,
          })),
          tranche: stored.tranche,
          cap: stored.recipientCap,
        }) !==
          warmReconnectFingerprint({
            preview: pilot.campaignPreviewFingerprint,
            sender: pilot.sender,
            artwork: pilot.artworkEmailApproval,
            preference: pilot.preferenceContract,
            recipients: pilot.recipients.map((recipient) => ({
              recipientId: recipient.recipientId,
              candidateFingerprint: recipient.candidateFingerprint,
            })),
            tranche: pilot.tranche,
            cap: pilot.recipientCap,
          })
      ) {
        throw new ApiError(409, "This pilot idempotency key was already used differently.");
      }
      if (!lockSnapshot.exists) {
        transaction.create(lockRef, {
          schemaVersion: 1,
          workspaceId: access.workspaceId,
          campaignId: WARM_RECONNECT_CAMPAIGN_ID,
          campaignVersion: WARM_RECONNECT_CAMPAIGN_VERSION,
          tranche: "initial_5",
          state: "active",
          pilotId,
          createdAt: FieldValue.serverTimestamp(),
        });
      }
      return true;
    }
    if (!lockSnapshot.exists) {
      transaction.create(lockRef, {
        schemaVersion: 1,
        workspaceId: access.workspaceId,
        campaignId: WARM_RECONNECT_CAMPAIGN_ID,
        campaignVersion: WARM_RECONNECT_CAMPAIGN_VERSION,
        tranche: "initial_5",
        state: "active",
        pilotId,
        createdAt: FieldValue.serverTimestamp(),
      });
    } else if (lockSnapshot.data()?.state === "released_before_provider") {
      transaction.set(lockRef, {
        schemaVersion: 1,
        workspaceId: access.workspaceId,
        campaignId: WARM_RECONNECT_CAMPAIGN_ID,
        campaignVersion: WARM_RECONNECT_CAMPAIGN_VERSION,
        tranche: "initial_5",
        state: "active",
        pilotId,
        priorPilotId: lockSnapshot.data()?.pilotId || null,
        createdAt: FieldValue.serverTimestamp(),
      });
    }
    transaction.create(ref, pilot);
    transaction.create(ref.collection("events").doc(`created_${randomUUID()}`), {
      kind: "pilot_created",
      pilotId,
      workspaceId: access.workspaceId,
      correlationId: input.correlationId,
      artifactFingerprint: pilot.fingerprints.artifactFingerprint,
      audienceFingerprint: pilot.fingerprints.audienceFingerprint,
      actionFingerprint: pilot.fingerprints.actionFingerprint,
      createdAt: FieldValue.serverTimestamp(),
    });
    return false;
  });
  const stored = replayed ? pilotFromSnapshot(await ref.get()) : pilot;
  input.log.info("crm.warm_reconnect.pilot_created", {
    pilotId,
    recipientCount: stored.recipients.length,
    status: stored.status,
    replayed,
    providerAction: false,
  });
  return { pilot: await hydratePilotView(stored, db), replayed };
}

async function updatePilotTransaction(input: {
  uid: string;
  pilotId: string;
  correlationId: string;
  eventKind: string;
  idempotencyKey: string;
  requestPayload: unknown;
  requireCurrentAudience?: boolean;
  semanticReplay?: (pilot: WarmReconnectPilot) => boolean;
  transform: (
    pilot: WarmReconnectPilot,
    googleReady: boolean,
    operationId: string
  ) => WarmReconnectPilot;
  db?: Firestore;
}): Promise<{ pilot: WarmReconnectPilotView; replayed: boolean }> {
  const db = input.db || getAdminDb();
  const loaded = await loadOwnedPilot(input.uid, input.pilotId, db);
  if (input.requireCurrentAudience) {
    const legacyDncOrgId = resolveWarmReconnectLegacyDncOrgId(
      input.uid,
      loaded.pilot.workspaceId
    );
    if (legacyDncOrgId !== loaded.pilot.legacyDncOrgId) {
      throw new ApiError(409, "The suppression workspace mapping changed. Return to review.");
    }
    const pool = await loadCandidatePool(
      loaded.pilot.workspaceId,
      db,
      legacyDncOrgId
    );
    const currentCandidates = new Map(
      pool.candidates.map((candidate) => [candidate.recipientId, candidate])
    );
    const audienceCurrent = loaded.pilot.recipients.every((recipient) => {
      const candidate = currentCandidates.get(recipient.recipientId);
      return Boolean(
        candidate &&
          candidate.personId === recipient.personId &&
          candidate.contactPointId === recipient.contactPointId &&
          candidate.emailKey === recipient.emailKey &&
          candidate.candidateFingerprint === recipient.candidateFingerprint
      );
    });
    if (!audienceCurrent) {
      throw new ApiError(
        409,
        "Recipient evidence, permission, suppression, or contact data changed. Return to review."
      );
    }
  }
  const ready = googleReady(loaded.googleStates, loaded.pilot);
  const ref = pilotRef(db, input.pilotId);
  const id = operationId(
    loaded.pilot.workspaceId,
    input.pilotId,
    input.eventKind,
    input.idempotencyKey
  );
  const eventRef = ref.collection("events").doc(id);
  const lockRef = initialPilotLockRef(db, loaded.pilot.workspaceId);
  const requestsInitialLockRelease =
    input.eventKind === "pilot_stopped" || input.eventKind === "pilot_rejected";
  const requestFingerprint = warmReconnectFingerprint({
    contract: "warm-reconnect-operation-request.v1",
    eventKind: input.eventKind,
    request: input.requestPayload,
  });
  const updated = await db.runTransaction(async (transaction) => {
    const [snapshot, eventSnapshot, lockSnapshot] = await Promise.all([
      transaction.get(ref),
      transaction.get(eventRef),
      transaction.get(lockRef),
    ]);
    const current = pilotFromSnapshot(snapshot);
    if (current.workspaceId !== loaded.pilot.workspaceId || current.ownerUid !== input.uid) {
      throw new ApiError(404, "Warm reconnect pilot not found.");
    }
    if (eventSnapshot.exists) {
      const resultPilot = reconcileWarmReconnectOperationReplay(
        eventSnapshot.data(),
        requestFingerprint
      );
      return { pilot: resultPilot, replayed: true };
    }
    if (input.semanticReplay?.(current)) {
      return { pilot: current, replayed: true };
    }
    if (requestsInitialLockRelease) {
      assertOwnedActiveInitialPilotLock(lockSnapshot.data(), current);
    }
    let releaseInitialLock = input.eventKind === "pilot_rejected";
    let executorStateRef: DocumentReference<DocumentData> | null = null;
    let activeReceiptRef: DocumentReference<DocumentData> | null = null;
    let activeReceiptData: DocumentData | undefined;
    let activeLedgerRef: DocumentReference<DocumentData> | null = null;
    let releaseActiveLedger = false;
    if (input.eventKind === "pilot_stopped") {
      executorStateRef = ref.collection("executor").doc("state");
      const [executorStateSnapshot, receiptSnapshots] = await Promise.all([
        transaction.get(executorStateRef),
        transaction.get(
          ref
            .collection("delivery_receipts")
            .limit(WARM_RECONNECT_INITIAL_PILOT_SIZE + 1)
        ),
      ]);
      const executorState = executorStateSnapshot.data();
      const activeReceiptId = asText(executorState?.activeReceiptId);
      if (activeReceiptId) {
        activeReceiptRef = ref.collection("delivery_receipts").doc(activeReceiptId);
        activeReceiptData = receiptSnapshots.docs
          .find((receipt) => receipt.id === activeReceiptId)
          ?.data();
      }
      assertWarmReconnectStopBoundary(executorState, activeReceiptData);
      releaseInitialLock = canReleaseWarmReconnectInitialPilotLock({
        executorState,
        receipts: receiptSnapshots.docs.map((receipt) => receipt.data()),
      });
      if (releaseInitialLock && activeReceiptId && activeReceiptData) {
        const recipientId = asText(activeReceiptData.recipientId);
        const recipient = current.recipients.find(
          (candidate) => candidate.recipientId === recipientId
        );
        if (!recipient) {
          throw new ApiError(409, "The active delivery could not be reconciled before stop.");
        }
        const binding = warmReconnectInvitationReservationBindingForPilot(
          current,
          recipient,
          activeReceiptId
        );
        activeLedgerRef = db
          .collection(WARM_RECONNECT_INVITATION_LEDGER_COLLECTION)
          .doc(binding.reservationId);
        const ledgerSnapshot = await transaction.get(activeLedgerRef);
        const reconciliation = reconcileWarmReconnectInvitationTransition({
          existing: ledgerSnapshot.data(),
          expected: binding,
          target: "released_before_provider",
        });
        if (!reconciliation.ok) {
          throw new ApiError(
            409,
            "The one-time invitation reservation could not be reconciled before stop."
          );
        }
        releaseActiveLedger = reconciliation.action === "transition";
      }
    }
    const next = input.transform(current, ready, id);
    transaction.set(ref, next);
    if (releaseInitialLock) {
      transaction.set(
        lockRef,
        {
          state: "released_before_provider",
          pilotId: current.pilotId,
          releaseReason: input.eventKind,
          releasedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    }
    if (executorStateRef) {
      transaction.set(
        executorStateRef,
        {
          activeReceiptId: null,
          halted: true,
          complete: false,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    }
    if (activeReceiptRef && activeReceiptData) {
      transaction.set(
        activeReceiptRef,
        {
          status: "stopped_before_provider",
          stoppedAtMs: Date.now(),
          terminalReason: input.requestPayload && typeof input.requestPayload === "object"
            ? asText((input.requestPayload as Record<string, unknown>).reason) || "operator_stop"
            : "operator_stop",
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    }
    if (activeLedgerRef && releaseActiveLedger) {
      transaction.set(
        activeLedgerRef,
        {
          status: "released_before_provider",
          releasedAtMs: Date.now(),
          correlationId: input.correlationId,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    }
    transaction.create(eventRef, {
      kind: input.eventKind,
      operationId: id,
      requestFingerprint,
      pilotId: input.pilotId,
      workspaceId: current.workspaceId,
      correlationId: input.correlationId,
      fromStatus: current.status,
      toStatus: next.status,
      artifactFingerprint: next.fingerprints.artifactFingerprint,
      audienceFingerprint: next.fingerprints.audienceFingerprint,
      actionFingerprint: next.fingerprints.actionFingerprint,
      resultPilot: next,
      createdAt: FieldValue.serverTimestamp(),
    });
    return { pilot: next, replayed: false };
  });
  const materialized = materializeWarmReconnectPilot(updated.pilot, {
    googleReady: ready,
  });
  return { pilot: await hydratePilotView(materialized, db), replayed: updated.replayed };
}

export function reconcileWarmReconnectOperationReplay(
  event: DocumentData | undefined,
  requestFingerprint: string
): WarmReconnectPilot {
  if (!event || event.requestFingerprint !== requestFingerprint) {
    throw new ApiError(409, "This idempotency key was already used differently.");
  }
  const resultPilot = event.resultPilot as WarmReconnectPilot | undefined;
  if (!resultPilot || resultPilot.schemaVersion !== "crm.warm-reconnect-pilot.v1") {
    throw new ApiError(409, "The prior operation result could not be reconciled.");
  }
  return resultPilot;
}

export async function decideWarmReconnectRecipientForUid(input: {
  uid: string;
  pilotId: string;
  recipientId: string;
  request: WarmReconnectRecipientDecisionRequest;
  correlationId: string;
  idempotencyKey: string;
  log: Logger;
  db?: Firestore;
}): Promise<{ pilot: WarmReconnectPilotView; replayed: boolean }> {
  const result = await updatePilotTransaction({
    ...input,
    eventKind: "recipient_decision_recorded",
    requestPayload: { recipientId: input.recipientId, request: input.request },
    semanticReplay: (current) =>
      isWarmReconnectRecipientDecisionReplay({
        pilot: current,
        recipientId: input.recipientId,
        request: input.request,
      }),
    transform: (current, ready, id) =>
      decideWarmReconnectRecipient({
        pilot: current,
        recipientId: input.recipientId,
        request: input.request,
        decisionId: `wrd_${id.slice(4)}`,
        googleReady: ready,
      }),
  });
  input.log.info("crm.warm_reconnect.recipient_decided", {
    pilotId: input.pilotId,
    recipientId: input.recipientId,
    decision: input.request.decision,
    status: result.pilot.status,
    replayed: result.replayed,
  });
  return result;
}

export async function decideWarmReconnectPilotApprovalForUid(input: {
  uid: string;
  pilotId: string;
  request: WarmReconnectPilotApprovalRequest;
  correlationId: string;
  idempotencyKey: string;
  log: Logger;
  db?: Firestore;
}): Promise<{ pilot: WarmReconnectPilotView; replayed: boolean }> {
  const result = await updatePilotTransaction({
    ...input,
    eventKind: input.request.decision === "approve" ? "pilot_approved" : "pilot_rejected",
    requireCurrentAudience: input.request.decision === "approve",
    requestPayload: input.request,
    semanticReplay: (current) =>
      isWarmReconnectPilotApprovalReplay({ pilot: current, request: input.request }),
    transform: (current, ready, id) =>
      decideWarmReconnectPilotApproval({
        pilot: current,
        approvalId: `wra_${id.slice(4)}`,
        request: input.request,
        googleReady: ready,
      }),
  });
  input.log.info("crm.warm_reconnect.approval_decided", {
    pilotId: input.pilotId,
    decision: input.request.decision,
    status: result.pilot.status,
    replayed: result.replayed,
  });
  return result;
}

export async function requestWarmReconnectPilotLaunchForUid(input: {
  uid: string;
  pilotId: string;
  request: WarmReconnectPilotLaunchRequest;
  correlationId: string;
  idempotencyKey: string;
  log: Logger;
  db?: Firestore;
}): Promise<{ pilot: WarmReconnectPilotView; replayed: boolean }> {
  const result = await updatePilotTransaction({
    ...input,
    eventKind: "launch_requested",
    requireCurrentAudience: true,
    requestPayload: input.request,
    semanticReplay: (current) =>
      isWarmReconnectPilotLaunchReplay({ pilot: current, request: input.request }),
    transform: (current, ready) =>
      requestWarmReconnectPilotLaunch({
        pilot: current,
        request: input.request,
        googleReady: ready,
      }),
  });
  input.log.info("crm.warm_reconnect.launch_requested", {
    pilotId: input.pilotId,
    status: result.pilot.status,
    providerAction: false,
    replayed: result.replayed,
  });
  return result;
}

export async function stopWarmReconnectPilotForUid(input: {
  uid: string;
  pilotId: string;
  request: WarmReconnectPilotStopRequest;
  correlationId: string;
  idempotencyKey: string;
  log: Logger;
  db?: Firestore;
}): Promise<{ pilot: WarmReconnectPilotView; replayed: boolean }> {
  const result = await updatePilotTransaction({
    ...input,
    eventKind: "pilot_stopped",
    requestPayload: input.request,
    semanticReplay: (current) =>
      isWarmReconnectPilotStopReplay(current, input.request.reason),
    transform: (current, ready) =>
      stopWarmReconnectPilot({ pilot: current, reason: input.request.reason, googleReady: ready }),
  });
  input.log.info("crm.warm_reconnect.pilot_stopped", {
    pilotId: input.pilotId,
    status: result.pilot.status,
    replayed: result.replayed,
  });
  return result;
}
