import { createHash } from "node:crypto";
import { domainToASCII } from "node:url";

export const ROSSER_GALLERY_CARD_IMPORT_SCHEMA_VERSION =
  "crm.rosser-gallery-card-import-dry-run.v1" as const;

export const ROSSER_GALLERY_CARD_ATTESTATION = Object.freeze({
  evidenceId: "owner-attestation-2026-08-13-rosser-gallery-dot-card",
  assertedOn: "2026-08-13",
  assertedByRole: "workspace_owner",
  brandId: "rosser_gallery",
  statement:
    "These all do approved to be able to be contacted and tend to be our original fan base and community.",
  interpretation:
    "Cohort-level evidence of a prior Rosser Gallery relationship and claimed approval to contact; canonical per-contact permission remains subject to reconciliation.",
  channelScope: {
    email: "claimed_prior_approval_pending_reconciliation",
    sms: "not_attested",
    phoneCalls: "not_attested",
    socialDirectMessages: "not_attested",
  },
} as const);

export const DOT_CARD_EXPORT_HEADERS = [
  "Slug",
  "Full Name",
  "First Name",
  "Last Name",
  "Email",
  "Phone Number",
  "Website",
  "Address",
  "Company",
  "Job Title",
  "Source",
  "Location Met",
  "Date Met",
  "Time Met",
  "Meeting Note",
  "Personal Notes",
] as const;

const MAX_SOURCE_BYTES = 5 * 1024 * 1024;
const MAX_SOURCE_ROWS = 50_000;
const MAX_FIELD_CHARACTERS = 20_000;

export type RosserGalleryPermissionState =
  | "unknown"
  | "opted_in"
  | "opted_out"
  | "reconfirm_required"
  | "transactional_only"
  | "other";

export interface RosserGalleryCardReconciliationEvidence {
  schemaVersion: "crm.rosser-gallery-card-reconciliation.v1";
  sourceReceiptSha256: string;
  workspaceDiscriminator: string;
  byEmailKey: Record<
    string,
    {
      matchingPersonCount: number;
      matchingContactPointCount: number;
      permissionEventCount: number;
      latestPermissionState: RosserGalleryPermissionState | null;
      suppressed: boolean;
      openImportConflict: boolean;
    }
  >;
}

export interface RosserGalleryCardDryRunInput {
  sourceBytes: Uint8Array;
  sourceFileName: string;
  workspaceDiscriminator?: string;
  reconciliation?: RosserGalleryCardReconciliationEvidence;
}

export type RosserGalleryCardRowDisposition =
  | "invalid_email"
  | "duplicate_source_row"
  | "duplicate_email_in_source"
  | "identity_conflict_in_source"
  | "reconciliation_not_supplied"
  | "canonical_identity_conflict"
  | "open_import_conflict"
  | "suppressed"
  | "opted_out"
  | "transactional_only"
  | "permission_event_missing"
  | "permission_state_unresolved"
  | "reviewable_existing_contact"
  | "reviewable_new_contact";

export interface RosserGalleryCardDryRunReport {
  schemaVersion: typeof ROSSER_GALLERY_CARD_IMPORT_SCHEMA_VERSION;
  mode: "dry_run_review_only";
  dataClassification: "aggregate_only";
  source: {
    sourceSystem: "dot_card_csv";
    registrySummaryBucket: "other";
    fileName: string;
    receipt: {
      algorithm: "sha256";
      sha256: string;
      bytes: number;
      rows: number;
      columns: number;
      headerFingerprint: string;
    };
  };
  provenance: typeof ROSSER_GALLERY_CARD_ATTESTATION;
  quality: {
    rows: number;
    exactDuplicateRows: number;
    completeNameRows: number;
    emailPresentRows: number;
    validEmailRows: number;
    invalidEmailRows: number;
    duplicateNormalizedEmailRows: number;
    duplicateSlugRows: number;
    duplicateNormalizedNameRows: number;
    phonePresentRows: number;
    normalizedPhoneIdentityRows: number;
    duplicateNormalizedPhoneRows: number;
    datePresentRows: number;
    parseableDateRows: number;
    sourceCategoryCount: number;
    populatedByColumn: Record<string, number>;
  };
  reconciliation: {
    evidenceSupplied: boolean;
    evidenceReceiptMatched: boolean;
    dispositionCounts: Record<RosserGalleryCardRowDisposition, number>;
    heldRows: number;
    reviewableForImportRows: number;
    readyForLiveWriteRows: 0;
    readyForOutreachRows: 0;
  };
  proposedRegistryShape: {
    relationshipBrandId: "rosser_gallery";
    sourceSystem: "dot_card_csv";
    registrySummaryBucket: "other";
    emailDefaultPermissionState: "reconfirm_required";
    phonePurpose: "identity_reconciliation_only";
    deterministicIds: "workspace_scoped_sha256_v1";
    exactSourceReceiptRequired: true;
    permissionEventRequiredBeforeWrite: true;
  };
  authority: {
    liveWrites: false;
    sends: false;
    drafts: false;
    sms: false;
    calls: false;
    scraping: false;
    socialLookup: false;
    applySupported: false;
  };
  planFingerprint: string;
}

