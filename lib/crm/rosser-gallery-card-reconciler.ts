import { createHash } from "node:crypto";
import { domainToASCII } from "node:url";
import {
  FieldValue,
  type DocumentData,
  type DocumentReference,
  type DocumentSnapshot,
  type Firestore,
  type Query,
  type QuerySnapshot,
  type Transaction,
} from "firebase-admin/firestore";
import type {
  RosserGalleryCardCanonicalSource,
  RosserGalleryCardCanonicalSourceRow,
} from "./rosser-gallery-card-import";

export const ROSSER_GALLERY_DOT_CARD_EXACT_RECEIPT =
  "sha256:fd37e8c56a5461bf6224ecfaa4e62a7b04f1df4d3f4fa9b889c4aff392ca1a4b" as const;

export const ROSSER_GALLERY_DOT_CARD_EXPECTED_ROWS = 10 as const;
export const ROSSER_GALLERY_CARD_RECONCILER_SCHEMA_VERSION =
  "crm.rosser-gallery-card-canonical-reconciliation.v1" as const;

const BRAND_ID = "rosser_gallery" as const;
const SOURCE_SYSTEM = "dot_card_csv" as const;
const ATTESTATION_EVIDENCE_ID =
  "owner-attestation-2026-08-13-rosser-gallery-dot-card" as const;
const ATTESTATION_STATEMENT =
  "These all do approved to be able to be contacted and tend to be our original fan base and community." as const;
const ATTESTATION_INTERPRETATION =
  "Cohort-level evidence of a prior Rosser Gallery relationship; canonical suppression and permission controls remain authoritative, and broad marketing opt-in is not inferred." as const;

const COLLECTIONS = {
  workspaces: "workspaces",
  workspaceMembers: "workspace_members",
  people: "crm_people",
  contactPoints: "crm_contact_points",
  sourceRecords: "crm_source_records",
  permissionEvents: "crm_permission_events",
  suppressions: "crm_suppressions",
  importConflicts: "crm_import_conflicts",
} as const;

export const ROSSER_GALLERY_CARD_READ_CAPS = Object.freeze({
  people: 5_000,
  contactPoints: 7_500,
  sourceRecords: 15_000,
  permissionEvents: 15_000,
  suppressions: 7_500,
  importConflicts: 7_500,
});
export const ROSSER_GALLERY_CARD_MAX_SNAPSHOT_DOCUMENTS = 7_500 as const;
export const ROSSER_GALLERY_CARD_MAX_SNAPSHOT_BYTES = 6 * 1024 * 1024;

const IDENTIFIER_PATTERN = /^[A-Za-z0-9_.:-]{1,160}$/;
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;

export type RosserGalleryCardCanonicalDisposition =
  | "ready_new_contact"
  | "ready_existing_contact"
  | "already_imported"
  | "invalid_source_identity"
  | "duplicate_source_identity"
  | "canonical_identity_conflict"
  | "immutable_import_record_conflict"
  | "suppressed"
  | "opted_out"
  | "transactional_only"
  | "unsupported_permission_state"
  | "open_import_conflict";

export interface RosserGalleryCardCanonicalReport {
  schemaVersion: typeof ROSSER_GALLERY_CARD_RECONCILER_SCHEMA_VERSION;
  mode: "dry_run" | "apply";
  dataClassification: "aggregate_only";
  correlationId: string;
  source: {
    sourceSystem: typeof SOURCE_SYSTEM;
    exactReceipt: typeof ROSSER_GALLERY_DOT_CARD_EXACT_RECEIPT;
    receiptMatched: true;
    rows: number;
  };
  workspace: {
    binding: "server_derived_owner_default";
    accessRole: "owner";
    brandId: typeof BRAND_ID;
  };
  provenance: {
    evidenceId: typeof ATTESTATION_EVIDENCE_ID;
    interpretation: typeof ATTESTATION_INTERPRETATION;
  };
  boundedReads: {
    limits: typeof ROSSER_GALLERY_CARD_READ_CAPS;
    observed: {
      people: number;
      contactPoints: number;
      sourceRecords: number;
      permissionEvents: number;
      suppressions: number;
      importConflicts: number;
    };
  };
  reconciliation: {
    dispositionCounts: Record<RosserGalleryCardCanonicalDisposition, number>;
    safeRows: number;
    heldRows: number;
    alreadyImportedRows: number;
  };
  proposedWrites: {
    peopleCreated: number;
    peopleBrandLinked: number;
    emailContactPointsCreated: number;
    identityOnlyPhoneContactPointsCreated: number;
    sourceRecordsCreated: number;
    reconfirmPermissionEventsCreated: number;
    total: number;
  };
  apply: {
    planFingerprint: string;
    confirmationRequired: string;
    executed: boolean;
    writesApplied: number;
  };
  permissionBoundary: {
    emailState: "reconfirm_required";
    broadMarketingOptInClaimed: false;
    phonePurpose: "identity_reconciliation_only";
    smsPermissionGranted: false;
    callPermissionGranted: false;
  };
  authority: {
    contactsMayBeWritten: boolean;
    sends: false;
    drafts: false;
    sms: false;
    calls: false;
    socialLookup: false;
  };
}

export interface RosserGalleryCardCanonicalInput {
  source: RosserGalleryCardCanonicalSource;
  ownerUid: string;
  requestedWorkspaceId: string;
  requestedSourceReceipt?: string;
  mode?: "dry_run" | "apply";
  confirmation?: string;
  correlationId: string;
  db: Firestore;
  log?: {
    info(event: string, fields: Record<string, unknown>): void;
  };
}

export class RosserGalleryCardReconciliationError extends Error {
  readonly code:
    | "invalid_request"
    | "source_receipt_mismatch"
    | "workspace_binding_mismatch"
    | "workspace_access_denied"
    | "bounded_read_exceeded"
    | "apply_confirmation_mismatch";

  constructor(
    code: RosserGalleryCardReconciliationError["code"],
    message: string
  ) {
    super(message);
    this.name = "RosserGalleryCardReconciliationError";
    this.code = code;
  }
}

type SnapshotReader = {
  getDocument(
    reference: DocumentReference<DocumentData>
  ): Promise<DocumentSnapshot<DocumentData>>;
  getQuery(query: Query<DocumentData>): Promise<QuerySnapshot<DocumentData>>;
};

type CanonicalSnapshot = {
  people: QuerySnapshot<DocumentData>;
  contactPoints: QuerySnapshot<DocumentData>;
  sourceRecords: QuerySnapshot<DocumentData>;
  permissionEvents: QuerySnapshot<DocumentData>;
  suppressions: QuerySnapshot<DocumentData>;
  importConflicts: QuerySnapshot<DocumentData>;
};

type WriteCounts = RosserGalleryCardCanonicalReport["proposedWrites"];

type RowPlan = {
  sourceRow: RosserGalleryCardCanonicalSourceRow;
  disposition: RosserGalleryCardCanonicalDisposition;
  personId: string | null;
  emailContactPointId: string | null;
  phoneContactPointId: string | null;
  sourceRecordId: string;
  permissionEventId: string;
  createPerson: boolean;
  linkPersonBrand: boolean;
  createEmailContactPoint: boolean;
  createPhoneContactPoint: boolean;
  createSourceRecord: boolean;
  createPermissionEvent: boolean;
  evidenceFingerprint: string;
};

type CanonicalPlan = {
  rows: RowPlan[];
  planFingerprint: string;
  dispositionCounts: Record<RosserGalleryCardCanonicalDisposition, number>;
  writes: WriteCounts;
  observed: RosserGalleryCardCanonicalReport["boundedReads"]["observed"];
};

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function canonicalize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

function shortId(prefix: string, value: string): string {
  return `${prefix}_${sha256(value).slice(7, 39)}`;
}

function asText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.normalize("NFKC").trim();
  return normalized || null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(asText).filter((item): item is string => Boolean(item));
}

function documentPersonIds(data: DocumentData): string[] {
  return [
    asText(data.personId),
    asText(data.crmPersonId),
    asText(data.personRef),
    ...asStringArray(data.personIds),
  ].filter((value): value is string => Boolean(value));
}

function documentContactPointIds(data: DocumentData): string[] {
  return [
    asText(data.contactPointId),
    asText(data.crmContactPointId),
    ...asStringArray(data.contactPointIds),
  ].filter((value): value is string => Boolean(value));
}

function normalizeEmail(value: unknown): string | null {
  const email = asText(value);
  if (!email || email.length > 254 || /[\u0000-\u0020\u007f]/.test(email)) return null;
  const at = email.lastIndexOf("@");
  if (at <= 0 || at !== email.indexOf("@")) return null;
  const local = email.slice(0, at);
  const rawDomain = email.slice(at + 1);
  if (
    !local ||
    local.length > 64 ||
    local.startsWith(".") ||
    local.endsWith(".") ||
    local.includes("..") ||
    !/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(local)
  ) {
    return null;
  }
  const domain = domainToASCII(rawDomain).toLowerCase();
  const labels = domain.split(".");
  if (
    !domain ||
    domain.length > 253 ||
    labels.length < 2 ||
    labels.some(
      (label) =>
        !label ||
        label.length > 63 ||
        label.startsWith("-") ||
        label.endsWith("-") ||
        !/^[a-z0-9-]+$/.test(label)
    )
  ) {
    return null;
  }
  return `${local.toLowerCase()}@${domain}`;
}

function normalizedEmailFromDocument(data: DocumentData): string | null {
  for (const key of ["normalizedValue", "email", "value", "address"]) {
    const value = normalizeEmail(data[key]);
    if (value) return value;
  }
  const sourceFields =
    data.sourceFields && typeof data.sourceFields === "object"
      ? (data.sourceFields as Record<string, unknown>)
      : null;
  if (sourceFields) {
    for (const key of ["Email", "email", "address"]) {
      const value = normalizeEmail(sourceFields[key]);
      if (value) return value;
    }
  }
  return null;
}

function normalizePhone(value: unknown): string | null {
  const text = asText(value);
  if (!text) return null;
  const digits = text.replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 15 ? digits : null;
}

function normalizedPhoneFromDocument(data: DocumentData): string | null {
  for (const key of ["normalizedValue", "phone", "phoneNumber", "value"]) {
    const value = normalizePhone(data[key]);
    if (value) return value;
  }
  return null;
}

function emailKey(workspaceId: string, email: string): string {
  return sha256(`email:v1|${workspaceId}|${email}`);
}

function emptyDispositions(): Record<RosserGalleryCardCanonicalDisposition, number> {
  return {
    ready_new_contact: 0,
    ready_existing_contact: 0,
    already_imported: 0,
    invalid_source_identity: 0,
    duplicate_source_identity: 0,
    canonical_identity_conflict: 0,
    immutable_import_record_conflict: 0,
    suppressed: 0,
    opted_out: 0,
    transactional_only: 0,
    unsupported_permission_state: 0,
    open_import_conflict: 0,
  };
}

function emptyWrites(): WriteCounts {
  return {
    peopleCreated: 0,
    peopleBrandLinked: 0,
    emailContactPointsCreated: 0,
    identityOnlyPhoneContactPointsCreated: 0,
    sourceRecordsCreated: 0,
    reconfirmPermissionEventsCreated: 0,
    total: 0,
  };
}

export function canonicalRosserGalleryWorkspaceIdForOwner(ownerUid: string): string {
  const uid = String(ownerUid || "").trim();
  if (!uid || uid.length > 128 || uid.includes("/")) {
    throw new RosserGalleryCardReconciliationError(
      "invalid_request",
      "A trusted owner identity is required."
    );
  }
  return `workspace_default_${uid}`;
}

export function rosserGalleryCardApplyConfirmation(planFingerprint: string): string {
  if (!SHA256_PATTERN.test(planFingerprint)) {
    throw new RosserGalleryCardReconciliationError(
      "invalid_request",
      "A valid reconciled plan fingerprint is required."
    );
  }
  return `APPLY_ROSSER_GALLERY_DOT_CARD_${planFingerprint.slice(7)}`;
}

function queryForWorkspace(
  db: Firestore,
  collectionName: string,
  workspaceId: string,
  limit: number
): Query<DocumentData> {
  return db
    .collection(collectionName)
    .where("workspaceId", "==", workspaceId)
    .limit(limit + 1);
}