type Row = Record<(typeof DOT_CARD_EXPORT_HEADERS)[number], string>;

/**
 * Server-internal row shape for the canonical reconciler. This contains PII
 * and must never be serialized into reports, logs, or client responses.
 */
export interface RosserGalleryCardCanonicalSourceRow {
  rowNumber: number;
  fields: Readonly<Row>;
  normalizedEmail: string | null;
  normalizedPhone: string | null;
  rawFingerprint: string;
  sourceRowKey: string;
}

/**
 * Server-internal parsed source. Callers are responsible for keeping `rows`
 * inside the trusted import boundary; only aggregate reports may leave it.
 */
export interface RosserGalleryCardCanonicalSource {
  sourceReceiptSha256: string;
  headerFingerprint: string;
  rows: ReadonlyArray<RosserGalleryCardCanonicalSourceRow>;
}

type PreparedRow = {
  sourceRowKey: string;
  provisionalPersonId: string | null;
  provisionalEmailContactPointId: string | null;
  emailKey: string | null;
  normalizedEmail: string | null;
  normalizedPhone: string | null;
  hasName: boolean;
  hasEmail: boolean;
  hasPhone: boolean;
  hasDate: boolean;
  dateParseable: boolean;
  rawFingerprint: string;
  disposition: RosserGalleryCardRowDisposition;
};

export class RosserGalleryCardImportError extends Error {
  readonly code:
    | "invalid_source"
    | "source_too_large"
    | "schema_mismatch"
    | "row_limit_exceeded"
    | "reconciliation_mismatch";

  constructor(
    code:
      | "invalid_source"
      | "source_too_large"
      | "schema_mismatch"
      | "row_limit_exceeded"
      | "reconciliation_mismatch",
    message: string
  ) {
    super(message);
    this.name = "RosserGalleryCardImportError";
    this.code = code;
  }
}