function assertBounded(
  snapshot: QuerySnapshot<DocumentData>,
  limit: number,
  label: string
): void {
  if (snapshot.docs.length > limit) {
    throw new RosserGalleryCardReconciliationError(
      "bounded_read_exceeded",
      `The canonical ${label} ledger exceeds its reviewed read bound.`
    );
  }
}

async function loadCanonicalSnapshot(
  db: Firestore,
  reader: SnapshotReader,
  ownerUid: string,
  workspaceId: string
): Promise<CanonicalSnapshot> {
  const workspaceRef = db.collection(COLLECTIONS.workspaces).doc(workspaceId);
  const memberQuery = db
    .collection(COLLECTIONS.workspaceMembers)
    .where("workspaceId", "==", workspaceId)
    .where("uid", "==", ownerUid)
    .limit(2);
  const [workspace, members, people, contactPoints, sourceRecords, permissionEvents, suppressions, importConflicts] =
    await Promise.all([
      reader.getDocument(workspaceRef),
      reader.getQuery(memberQuery),
      reader.getQuery(
        queryForWorkspace(
          db,
          COLLECTIONS.people,
          workspaceId,
          ROSSER_GALLERY_CARD_READ_CAPS.people
        )
      ),
      reader.getQuery(
        queryForWorkspace(
          db,
          COLLECTIONS.contactPoints,
          workspaceId,
          ROSSER_GALLERY_CARD_READ_CAPS.contactPoints
        )
      ),
      reader.getQuery(
        queryForWorkspace(
          db,
          COLLECTIONS.sourceRecords,
          workspaceId,
          ROSSER_GALLERY_CARD_READ_CAPS.sourceRecords
        )
      ),
      reader.getQuery(
        queryForWorkspace(
          db,
          COLLECTIONS.permissionEvents,
          workspaceId,
          ROSSER_GALLERY_CARD_READ_CAPS.permissionEvents
        )
      ),
      reader.getQuery(
        queryForWorkspace(
          db,
          COLLECTIONS.suppressions,
          workspaceId,
          ROSSER_GALLERY_CARD_READ_CAPS.suppressions
        )
      ),
      reader.getQuery(
        queryForWorkspace(
          db,
          COLLECTIONS.importConflicts,
          workspaceId,
          ROSSER_GALLERY_CARD_READ_CAPS.importConflicts
        )
      ),
    ]);

  const workspaceData = workspace.data() || {};
  const memberData = members.docs[0]?.data() || {};
  if (
    !workspace.exists ||
    workspaceData.status !== "active" ||
    workspaceData.ownerUid !== ownerUid ||
    members.docs.length !== 1 ||
    memberData.status !== "active" ||
    memberData.role !== "owner"
  ) {
    throw new RosserGalleryCardReconciliationError(
      "workspace_access_denied",
      "The canonical Rosser Gallery workspace owner binding is not active."
    );
  }

  assertBounded(people, ROSSER_GALLERY_CARD_READ_CAPS.people, "people");
  assertBounded(
    contactPoints,
    ROSSER_GALLERY_CARD_READ_CAPS.contactPoints,
    "contact points"
  );
  assertBounded(
    sourceRecords,
    ROSSER_GALLERY_CARD_READ_CAPS.sourceRecords,
    "source records"
  );
  assertBounded(
    permissionEvents,
    ROSSER_GALLERY_CARD_READ_CAPS.permissionEvents,
    "permission events"
  );
  assertBounded(
    suppressions,
    ROSSER_GALLERY_CARD_READ_CAPS.suppressions,
    "suppressions"
  );
  assertBounded(
    importConflicts,
    ROSSER_GALLERY_CARD_READ_CAPS.importConflicts,
    "import conflicts"
  );
  const canonicalSnapshots = [
    people,
    contactPoints,
    sourceRecords,
    permissionEvents,
    suppressions,
    importConflicts,
  ];
  const totalDocuments = canonicalSnapshots.reduce(
    (total, snapshot) => total + snapshot.docs.length,
    0
  );
  let estimatedBytes = 0;
  try {
    estimatedBytes = canonicalSnapshots.reduce(
      (total, snapshot) =>
        total +
        snapshot.docs.reduce(
          (subtotal, document) =>
            subtotal + Buffer.byteLength(JSON.stringify(document.data()), "utf8"),
          0
        ),
      0
    );
  } catch {
    throw new RosserGalleryCardReconciliationError(
      "bounded_read_exceeded",
      "The canonical reconciliation snapshot could not be measured safely."
    );
  }
  if (
    totalDocuments > ROSSER_GALLERY_CARD_MAX_SNAPSHOT_DOCUMENTS ||
    estimatedBytes > ROSSER_GALLERY_CARD_MAX_SNAPSHOT_BYTES
  ) {
    throw new RosserGalleryCardReconciliationError(
      "bounded_read_exceeded",
      "The canonical reconciliation snapshot exceeds its reviewed transaction bound."
    );
  }
  return { people, contactPoints, sourceRecords, permissionEvents, suppressions, importConflicts };
}

function activeSuppression(data: DocumentData): boolean {
  const status = asText(data.status)?.toLowerCase();
  return data.active !== false && !["inactive", "resolved", "removed"].includes(status || "");
}

function documentMatchesRow(
  data: DocumentData,
  row: RosserGalleryCardCanonicalSourceRow,
  workspaceId: string,
  personId: string,
  contactPointIds: string[]
): boolean {
  const rowEmailKey = emailKey(workspaceId, row.normalizedEmail!);
  const storedEmail = normalizedEmailFromDocument(data);
  const storedEmailKey = asText(data.emailKey) || asText(data.contactPointKey);
  const people = documentPersonIds(data);
  const contacts = documentContactPointIds(data);
  return Boolean(
    (storedEmail && storedEmail === row.normalizedEmail) ||
      storedEmailKey === rowEmailKey ||
      people.includes(personId) ||
      contacts.some((id) => contactPointIds.includes(id)) ||
      asText(data.sourceRowKey) === row.sourceRowKey
  );
}

function isSuppressed(
  suppressions: QuerySnapshot<DocumentData>,
  row: RosserGalleryCardCanonicalSourceRow,
  workspaceId: string,
  personId: string,
  contactPointIds: string[]
): boolean {
  const emailDomain = row.normalizedEmail!.split("@")[1];
  return suppressions.docs.some((document) => {
    const data = document.data();
    if (!activeSuppression(data)) return false;
    const type = asText(data.type)?.toLowerCase();
    const scope = asText(data.scope)?.toLowerCase();
    if (type === "all" || scope === "workspace") return true;
    const normalized = asText(data.normalized)?.toLowerCase().replace(/^@/, "");
    if (
      type === "domain" &&
      normalized &&
      (emailDomain === normalized || emailDomain.endsWith(`.${normalized}`))
    ) {
      return true;
    }
    return documentMatchesRow(data, row, workspaceId, personId, contactPointIds);
  });
}

function isOpenConflict(
  conflicts: QuerySnapshot<DocumentData>,
  row: RosserGalleryCardCanonicalSourceRow,
  workspaceId: string,
  personId: string,
  contactPointIds: string[]
): boolean {
  return conflicts.docs.some((document) => {
    const data = document.data();
    if ((asText(data.status) || "open").toLowerCase() !== "open") return false;
    if ((asText(data.scope) || "").toLowerCase() === "workspace") return true;
    return documentMatchesRow(data, row, workspaceId, personId, contactPointIds);
  });
}

function permissionState(data: DocumentData): string | null {
  return (
    asText(data.permissionState) ||
    asText(data.toState) ||
    asText(data.state)
  )?.toLowerCase() || null;
}

function relatedPermissionEvidence(
  permissionEvents: QuerySnapshot<DocumentData>,
  row: RosserGalleryCardCanonicalSourceRow,
  workspaceId: string,
  personId: string,
  contactPointIds: string[]
): Array<{ id: string; state: string }> {
  return permissionEvents.docs
    .filter((document) =>
      documentMatchesRow(document.data(), row, workspaceId, personId, contactPointIds)
    )
    .map((document) => ({ id: document.id, state: permissionState(document.data()) || "" }))
    .filter((event) => Boolean(event.state))
    .sort((left, right) => left.id.localeCompare(right.id));
}

function permissionBlock(
  emailContact: DocumentData | null,
  phoneContact: DocumentData | null,
  evidence: Array<{ id: string; state: string }>
): RosserGalleryCardCanonicalDisposition | null {
  const states = [
    emailContact ? (asText(emailContact.defaultPermissionState) || "unknown").toLowerCase() : "unknown",
    ...(phoneContact
      ? [(asText(phoneContact.defaultPermissionState) || "unknown").toLowerCase()]
      : []),
    ...evidence.map((event) => event.state),
  ];
  if (states.includes("opted_out")) return "opted_out";
  if (states.includes("transactional_only")) return "transactional_only";
  const allowed = new Set(["unknown", "opted_in", "reconfirm_required"]);
  if (states.some((state) => !allowed.has(state))) return "unsupported_permission_state";
  return null;
}

function contactIsSuppressed(data: DocumentData | null): boolean {
  return data?.suppressed === true;
}

function immutableSourceMatches(
  data: DocumentData,
  row: RosserGalleryCardCanonicalSourceRow,
  workspaceId: string,
  personId: string,
  emailContactPointId: string,
  phoneContactPointId: string | null
): boolean {
  const expectedContacts = [emailContactPointId, phoneContactPointId].filter(
    (value): value is string => Boolean(value)
  );
  const actualContacts = [
    asText(data.contactPointId),
    ...asStringArray(data.contactPointIds),
  ].filter((value): value is string => Boolean(value));
  return Boolean(
    data.workspaceId === workspaceId &&
      data.sourceSystem === SOURCE_SYSTEM &&
      data.sourceReceiptSha256 === ROSSER_GALLERY_DOT_CARD_EXACT_RECEIPT &&
      data.sourceRowKey === row.sourceRowKey &&
      data.sourceRowFingerprint === row.rawFingerprint &&
      data.permissionBasis === "owner_attestation_requires_reconfirmation" &&
      data.requiresReconfirmation === true &&
      data.broadMarketingOptIn === false &&
      data.phonePurpose === "identity_reconciliation_only" &&
      documentPersonIds(data).includes(personId) &&
      expectedContacts.every((id) => actualContacts.includes(id))
  );
}

function immutablePermissionMatches(
  data: DocumentData,
  row: RosserGalleryCardCanonicalSourceRow,
  workspaceId: string,
  personId: string,
  emailContactPointId: string,
  sourceRecordId: string
): boolean {
  return Boolean(
    data.workspaceId === workspaceId &&
      documentPersonIds(data).includes(personId) &&
      documentContactPointIds(data).includes(emailContactPointId) &&
      data.sourceRecordId === sourceRecordId &&
      data.sourceRowKey === row.sourceRowKey &&
      data.attestationEvidenceId === ATTESTATION_EVIDENCE_ID &&
      data.permissionState === "reconfirm_required" &&
      data.broadMarketingOptIn === false &&
      data.reconfirmationRequired === true &&
      data.sendsAuthorized === false &&
      data.smsPermissionGranted === false &&
      data.callPermissionGranted === false
  );
}