function sha256(value: string | Uint8Array): string {
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

export function rosserGalleryCardEmailKey(
  workspaceDiscriminator: string,
  normalizedEmail: string
): string {
  return sha256(`email:v1|${workspaceDiscriminator}|${normalizedEmail}`);
}

function nonEmpty(value: string): boolean {
  return value.trim().length > 0;
}

export function normalizeRosserGalleryCardEmail(value: string): string | null {
  const normalized = String(value || "").normalize("NFKC").trim();
  if (
    !normalized ||
    normalized.length > 254 ||
    /[\u0000-\u0020\u007f]/.test(normalized)
  ) {
    return null;
  }
  const at = normalized.lastIndexOf("@");
  if (at <= 0 || at !== normalized.indexOf("@")) return null;
  const local = normalized.slice(0, at);
  const rawDomain = normalized.slice(at + 1);
  if (!local || local.length > 64 || !rawDomain) return null;
  if (
    local.startsWith(".") ||
    local.endsWith(".") ||
    local.includes("..") ||
    !/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(local)
  ) {
    return null;
  }
  const domain = domainToASCII(rawDomain).toLowerCase();
  if (!domain || domain.length > 253 || domain.startsWith(".") || domain.endsWith(".")) {
    return null;
  }
  const labels = domain.split(".");
  if (
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

function normalizePhoneIdentity(value: string): string | null {
  const digits = value.replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 15 ? digits : null;
}

function parseCsv(source: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let quoteClosed = false;
  let index = source.charCodeAt(0) === 0xfeff ? 1 : 0;

  const pushField = () => {
    if (field.length > MAX_FIELD_CHARACTERS) {
      throw new RosserGalleryCardImportError(
        "invalid_source",
        "A CSV field exceeds the bounded review limit."
      );
    }
    row.push(field);
    field = "";
    quoteClosed = false;
  };
  const pushRow = () => {
    pushField();
    if (!(row.length === 1 && row[0] === "")) rows.push(row);
    row = [];
    if (rows.length > MAX_SOURCE_ROWS + 1) {
      throw new RosserGalleryCardImportError(
        "row_limit_exceeded",
        "The CSV exceeds the bounded review row limit."
      );
    }
  };

  while (index < source.length) {
    const character = source[index];
    if (quoted) {
      if (character === '"') {
        if (source[index + 1] === '"') {
          field += '"';
          index += 2;
          continue;
        }
        quoted = false;
        quoteClosed = true;
        index += 1;
        continue;
      }
      field += character;
      index += 1;
      continue;
    }
    if (quoteClosed && character !== "," && character !== "\r" && character !== "\n") {
      throw new RosserGalleryCardImportError(
        "invalid_source",
        "The CSV contains data after a closing quote."
      );
    }
    if (character === '"') {
      if (field.length > 0) {
        throw new RosserGalleryCardImportError(
          "invalid_source",
          "The CSV contains an invalid quote boundary."
        );
      }
      quoted = true;
      index += 1;
      continue;
    }
    if (character === ",") {
      pushField();
      index += 1;
      continue;
    }
    if (character === "\r" || character === "\n") {
      if (character === "\r" && source[index + 1] === "\n") index += 1;
      pushRow();
      index += 1;
      continue;
    }
    field += character;
    index += 1;
  }
  if (quoted) {
    throw new RosserGalleryCardImportError(
      "invalid_source",
      "The CSV contains an unterminated quoted field."
    );
  }
  if (field.length > 0 || row.length > 0) pushRow();
  return rows;
}

function rowsFromSource(sourceBytes: Uint8Array): { rows: Row[]; headerFingerprint: string } {
  if (sourceBytes.byteLength === 0) {
    throw new RosserGalleryCardImportError("invalid_source", "The CSV is empty.");
  }
  if (sourceBytes.byteLength > MAX_SOURCE_BYTES) {
    throw new RosserGalleryCardImportError(
      "source_too_large",
      "The CSV exceeds the bounded review byte limit."
    );
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(sourceBytes);
  } catch {
    throw new RosserGalleryCardImportError(
      "invalid_source",
      "The CSV must use valid UTF-8 encoding."
    );
  }
  const parsed = parseCsv(text);
  const headers = parsed.shift();
  if (
    !headers ||
    headers.length !== DOT_CARD_EXPORT_HEADERS.length ||
    headers.some((header, index) => header !== DOT_CARD_EXPORT_HEADERS[index])
  ) {
    throw new RosserGalleryCardImportError(
      "schema_mismatch",
      "The CSV header does not match the supported Dot contact export schema."
    );
  }
  const rows = parsed.map((values) => {
    if (values.length !== DOT_CARD_EXPORT_HEADERS.length) {
      throw new RosserGalleryCardImportError(
        "schema_mismatch",
        "A CSV row does not match the supported Dot contact export schema."
      );
    }
    return Object.fromEntries(
      DOT_CARD_EXPORT_HEADERS.map((header, index) => [header, values[index]])
    ) as Row;
  });
  return { rows, headerFingerprint: sha256(canonicalize(headers)) };
}

export function parseRosserGalleryCardSourceForCanonicalImport(
  inputBytes: Uint8Array
): RosserGalleryCardCanonicalSource {
  const sourceBytes = new Uint8Array(inputBytes);
  const sourceReceiptSha256 = sha256(sourceBytes);
  const { rows, headerFingerprint } = rowsFromSource(sourceBytes);
  return {
    sourceReceiptSha256,
    headerFingerprint,
    rows: rows.map((row, index) => {
      const rawFingerprint = sha256(canonicalize(row));
      return {
        rowNumber: index + 1,
        fields: Object.freeze({ ...row }),
        normalizedEmail: normalizeRosserGalleryCardEmail(row.Email),
        normalizedPhone: normalizePhoneIdentity(row["Phone Number"]),
        rawFingerprint,
        sourceRowKey: shortId(
          "crs",
          `dot-card-source-row:v1|${sourceReceiptSha256}|${index + 1}|${rawFingerprint}`
        ),
      };
    }),
  };
}

function parseableSourceDate(value: string): boolean {
  if (!nonEmpty(value)) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed);
}

function boundedCount(value: unknown): number {
  const count = Number(value);
  return Number.isSafeInteger(count) && count >= 0 ? count : 0;
}

function dispositionFromEvidence(
  prepared: PreparedRow,
  evidence: RosserGalleryCardReconciliationEvidence["byEmailKey"][string] | undefined
): RosserGalleryCardRowDisposition {
  if (!prepared.normalizedEmail || !prepared.emailKey) return "invalid_email";
  if (!evidence) return "reconciliation_not_supplied";
  const personCount = boundedCount(evidence.matchingPersonCount);
  const contactCount = boundedCount(evidence.matchingContactPointCount);
  if (evidence.suppressed) return "suppressed";
  if (evidence.latestPermissionState === "opted_out") return "opted_out";
  if (evidence.latestPermissionState === "transactional_only") return "transactional_only";
  if (evidence.openImportConflict) return "open_import_conflict";
  if (personCount > 1 || contactCount > 1 || contactCount > personCount) {
    return "canonical_identity_conflict";
  }
  if (boundedCount(evidence.permissionEventCount) === 0) return "permission_event_missing";
  if (
    evidence.latestPermissionState !== "opted_in" &&
    evidence.latestPermissionState !== "reconfirm_required"
  ) {
    return "permission_state_unresolved";
  }
  return contactCount === 1 ? "reviewable_existing_contact" : "reviewable_new_contact";
}

function emptyDispositionCounts(): Record<RosserGalleryCardRowDisposition, number> {
  return {
    invalid_email: 0,
    duplicate_source_row: 0,
    duplicate_email_in_source: 0,
    identity_conflict_in_source: 0,
    reconciliation_not_supplied: 0,
    canonical_identity_conflict: 0,
    open_import_conflict: 0,
    suppressed: 0,
    opted_out: 0,
    transactional_only: 0,
    permission_event_missing: 0,
    permission_state_unresolved: 0,
    reviewable_existing_contact: 0,
    reviewable_new_contact: 0,
  };
}

export function buildRosserGalleryCardDryRun(
  input: RosserGalleryCardDryRunInput
): RosserGalleryCardDryRunReport {
  const sourceBytes = new Uint8Array(input.sourceBytes);
  const sourceReceiptSha256 = sha256(sourceBytes);
  const workspaceDiscriminator =
    String(input.workspaceDiscriminator || "review-only:rosser_gallery").trim() ||
    "review-only:rosser_gallery";
  const { rows, headerFingerprint } = rowsFromSource(sourceBytes);
  const requestedFileName = String(input.sourceFileName || "dot_contact_export.csv")
    .replace(/\\/g, "/")
    .split("/")
    .pop()!;
  const fileName =
    requestedFileName.toLowerCase() === "dot_contact_export.csv"
      ? "dot_contact_export.csv"
      : "dot-contact-export.csv";

  if (
    input.reconciliation &&
    (input.reconciliation.sourceReceiptSha256 !== sourceReceiptSha256 ||
      input.reconciliation.workspaceDiscriminator !== workspaceDiscriminator)
  ) {
    throw new RosserGalleryCardImportError(
      "reconciliation_mismatch",
      "The reconciliation evidence is not bound to this exact source receipt and workspace."
    );
  }

  const rawFingerprintCounts = new Map<string, number>();
  const emailCounts = new Map<string, number>();
  const slugCounts = new Map<string, number>();
  const nameCounts = new Map<string, number>();
  const phoneToEmails = new Map<string, Set<string>>();
  const populatedByColumn = Object.fromEntries(
    DOT_CARD_EXPORT_HEADERS.map((header) => [header, 0])
  ) as Record<string, number>;

  const preparedRows = rows.map<PreparedRow>((row, index) => {
    for (const header of DOT_CARD_EXPORT_HEADERS) {
      if (nonEmpty(row[header])) populatedByColumn[header] += 1;
    }
    const normalizedEmail = normalizeRosserGalleryCardEmail(row.Email);
    const normalizedPhone = normalizePhoneIdentity(row["Phone Number"]);
    const normalizedSlug = row.Slug.normalize("NFKC").trim().toLowerCase();
    const normalizedName = (
      row["Full Name"] || `${row["First Name"]} ${row["Last Name"]}`
    )
      .normalize("NFKC")
      .trim()
      .replace(/\s+/g, " ")
      .toLowerCase();
    const rawFingerprint = sha256(canonicalize(row));
    rawFingerprintCounts.set(
      rawFingerprint,
      (rawFingerprintCounts.get(rawFingerprint) || 0) + 1
    );
    if (normalizedEmail) {
      emailCounts.set(normalizedEmail, (emailCounts.get(normalizedEmail) || 0) + 1);
    }
    if (normalizedSlug) {
      slugCounts.set(normalizedSlug, (slugCounts.get(normalizedSlug) || 0) + 1);
    }
    if (normalizedName) {
      nameCounts.set(normalizedName, (nameCounts.get(normalizedName) || 0) + 1);
    }
    if (normalizedPhone) {
      const values = phoneToEmails.get(normalizedPhone) || new Set<string>();
      values.add(normalizedEmail || `invalid-row-${index + 1}`);
      phoneToEmails.set(normalizedPhone, values);
    }
    const sourceRowKey = shortId(
      "crs",
      `dot-card-source-row:v1|${sourceReceiptSha256}|${index + 1}|${rawFingerprint}`
    );
    const emailKey = normalizedEmail
      ? rosserGalleryCardEmailKey(workspaceDiscriminator, normalizedEmail)
      : null;
    return {
      sourceRowKey,
      provisionalPersonId: normalizedEmail
        ? shortId("crp", `person:v1|${workspaceDiscriminator}|${normalizedEmail}`)
        : null,
      provisionalEmailContactPointId: normalizedEmail
        ? shortId("crc", `email:v1|${workspaceDiscriminator}|${normalizedEmail}`)
        : null,
      emailKey,
      normalizedEmail,
      normalizedPhone,
      hasName:
        nonEmpty(row["Full Name"]) ||
        (nonEmpty(row["First Name"]) && nonEmpty(row["Last Name"])),
      hasEmail: nonEmpty(row.Email),
      hasPhone: nonEmpty(row["Phone Number"]),
      hasDate: nonEmpty(row["Date Met"]),
      dateParseable: parseableSourceDate(row["Date Met"]),
      rawFingerprint,
      disposition: "reconciliation_not_supplied",
    };
  });

  for (const prepared of preparedRows) {
    if (!prepared.normalizedEmail) {
      prepared.disposition = "invalid_email";
    } else if ((rawFingerprintCounts.get(prepared.rawFingerprint) || 0) > 1) {
      prepared.disposition = "duplicate_source_row";
    } else if ((emailCounts.get(prepared.normalizedEmail) || 0) > 1) {
      prepared.disposition = "duplicate_email_in_source";
    } else if (
      prepared.normalizedPhone &&
      (phoneToEmails.get(prepared.normalizedPhone)?.size || 0) > 1
    ) {
      prepared.disposition = "identity_conflict_in_source";
    } else {
      prepared.disposition = dispositionFromEvidence(
        prepared,
        prepared.emailKey
          ? input.reconciliation?.byEmailKey[prepared.emailKey]
          : undefined
      );
    }
  }

  const dispositionCounts = emptyDispositionCounts();
  for (const prepared of preparedRows) dispositionCounts[prepared.disposition] += 1;
  const reviewableForImportRows =
    dispositionCounts.reviewable_existing_contact + dispositionCounts.reviewable_new_contact;
  const duplicateNormalizedEmailRows = [...emailCounts.values()].reduce(
    (total, count) => total + (count > 1 ? count : 0),
    0
  );
  const duplicateSlugRows = [...slugCounts.values()].reduce(
    (total, count) => total + (count > 1 ? count : 0),
    0
  );
  const duplicateNormalizedNameRows = [...nameCounts.values()].reduce(
    (total, count) => total + (count > 1 ? count : 0),
    0
  );
  const duplicateNormalizedPhoneRows = [...phoneToEmails.values()].reduce(
    (total, emails) => total + (emails.size > 1 ? emails.size : 0),
    0
  );
  const exactDuplicateRows = [...rawFingerprintCounts.values()].reduce(
    (total, count) => total + (count > 1 ? count : 0),
    0
  );

  const planFingerprint = sha256(
    canonicalize({
      contract: ROSSER_GALLERY_CARD_IMPORT_SCHEMA_VERSION,
      sourceReceiptSha256,
      workspaceDiscriminator,
      provenanceEvidenceId: ROSSER_GALLERY_CARD_ATTESTATION.evidenceId,
      rows: preparedRows.map((prepared) => ({
        sourceRowKey: prepared.sourceRowKey,
        provisionalPersonId: prepared.provisionalPersonId,
        provisionalEmailContactPointId: prepared.provisionalEmailContactPointId,
        emailKey: prepared.emailKey,
        disposition: prepared.disposition,
      })),
    })
  );

  return {
    schemaVersion: ROSSER_GALLERY_CARD_IMPORT_SCHEMA_VERSION,
    mode: "dry_run_review_only",
    dataClassification: "aggregate_only",
    source: {
      sourceSystem: "dot_card_csv",
      registrySummaryBucket: "other",
      fileName,
      receipt: {
        algorithm: "sha256",
        sha256: sourceReceiptSha256,
        bytes: sourceBytes.byteLength,
        rows: rows.length,
        columns: DOT_CARD_EXPORT_HEADERS.length,
        headerFingerprint,
      },
    },
    provenance: ROSSER_GALLERY_CARD_ATTESTATION,
    quality: {
      rows: rows.length,
      exactDuplicateRows,
      completeNameRows: preparedRows.filter((row) => row.hasName).length,
      emailPresentRows: preparedRows.filter((row) => row.hasEmail).length,
      validEmailRows: preparedRows.filter((row) => row.normalizedEmail).length,
      invalidEmailRows: preparedRows.filter((row) => !row.normalizedEmail).length,
      duplicateNormalizedEmailRows,
      duplicateSlugRows,
      duplicateNormalizedNameRows,
      phonePresentRows: preparedRows.filter((row) => row.hasPhone).length,
      normalizedPhoneIdentityRows: preparedRows.filter((row) => row.normalizedPhone).length,
      duplicateNormalizedPhoneRows,
      datePresentRows: preparedRows.filter((row) => row.hasDate).length,
      parseableDateRows: preparedRows.filter((row) => row.dateParseable).length,
      sourceCategoryCount: new Set(
        rows.map((row) => row.Source.normalize("NFKC").trim().toLowerCase()).filter(Boolean)
      ).size,
      populatedByColumn,
    },
    reconciliation: {
      evidenceSupplied: Boolean(input.reconciliation),
      evidenceReceiptMatched: Boolean(input.reconciliation),
      dispositionCounts,
      heldRows: rows.length - reviewableForImportRows,
      reviewableForImportRows,
      readyForLiveWriteRows: 0,
      readyForOutreachRows: 0,
    },
    proposedRegistryShape: {
      relationshipBrandId: "rosser_gallery",
      sourceSystem: "dot_card_csv",
      registrySummaryBucket: "other",
      emailDefaultPermissionState: "reconfirm_required",
      phonePurpose: "identity_reconciliation_only",
      deterministicIds: "workspace_scoped_sha256_v1",
      exactSourceReceiptRequired: true,
      permissionEventRequiredBeforeWrite: true,
    },
    authority: {
      liveWrites: false,
      sends: false,
      drafts: false,
      sms: false,
      calls: false,
      scraping: false,
      socialLookup: false,
      applySupported: false,
    },
    planFingerprint,
  };
}