function buildPlan(
  source: RosserGalleryCardCanonicalSource,
  workspaceId: string,
  snapshot: CanonicalSnapshot
): CanonicalPlan {
  const peopleById = new Map(snapshot.people.docs.map((doc) => [doc.id, doc.data()]));
  const contactsById = new Map(
    snapshot.contactPoints.docs.map((doc) => [doc.id, doc.data()])
  );
  const sourceById = new Map(
    snapshot.sourceRecords.docs.map((doc) => [doc.id, doc.data()])
  );
  const permissionsById = new Map(
    snapshot.permissionEvents.docs.map((doc) => [doc.id, doc.data()])
  );

  const emailContacts = new Map<string, Array<{ id: string; data: DocumentData }>>();
  const phoneContacts = new Map<string, Array<{ id: string; data: DocumentData }>>();
  for (const document of snapshot.contactPoints.docs) {
    const data = document.data();
    const emailValue = normalizedEmailFromDocument(data);
    if (emailValue) {
      emailContacts.set(emailValue, [
        ...(emailContacts.get(emailValue) || []),
        { id: document.id, data },
      ]);
    } else {
      const value = normalizedPhoneFromDocument(data);
      if (value) phoneContacts.set(value, [...(phoneContacts.get(value) || []), { id: document.id, data }]);
    }
  }

  const rawCounts = new Map<string, number>();
  const emailCounts = new Map<string, number>();
  const phoneToEmails = new Map<string, Set<string>>();
  for (const row of source.rows) {
    rawCounts.set(row.rawFingerprint, (rawCounts.get(row.rawFingerprint) || 0) + 1);
    if (row.normalizedEmail) {
      emailCounts.set(row.normalizedEmail, (emailCounts.get(row.normalizedEmail) || 0) + 1);
    }
    if (row.normalizedPhone) {
      const emails = phoneToEmails.get(row.normalizedPhone) || new Set<string>();
      emails.add(row.normalizedEmail || `invalid-${row.rowNumber}`);
      phoneToEmails.set(row.normalizedPhone, emails);
    }
  }

  const rows: RowPlan[] = source.rows.map((row) => {
    const sourceRecordId = shortId(
      "rgs",
      `rosser-gallery-dot-source:v1|${workspaceId}|${row.sourceRowKey}`
    );
    const permissionEventId = shortId(
      "rgp",
      `rosser-gallery-dot-permission:v1|${workspaceId}|${row.sourceRowKey}`
    );
    const blocked = (disposition: RosserGalleryCardCanonicalDisposition): RowPlan => ({
      sourceRow: row,
      disposition,
      personId: null,
      emailContactPointId: null,
      phoneContactPointId: null,
      sourceRecordId,
      permissionEventId,
      createPerson: false,
      linkPersonBrand: false,
      createEmailContactPoint: false,
      createPhoneContactPoint: false,
      createSourceRecord: false,
      createPermissionEvent: false,
      evidenceFingerprint: sha256(disposition),
    });

    const displayName = asText(row.fields["Full Name"]) ||
      [asText(row.fields["First Name"]), asText(row.fields["Last Name"])]
        .filter(Boolean)
        .join(" ");
    if (!row.normalizedEmail || !displayName) return blocked("invalid_source_identity");
    if (
      (rawCounts.get(row.rawFingerprint) || 0) > 1 ||
      (emailCounts.get(row.normalizedEmail) || 0) > 1 ||
      (row.normalizedPhone && (phoneToEmails.get(row.normalizedPhone)?.size || 0) > 1)
    ) {
      return blocked("duplicate_source_identity");
    }

    const existingEmails = emailContacts.get(row.normalizedEmail) || [];
    if (existingEmails.length > 1) return blocked("canonical_identity_conflict");
    const provisionalPersonId = shortId(
      "crp",
      `person:v1|${workspaceId}|${row.normalizedEmail}`
    );
    const provisionalEmailId = shortId(
      "crc",
      `email:v1|${workspaceId}|${row.normalizedEmail}`
    );
    const existingEmail = existingEmails[0] || null;
    const existingPersonIds = existingEmail ? documentPersonIds(existingEmail.data) : [];
    if (existingPersonIds.length > 1) return blocked("canonical_identity_conflict");
    const rowEmailKey = emailKey(workspaceId, row.normalizedEmail);
    const sourcePersonIds = [
      ...new Set(
        snapshot.sourceRecords.docs
          .filter((document) => {
            const data = document.data();
            return (
              asText(data.emailKey) === rowEmailKey ||
              normalizedEmailFromDocument(data) === row.normalizedEmail
            );
          })
          .flatMap((document) => documentPersonIds(document.data()))
      ),
    ];
    if (
      sourcePersonIds.length > 1 ||
      (existingPersonIds[0] &&
        sourcePersonIds[0] &&
        existingPersonIds[0] !== sourcePersonIds[0])
    ) {
      return blocked("canonical_identity_conflict");
    }
    const sourcePersonId = sourcePersonIds[0] || null;
    const personId = existingPersonIds[0] || sourcePersonId || provisionalPersonId;
    const emailContactPointId = existingEmail?.id || provisionalEmailId;
    const existingPerson = peopleById.get(personId) || null;
    if (
      ((existingEmail || sourcePersonId) && !existingPerson) ||
      (!existingEmail &&
        !sourcePersonId &&
        (peopleById.has(provisionalPersonId) || contactsById.has(provisionalEmailId))) ||
      (!existingEmail && contactsById.has(provisionalEmailId))
    ) {
      return blocked("canonical_identity_conflict");
    }

    const existingPhones = row.normalizedPhone
      ? phoneContacts.get(row.normalizedPhone) || []
      : [];
    if (existingPhones.length > 1) return blocked("canonical_identity_conflict");
    const existingPhone = existingPhones[0] || null;
    if (
      existingPhone &&
      (documentPersonIds(existingPhone.data).length !== 1 ||
        documentPersonIds(existingPhone.data)[0] !== personId)
    ) {
      return blocked("canonical_identity_conflict");
    }
    const provisionalPhoneId = row.normalizedPhone
      ? shortId("crc", `phone:v1|${workspaceId}|${row.normalizedPhone}`)
      : null;
    if (
      !existingPhone &&
      provisionalPhoneId &&
      contactsById.has(provisionalPhoneId)
    ) {
      return blocked("canonical_identity_conflict");
    }
    const phoneContactPointId = existingPhone?.id || provisionalPhoneId;
    const contactPointIds = [emailContactPointId, phoneContactPointId].filter(
      (value): value is string => Boolean(value)
    );

    if (
      contactIsSuppressed(existingEmail?.data || null) ||
      contactIsSuppressed(existingPhone?.data || null)
    ) {
      return blocked("suppressed");
    }
    if (isSuppressed(snapshot.suppressions, row, workspaceId, personId, contactPointIds)) {
      return blocked("suppressed");
    }
    if (isOpenConflict(snapshot.importConflicts, row, workspaceId, personId, contactPointIds)) {
      return blocked("open_import_conflict");
    }

    const relatedPermissions = relatedPermissionEvidence(
      snapshot.permissionEvents,
      row,
      workspaceId,
      personId,
      contactPointIds
    );
    const permissionDisposition = permissionBlock(
      existingEmail?.data || null,
      existingPhone?.data || null,
      relatedPermissions
    );
    if (permissionDisposition) return blocked(permissionDisposition);

    const existingSource = sourceById.get(sourceRecordId) || null;
    const duplicateSourceBinding = snapshot.sourceRecords.docs.some((document) => {
      if (document.id === sourceRecordId) return false;
      const data = document.data();
      return (
        data.sourceSystem === SOURCE_SYSTEM &&
        data.sourceReceiptSha256 === ROSSER_GALLERY_DOT_CARD_EXACT_RECEIPT &&
        data.sourceRowKey === row.sourceRowKey
      );
    });
    if (
      duplicateSourceBinding ||
      (existingSource &&
        !immutableSourceMatches(
          existingSource,
          row,
          workspaceId,
          personId,
          emailContactPointId,
          phoneContactPointId
        ))
    ) {
      return blocked("immutable_import_record_conflict");
    }

    const existingPermission = permissionsById.get(permissionEventId) || null;
    const duplicatePermissionBinding = snapshot.permissionEvents.docs.some((document) => {
      if (document.id === permissionEventId) return false;
      const data = document.data();
      return (
        data.attestationEvidenceId === ATTESTATION_EVIDENCE_ID &&
        data.sourceRowKey === row.sourceRowKey
      );
    });
    if (
      duplicatePermissionBinding ||
      (existingPermission &&
        !immutablePermissionMatches(
          existingPermission,
          row,
          workspaceId,
          personId,
          emailContactPointId,
          sourceRecordId
        ))
    ) {
      return blocked("immutable_import_record_conflict");
    }

    const createPerson = !existingPerson;
    const linkPersonBrand = Boolean(
      existingPerson && !asStringArray(existingPerson.relationshipBrandIds).includes(BRAND_ID)
    );
    const createEmailContactPoint = !existingEmail;
    const createPhoneContactPoint = Boolean(row.normalizedPhone && !existingPhone);
    const createSourceRecord = !existingSource;
    const createPermissionEvent = !existingPermission;
    const writes = [
      createPerson,
      linkPersonBrand,
      createEmailContactPoint,
      createPhoneContactPoint,
      createSourceRecord,
      createPermissionEvent,
    ].filter(Boolean).length;
    const disposition: RosserGalleryCardCanonicalDisposition =
      writes === 0
        ? "already_imported"
        : createPerson
          ? "ready_new_contact"
          : "ready_existing_contact";
    return {
      sourceRow: row,
      disposition,
      personId,
      emailContactPointId,
      phoneContactPointId,
      sourceRecordId,
      permissionEventId,
      createPerson,
      linkPersonBrand,
      createEmailContactPoint,
      createPhoneContactPoint,
      createSourceRecord,
      createPermissionEvent,
      evidenceFingerprint: sha256(
        canonicalize({
          relatedPermissions,
          sourceExists: Boolean(existingSource),
          permissionExists: Boolean(existingPermission),
          personBrandLinked: !linkPersonBrand,
        })
      ),
    };
  });

  const dispositionCounts = emptyDispositions();
  const writes = emptyWrites();
  for (const row of rows) {
    dispositionCounts[row.disposition] += 1;
    if (row.createPerson) writes.peopleCreated += 1;
    if (row.linkPersonBrand) writes.peopleBrandLinked += 1;
    if (row.createEmailContactPoint) writes.emailContactPointsCreated += 1;
    if (row.createPhoneContactPoint) writes.identityOnlyPhoneContactPointsCreated += 1;
    if (row.createSourceRecord) writes.sourceRecordsCreated += 1;
    if (row.createPermissionEvent) writes.reconfirmPermissionEventsCreated += 1;
  }
  writes.total =
    writes.peopleCreated +
    writes.peopleBrandLinked +
    writes.emailContactPointsCreated +
    writes.identityOnlyPhoneContactPointsCreated +
    writes.sourceRecordsCreated +
    writes.reconfirmPermissionEventsCreated;

  const planFingerprint = sha256(
    canonicalize({
      contract: ROSSER_GALLERY_CARD_RECONCILER_SCHEMA_VERSION,
      sourceReceipt: source.sourceReceiptSha256,
      workspaceBinding: sha256(workspaceId),
      attestationEvidenceId: ATTESTATION_EVIDENCE_ID,
      rows: rows.map((row) => ({
        sourceRowKey: row.sourceRow.sourceRowKey,
        disposition: row.disposition,
        personId: row.personId,
        emailContactPointId: row.emailContactPointId,
        phoneContactPointId: row.phoneContactPointId,
        sourceRecordId: row.sourceRecordId,
        permissionEventId: row.permissionEventId,
        writes: [
          row.createPerson,
          row.linkPersonBrand,
          row.createEmailContactPoint,
          row.createPhoneContactPoint,
          row.createSourceRecord,
          row.createPermissionEvent,
        ],
        evidenceFingerprint: row.evidenceFingerprint,
      })),
    })
  );
  return {
    rows,
    planFingerprint,
    dispositionCounts,
    writes,
    observed: {
      people: snapshot.people.docs.length,
      contactPoints: snapshot.contactPoints.docs.length,
      sourceRecords: snapshot.sourceRecords.docs.length,
      permissionEvents: snapshot.permissionEvents.docs.length,
      suppressions: snapshot.suppressions.docs.length,
      importConflicts: snapshot.importConflicts.docs.length,
    },
  };
}

function compactSourceFields(row: RosserGalleryCardCanonicalSourceRow) {
  const field = (name: keyof RosserGalleryCardCanonicalSourceRow["fields"]) =>
    asText(row.fields[name]);
  return {
    slug: field("Slug"),
    website: field("Website"),
    address: field("Address"),
    company: field("Company"),
    jobTitle: field("Job Title"),
    sourceLabel: field("Source"),
    locationMet: field("Location Met"),
    dateMet: field("Date Met"),
    timeMet: field("Time Met"),
    meetingNote: field("Meeting Note"),
    personalNotes: field("Personal Notes"),
  };
}

function writePlan(
  transaction: Transaction,
  db: Firestore,
  workspaceId: string,
  plan: CanonicalPlan
): void {
  const timestamp = FieldValue.serverTimestamp();
  for (const row of plan.rows) {
    if (!row.personId || !row.emailContactPointId) continue;
    if (
      !["ready_new_contact", "ready_existing_contact"].includes(row.disposition)
    ) {
      continue;
    }
    const source = row.sourceRow;
    const displayName = (
      asText(source.fields["Full Name"]) ||
      [asText(source.fields["First Name"]), asText(source.fields["Last Name"])]
        .filter(Boolean)
        .join(" ")
    ).slice(0, 160);
    const personRef = db.collection(COLLECTIONS.people).doc(row.personId);
    if (row.createPerson) {
      transaction.create(personRef, {
        schemaVersion: 1,
        workspaceId,
        displayName,
        firstName: asText(source.fields["First Name"]),
        lastName: asText(source.fields["Last Name"]),
        relationshipBrandIds: [BRAND_ID],
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    } else if (row.linkPersonBrand) {
      transaction.set(
        personRef,
        {
          relationshipBrandIds: FieldValue.arrayUnion(BRAND_ID),
        },
        { merge: true }
      );
    }

    if (row.createEmailContactPoint) {
      transaction.create(
        db.collection(COLLECTIONS.contactPoints).doc(row.emailContactPointId),
        {
          schemaVersion: 1,
          workspaceId,
          personId: row.personId,
          type: "email",
          value: source.normalizedEmail,
          normalizedValue: source.normalizedEmail,
          emailKey: emailKey(workspaceId, source.normalizedEmail!),
          primary: true,
          defaultPermissionState: "reconfirm_required",
          relationshipBrandId: BRAND_ID,
          createdAt: timestamp,
          updatedAt: timestamp,
        }
      );
    }

    if (row.createPhoneContactPoint && row.phoneContactPointId && source.normalizedPhone) {
      transaction.create(
        db.collection(COLLECTIONS.contactPoints).doc(row.phoneContactPointId),
        {
          schemaVersion: 1,
          workspaceId,
          personId: row.personId,
          type: "phone",
          value: asText(source.fields["Phone Number"]),
          normalizedValue: source.normalizedPhone,
          primary: false,
          defaultPermissionState: "unknown",
          purpose: "identity_reconciliation_only",
          outreachAllowed: false,
          smsPermissionState: "not_attested",
          callPermissionState: "not_attested",
          relationshipBrandId: BRAND_ID,
          createdAt: timestamp,
          updatedAt: timestamp,
        }
      );
    }

    if (row.createSourceRecord) {
      const contactPointIds = [row.emailContactPointId, row.phoneContactPointId].filter(
        (value): value is string => Boolean(value)
      );
      transaction.create(
        db.collection(COLLECTIONS.sourceRecords).doc(row.sourceRecordId),
        {
          schemaVersion: 1,
          workspaceId,
          personId: row.personId,
          contactPointId: row.emailContactPointId,
          contactPointIds,
          sourceSystem: SOURCE_SYSTEM,
          sourceReceiptSha256: ROSSER_GALLERY_DOT_CARD_EXACT_RECEIPT,
          sourceRowKey: source.sourceRowKey,
          sourceRowFingerprint: source.rawFingerprint,
          emailKey: emailKey(workspaceId, source.normalizedEmail!),
          relationshipBrandId: BRAND_ID,
          permissionBasis: "owner_attestation_requires_reconfirmation",
          attestationEvidenceId: ATTESTATION_EVIDENCE_ID,
          attestationStatement: ATTESTATION_STATEMENT,
          attestationInterpretation: ATTESTATION_INTERPRETATION,
          requiresReconfirmation: true,
          broadMarketingOptIn: false,
          phonePurpose: "identity_reconciliation_only",
          sourceFields: compactSourceFields(source),
          observedAt: timestamp,
          createdAt: timestamp,
          updatedAt: timestamp,
        }
      );
    }

    if (row.createPermissionEvent) {
      transaction.create(
        db.collection(COLLECTIONS.permissionEvents).doc(row.permissionEventId),
        {
          schemaVersion: 1,
          workspaceId,
          personId: row.personId,
          contactPointId: row.emailContactPointId,
          channel: "email",
          eventType: "historical_relationship_attestation_recorded",
          permissionState: "reconfirm_required",
          relationshipBrandId: BRAND_ID,
          sourceSystem: SOURCE_SYSTEM,
          sourceRecordId: row.sourceRecordId,
          sourceRowKey: source.sourceRowKey,
          sourceReceiptSha256: ROSSER_GALLERY_DOT_CARD_EXACT_RECEIPT,
          emailKey: emailKey(workspaceId, source.normalizedEmail!),
          attestationEvidenceId: ATTESTATION_EVIDENCE_ID,
          attestationStatement: ATTESTATION_STATEMENT,
          attestationInterpretation: ATTESTATION_INTERPRETATION,
          attestedByRole: "workspace_owner",
          attestedOn: "2026-08-13",
          consentScope: "prior_rosser_gallery_relationship_reintroduction_review",
          broadMarketingOptIn: false,
          reconfirmationRequired: true,
          sendsAuthorized: false,
          smsPermissionGranted: false,
          callPermissionGranted: false,
          occurredAt: timestamp,
          createdAt: timestamp,
        }
      );
    }
  }
}

function reportFromPlan(
  input: RosserGalleryCardCanonicalInput,
  plan: CanonicalPlan,
  mode: "dry_run" | "apply",
  executed: boolean
): RosserGalleryCardCanonicalReport {
  const safeRows =
    plan.dispositionCounts.ready_new_contact +
    plan.dispositionCounts.ready_existing_contact;
  return {
    schemaVersion: ROSSER_GALLERY_CARD_RECONCILER_SCHEMA_VERSION,
    mode,
    dataClassification: "aggregate_only",
    correlationId: input.correlationId,
    source: {
      sourceSystem: SOURCE_SYSTEM,
      exactReceipt: ROSSER_GALLERY_DOT_CARD_EXACT_RECEIPT,
      receiptMatched: true,
      rows: input.source.rows.length,
    },
    workspace: {
      binding: "server_derived_owner_default",
      accessRole: "owner",
      brandId: BRAND_ID,
    },
    provenance: {
      evidenceId: ATTESTATION_EVIDENCE_ID,
      interpretation: ATTESTATION_INTERPRETATION,
    },
    boundedReads: {
      limits: ROSSER_GALLERY_CARD_READ_CAPS,
      observed: plan.observed,
    },
    reconciliation: {
      dispositionCounts: plan.dispositionCounts,
      safeRows,
      heldRows:
        input.source.rows.length - safeRows - plan.dispositionCounts.already_imported,
      alreadyImportedRows: plan.dispositionCounts.already_imported,
    },
    proposedWrites: plan.writes,
    apply: {
      planFingerprint: plan.planFingerprint,
      confirmationRequired: rosserGalleryCardApplyConfirmation(plan.planFingerprint),
      executed,
      writesApplied: executed ? plan.writes.total : 0,
    },
    permissionBoundary: {
      emailState: "reconfirm_required",
      broadMarketingOptInClaimed: false,
      phonePurpose: "identity_reconciliation_only",
      smsPermissionGranted: false,
      callPermissionGranted: false,
    },
    authority: {
      contactsMayBeWritten: executed,
      sends: false,
      drafts: false,
      sms: false,
      calls: false,
      socialLookup: false,
    },
  };
}

function validateInput(input: RosserGalleryCardCanonicalInput): "dry_run" | "apply" {
  const mode = input.mode || "dry_run";
  if (
    !IDENTIFIER_PATTERN.test(input.correlationId) ||
    !IDENTIFIER_PATTERN.test(input.requestedWorkspaceId)
  ) {
    throw new RosserGalleryCardReconciliationError(
      "invalid_request",
      "The import request binding is invalid."
    );
  }
  const sourceShapeValid = input.source.rows.every((row, index) => {
    const rawFingerprint = sha256(canonicalize(row.fields));
    const expectedSourceRowKey = shortId(
      "crs",
      `dot-card-source-row:v1|${ROSSER_GALLERY_DOT_CARD_EXACT_RECEIPT}|${index + 1}|${rawFingerprint}`
    );
    return Boolean(
      row.rowNumber === index + 1 &&
        row.rawFingerprint === rawFingerprint &&
        row.sourceRowKey === expectedSourceRowKey &&
        row.normalizedEmail === normalizeEmail(row.fields.Email) &&
        row.normalizedPhone === normalizePhone(row.fields["Phone Number"])
    );
  });
  if (!sourceShapeValid) {
    throw new RosserGalleryCardReconciliationError(
      "source_receipt_mismatch",
      "The parsed source rows do not match the reviewed source binding."
    );
  }
  const canonicalWorkspaceId = canonicalRosserGalleryWorkspaceIdForOwner(input.ownerUid);
  if (input.requestedWorkspaceId !== canonicalWorkspaceId) {
    throw new RosserGalleryCardReconciliationError(
      "workspace_binding_mismatch",
      "The requested workspace does not match the server-derived owner workspace."
    );
  }
  if (
    input.source.sourceReceiptSha256 !== ROSSER_GALLERY_DOT_CARD_EXACT_RECEIPT ||
    input.source.rows.length !== ROSSER_GALLERY_DOT_CARD_EXPECTED_ROWS ||
    (input.requestedSourceReceipt &&
      input.requestedSourceReceipt !== ROSSER_GALLERY_DOT_CARD_EXACT_RECEIPT)
  ) {
    throw new RosserGalleryCardReconciliationError(
      "source_receipt_mismatch",
      "Only the reviewed Rosser Gallery Dot-card source receipt is accepted."
    );
  }
  if (mode === "apply" && input.requestedSourceReceipt !== ROSSER_GALLERY_DOT_CARD_EXACT_RECEIPT) {
    throw new RosserGalleryCardReconciliationError(
      "source_receipt_mismatch",
      "Apply requires the exact reviewed source receipt."
    );
  }
  if (mode !== "apply" && input.confirmation) {
    throw new RosserGalleryCardReconciliationError(
      "invalid_request",
      "Confirmation is accepted only with explicit apply mode."
    );
  }
  return mode;
}

export async function reconcileRosserGalleryCardImport(
  input: RosserGalleryCardCanonicalInput
): Promise<RosserGalleryCardCanonicalReport> {
  const mode = validateInput(input);
  if (mode === "dry_run") {
    const snapshot = await loadCanonicalSnapshot(
      input.db,
      {
        getDocument: (reference) => reference.get(),
        getQuery: (query) => query.get(),
      },
      input.ownerUid,
      input.requestedWorkspaceId
    );
    const plan = buildPlan(input.source, input.requestedWorkspaceId, snapshot);
    const report = reportFromPlan(input, plan, mode, false);
    input.log?.info("crm.rosser_gallery_card_import.reconciled", {
      correlationId: input.correlationId,
      mode,
      rows: report.source.rows,
      safeRows: report.reconciliation.safeRows,
      heldRows: report.reconciliation.heldRows,
      alreadyImportedRows: report.reconciliation.alreadyImportedRows,
      proposedWrites: report.proposedWrites.total,
      planFingerprint: report.apply.planFingerprint,
      externalMessages: 0,
    });
    return report;
  }

  const report = await input.db.runTransaction(async (transaction) => {
    const snapshot = await loadCanonicalSnapshot(
      input.db,
      {
        getDocument: (reference) => transaction.get(reference),
        getQuery: (query) => transaction.get(query),
      },
      input.ownerUid,
      input.requestedWorkspaceId
    );
    const plan = buildPlan(input.source, input.requestedWorkspaceId, snapshot);
    if (input.confirmation !== rosserGalleryCardApplyConfirmation(plan.planFingerprint)) {
      throw new RosserGalleryCardReconciliationError(
        "apply_confirmation_mismatch",
        "The explicit confirmation does not match the fresh canonical reconciliation plan."
      );
    }
    writePlan(transaction, input.db, input.requestedWorkspaceId, plan);
    return reportFromPlan(input, plan, mode, true);
  });
  input.log?.info("crm.rosser_gallery_card_import.applied", {
    correlationId: input.correlationId,
    mode,
    rows: report.source.rows,
    safeRows: report.reconciliation.safeRows,
    heldRows: report.reconciliation.heldRows,
    alreadyImportedRows: report.reconciliation.alreadyImportedRows,
    writesApplied: report.apply.writesApplied,
    planFingerprint: report.apply.planFingerprint,
    externalMessages: 0,
  });
  return report;
}
