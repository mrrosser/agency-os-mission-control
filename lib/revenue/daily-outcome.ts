import "server-only";

import { createHash } from "crypto";
import { FieldValue } from "firebase-admin/firestore";
import { ApiError } from "@/lib/api/handler";
import { getAdminDb } from "@/lib/firebase-admin";
import type { Logger } from "@/lib/logging";
import type { BusinessUnitId } from "@/lib/revenue/offers";

export const DAILY_OUTCOME_TIME_ZONE = "America/Chicago";
export const DAILY_OUTCOME_EVALUATOR_VERSION = "daily-outcome-v1";
export const DAILY_OUTCOME_FIT_THRESHOLD = 80;
export const DAILY_OUTCOME_FINAL_CUTOFF_MINUTES = 20 * 60;
const SOURCE_OBSERVATION_MAX_AGE_MS = 36 * 60 * 60 * 1_000;

export type DailyOutcomeBusinessUnit = Extract<
  BusinessUnitId,
  "rosser_nft_gallery" | "rt_solutions"
>;
export type DailyOutcomeStatus = "met" | "at_risk" | "missed" | "not_observed";
export type DailyOutcomeEvidenceKind = "meeting_booked" | "application_ready";

export interface DailyOutcomeOrganization {
  businessUnit: DailyOutcomeBusinessUnit;
  organizationName: "Rosser Gallery" | "RT Solutions";
  workspaceId: string;
  businessIdentityId: "rosser_artist_gallery" | "rt_business_ai";
}

/**
 * Canonical organization/workspace bindings. A workspace is never inferred from
 * a title, email address, CRM stage, or caller-provided query parameter.
 */
export const DAILY_OUTCOME_ORGANIZATIONS: readonly DailyOutcomeOrganization[] = [
  {
    businessUnit: "rosser_nft_gallery",
    organizationName: "Rosser Gallery",
    workspaceId: "ws_cd43331c4b1648d0",
    businessIdentityId: "rosser_artist_gallery",
  },
  {
    businessUnit: "rt_solutions",
    organizationName: "RT Solutions",
    workspaceId: "ws_ee1735c095774325",
    businessIdentityId: "rt_business_ai",
  },
] as const;

export interface DailyOutcomeEvidence {
  receiptId: string;
  kind: DailyOutcomeEvidenceKind;
  entityId: string;
  title: string;
  occurredAt: string;
  sourceObservedAt: string;
  sourceUrl: string | null;
  deadline: string | null;
  score: number | null;
  qualificationReasons: string[];
  nextAction: string;
  approvalRequired: boolean;
}

export interface DailyOutcomeSourceHealth {
  status: "observed" | "stale" | "unavailable";
  lastObservedAt: string | null;
  reasonCodes: string[];
}

export interface DailyOutcomeResult {
  schemaVersion: "1";
  outcomeId: string;
  idempotencyKey: string;
  businessUnit: DailyOutcomeBusinessUnit;
  organizationName: string;
  workspaceId: string;
  businessIdentityId: string;
  localDate: string;
  timeZone: string;
  asOf: string;
  evaluatorVersion: string;
  status: DailyOutcomeStatus;
  winningKind: DailyOutcomeEvidenceKind | null;
  evidence: DailyOutcomeEvidence[];
  counts: {
    verifiedMeetings: number;
    applicationReady: number;
    rejectedCandidates: number;
    observedRecords: number;
  };
  sourceHealth: DailyOutcomeSourceHealth;
  alert: {
    active: boolean;
    severity: "none" | "warning" | "urgent";
    reason: string | null;
  };
  rejectionReasonCodes: string[];
}

export interface PublicDailyOutcome {
  outcomeId: string;
  businessUnit: DailyOutcomeBusinessUnit;
  organizationName: string;
  localDate: string;
  timeZone: string;
  asOf: string;
  status: DailyOutcomeStatus;
  winningKind: DailyOutcomeEvidenceKind | null;
  evidence: Array<Omit<DailyOutcomeEvidence, "entityId">>;
  counts: DailyOutcomeResult["counts"];
  sourceHealth: DailyOutcomeSourceHealth;
  alert: DailyOutcomeResult["alert"];
  rejectionReasonCodes: string[];
}

interface SourceDocument {
  __docId?: string;
  [key: string]: unknown;
}

export interface DailyOutcomeEvaluationInput {
  organization: DailyOutcomeOrganization;
  asOf: Date;
  timeZone?: string;
  canonicalRecords?: SourceDocument[];
  executionReceipts?: SourceDocument[];
  artistOpportunities?: SourceDocument[];
  unavailableSourceCodes?: string[];
}

interface QualificationResult {
  evidence: DailyOutcomeEvidence | null;
  reasonCodes: string[];
  observedAt: string | null;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function toIso(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.valueOf()) ? null : value.toISOString();
  }
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.valueOf()) ? null : parsed.toISOString();
  }
  const timestamp = value as { toDate?: () => Date };
  if (typeof timestamp.toDate !== "function") return null;
  try {
    const parsed = timestamp.toDate();
    return Number.isNaN(parsed.valueOf()) ? null : parsed.toISOString();
  } catch {
    return null;
  }
}

function zonedParts(value: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value);
  return Object.fromEntries(
    parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value])
  );
}

export function localDateKey(value: Date, timeZone: string = DAILY_OUTCOME_TIME_ZONE): string {
  const parts = zonedParts(value, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function localMinutes(value: Date, timeZone: string): number {
  const parts = zonedParts(value, timeZone);
  return Number(parts.hour) * 60 + Number(parts.minute);
}

export function buildDailyOutcomeId(args: {
  workspaceId: string;
  businessUnit: DailyOutcomeBusinessUnit;
  localDate: string;
  timeZone?: string;
}): string {
  const timeZone = args.timeZone || DAILY_OUTCOME_TIME_ZONE;
  const digest = sha256(
    `${args.workspaceId}|${args.businessUnit}|${timeZone}|${args.localDate}`
  );
  return `daily-outcome-${args.localDate}-${digest.slice(0, 24)}`;
}

function safePublicUrl(value: unknown): string | null {
  const raw = asString(value);
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return null;
    const host = parsed.hostname.toLowerCase();
    if (
      host === "localhost" ||
      host.endsWith(".local") ||
      host === "0.0.0.0" ||
      host === "127.0.0.1" ||
      /^10\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host)
    ) {
      return null;
    }
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return null;
  }
}

function recordEntityId(value: SourceDocument): string | null {
  return (
    asString(value.id) ||
    asString(value.recordId) ||
    asString(value.opportunityId) ||
    asString(value.__docId)
  );
}

function recordWorkspaceMatches(
  value: SourceDocument,
  organization: DailyOutcomeOrganization
): boolean {
  if (asString(value.workspaceId) !== organization.workspaceId) return false;
  const identityId = asString(value.businessIdentityId);
  return !identityId || identityId === organization.businessIdentityId;
}

function currentSourceReceipt(
  value: SourceDocument,
  asOf: Date,
  options?: { requireOfficial?: boolean }
): {
  receiptId: string;
  observedAt: string;
} | null {
  const direct = asRecord(value.sourceReceipt);
  const sources = [direct, ...asArray(value.sources).map(asRecord)].filter(
    (source) => Object.keys(source).length > 0
  );
  for (const source of sources) {
    const receiptId = asString(source.receiptId);
    const observedAt = toIso(source.observedAt);
    const contentHash = asString(source.contentHash);
    const freshness = asRecord(source.freshness);
    const status = asString(freshness.status)?.toLowerCase();
    const validUntil = toIso(freshness.validUntil);
    if (
      receiptId &&
      observedAt &&
      hasCurrentObservation(observedAt, asOf) &&
      (!options?.requireOfficial || source.official === true) &&
      /^sha256:[a-f0-9]{64}$/.test(contentHash || "") &&
      status === "fresh" &&
      (!validUntil || Date.parse(validUntil) >= asOf.valueOf())
    ) {
      return { receiptId, observedAt };
    }
  }

  const receiptId = asString(value.sourceReceiptId);
  const observedAt = toIso(value.sourceObservedAt);
  const contentHash = asString(value.sourceContentHash);
  if (
    receiptId &&
    observedAt &&
    hasCurrentObservation(observedAt, asOf) &&
    (!options?.requireOfficial || value.sourceOfficial === true) &&
    /^sha256:[a-f0-9]{64}$/.test(contentHash || "")
  ) {
    return { receiptId, observedAt };
  }
  return null;
}

function latestObservedAt(value: SourceDocument): string | null {
  const candidates = [
    toIso(value.sourceObservedAt),
    toIso(value.providerCreatedAt),
    toIso(value.acceptedAt),
    toIso(value.updatedAt),
    toIso(value.createdAt),
    ...asArray(value.sources).map((source) => toIso(asRecord(source).observedAt)),
  ].filter((item): item is string => Boolean(item));
  return candidates.sort().at(-1) || null;
}

function hasCurrentObservation(observedAt: string | null, asOf: Date): boolean {
  if (!observedAt) return false;
  const observedMs = Date.parse(observedAt);
  return (
    Number.isFinite(observedMs) &&
    observedMs <= asOf.valueOf() + 5 * 60 * 1_000 &&
    observedMs >= asOf.valueOf() - SOURCE_OBSERVATION_MAX_AGE_MS
  );
}

function deadlineState(value: SourceDocument, asOf: Date, timeZone: string) {
  const rawDeadline = asString(value.deadline);
  const status = (
    asString(value.deadlineStatus) ||
    asString(value.applicationWindowStatus) ||
    asString(value.windowStatus) ||
    asString(value.applicationStatus) ||
    ""
  ).toLowerCase();
  const explicitlyOpen =
    value.rolling === true ||
    ["rolling", "open", "ongoing"].includes(status) ||
    ["rolling", "open", "ongoing"].includes((rawDeadline || "").toLowerCase());
  if (explicitlyOpen) {
    return { open: true, label: rawDeadline || "Rolling / open", reasonCode: null };
  }
  if (!rawDeadline) {
    return { open: false, label: null, reasonCode: "deadline_unknown" };
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(rawDeadline)) {
    const open = rawDeadline >= localDateKey(asOf, timeZone);
    return { open, label: rawDeadline, reasonCode: open ? null : "deadline_expired" };
  }
  const parsed = Date.parse(rawDeadline);
  if (!Number.isFinite(parsed)) {
    return { open: false, label: rawDeadline, reasonCode: "deadline_invalid" };
  }
  const open = parsed > asOf.valueOf();
  return { open, label: new Date(parsed).toISOString(), reasonCode: open ? null : "deadline_expired" };
}

function hasPaidRtSignal(value: SourceDocument): boolean {
  const tags = asArray(value.tags)
    .map((tag) => asString(tag)?.toLowerCase())
    .filter((tag): tag is string => Boolean(tag));
  if (tags.includes("paid_signal")) return true;

  const compensation = asRecord(value.compensation);
  const numericCompensation = [
    value.compensationUsd,
    value.honorariumUsd,
    value.budgetUsd,
    compensation.amount,
    compensation.amountUsd,
    compensation.maxUsd,
  ]
    .map(asNumber)
    .filter((amount): amount is number => amount !== null);
  if (numericCompensation.some((amount) => amount > 0)) return true;

  const compensationText = [
    asString(value.compensationText),
    asString(value.compensation),
    asString(value.summary),
  ]
    .filter((part): part is string => Boolean(part))
    .join(" ")
    .toLowerCase();
  if (!compensationText || /\b(unpaid|volunteer|no compensation|no honorarium)\b/.test(compensationText)) {
    return false;
  }
  return /(?:\$\s?\d|\b(?:paid engagement|paid workshop|paid speaking|honorarium|stipend|compensation|contract budget)\b)/.test(
    compensationText
  );
}

function applicationReadiness(
  value: SourceDocument,
  organization: DailyOutcomeOrganization,
  asOf: Date,
  timeZone: string
): QualificationResult {
  const reasonCodes: string[] = [];
  const observedAt = latestObservedAt(value);
  if (!recordWorkspaceMatches(value, organization)) reasonCodes.push("workspace_mismatch");
  if (value.recordType !== undefined && asString(value.recordType) !== "opportunity") {
    reasonCodes.push("not_opportunity");
  }
  const entityId = recordEntityId(value);
  if (!entityId) reasonCodes.push("missing_entity_id");

  const sourceUrl = safePublicUrl(value.officialUrl ?? value.url);
  if (!sourceUrl) reasonCodes.push("missing_public_url");

  const fitScore = asNumber(asRecord(value.qualification).score ?? value.fitScore);
  if (fitScore === null || fitScore < DAILY_OUTCOME_FIT_THRESHOLD) {
    reasonCodes.push("fit_below_threshold");
  }

  const missingRequirementKeys = asArray(value.missingRequirementKeys).filter(Boolean);
  if (missingRequirementKeys.length > 0) reasonCodes.push("missing_requirements");
  const exclusions = asArray(value.exclusions).filter(Boolean);
  if (exclusions.length > 0) reasonCodes.push("has_exclusions");
  if (organization.businessUnit === "rt_solutions" && !hasPaidRtSignal(value)) {
    reasonCodes.push("paid_signal_missing");
  }

  const requirements = asArray(value.requirements).map(asRecord);
  const hasExplicitRequirementState = requirements.some((requirement) =>
    Object.prototype.hasOwnProperty.call(requirement, "satisfied")
  );
  const qualification = asRecord(value.qualification);
  const explicitlyUnverified =
    value.requirementsVerified === false || qualification.requirementsVerified === false;
  const requirementsVerified =
    !explicitlyUnverified &&
    (value.requirementsVerified === true ||
      qualification.requirementsVerified === true ||
      (hasExplicitRequirementState &&
        requirements
          .filter((requirement) => requirement.required !== false)
          .every((requirement) => requirement.satisfied === true)));
  if (!requirementsVerified) reasonCodes.push("requirements_unverified");

  const workflowStatus = asString(value.workflowStatus)?.toLowerCase();
  const highSignalState = asString(value.highSignalState)?.toLowerCase();
  const explicitlyReady =
    value.applicationReady === true ||
    workflowStatus === "ready" ||
    highSignalState === "needs_you";
  if (!explicitlyReady) reasonCodes.push("workflow_not_ready");

  const deadline = deadlineState(value, asOf, timeZone);
  if (!deadline.open && deadline.reasonCode) reasonCodes.push(deadline.reasonCode);

  const sourceReceipt = currentSourceReceipt(value, asOf, { requireOfficial: true });
  if (!sourceReceipt) reasonCodes.push("source_receipt_missing_or_stale");

  if (reasonCodes.length > 0 || !entityId || !sourceUrl || fitScore === null || !sourceReceipt) {
    return { evidence: null, reasonCodes: [...new Set(reasonCodes)], observedAt };
  }

  const receiptId = `daily-evidence-${sha256(
    `${organization.workspaceId}|application_ready|${entityId}|${sourceReceipt.receiptId}|${deadline.label}`
  ).slice(0, 32)}`;
  return {
    evidence: {
      receiptId,
      kind: "application_ready",
      entityId,
      title: asString(value.title) || "Qualified opportunity",
      occurredAt: asOf.toISOString(),
      sourceObservedAt: sourceReceipt.observedAt,
      sourceUrl,
      deadline: deadline.label,
      score: fitScore,
      qualificationReasons: [
        `fit_score_at_least_${DAILY_OUTCOME_FIT_THRESHOLD}`,
        "requirements_verified",
        "no_exclusions",
        "deadline_open",
        "source_receipt_current",
      ],
      nextAction: "Review the prepared application packet and approve any external submission.",
      approvalRequired: true,
    },
    reasonCodes: [],
    observedAt,
  };
}

function externalAttendeeCount(value: SourceDocument): number {
  const explicit = asNumber(
    value.externalAttendeeCount ?? asRecord(value.bookingReceipt).externalAttendeeCount
  );
  if (explicit !== null) return Math.max(0, Math.floor(explicit));
  return asArray(value.attendees).filter((attendeeValue) => {
    const attendee = asRecord(attendeeValue);
    return attendee.self !== true && ["accepted", "confirmed"].includes(
      (asString(attendee.responseStatus) || asString(attendee.status) || "").toLowerCase()
    );
  }).length;
}

function meetingReadiness(
  value: SourceDocument,
  organization: DailyOutcomeOrganization,
  asOf: Date,
  timeZone: string,
  executionReceipt?: SourceDocument
): QualificationResult {
  const reasonCodes: string[] = [];
  const observedAt = latestObservedAt(executionReceipt || value) || latestObservedAt(value);
  if (!recordWorkspaceMatches(value, organization)) reasonCodes.push("workspace_mismatch");
  if (asString(value.recordType) !== "event") reasonCodes.push("not_event");
  if ((asString(value.eventKind) || "").toLowerCase() !== "meeting") {
    reasonCodes.push("not_meeting");
  }

  const entityId = recordEntityId(value);
  if (!entityId) reasonCodes.push("missing_entity_id");
  const bookingReceipt = asRecord(value.bookingReceipt);
  const providerEventId =
    asString(bookingReceipt.externalId) ||
    asString(value.providerEventId) ||
    asString(executionReceipt?.externalId);
  if (!providerEventId) reasonCodes.push("provider_event_missing");

  const providerStatus = (
    asString(bookingReceipt.providerStatus) ||
    asString(value.providerStatus) ||
    asString(value.bookingStatus) ||
    ""
  ).toLowerCase();
  if (!["accepted", "confirmed"].includes(providerStatus)) {
    reasonCodes.push("booking_not_confirmed");
  }

  const startsAt = toIso(value.startsAt ?? bookingReceipt.startsAt);
  if (!startsAt || Date.parse(startsAt) <= asOf.valueOf()) {
    reasonCodes.push("meeting_not_future");
  }
  if (externalAttendeeCount(value) < 1) reasonCodes.push("external_attendee_missing");

  const bookedAt =
    toIso(bookingReceipt.acceptedAt) ||
    toIso(value.acceptedAt) ||
    toIso(value.providerCreatedAt) ||
    toIso(executionReceipt?.completedAt);
  if (!bookedAt || localDateKey(new Date(bookedAt), timeZone) !== localDateKey(asOf, timeZone)) {
    reasonCodes.push("not_booked_today");
  }

  const sourceReceipt = currentSourceReceipt(value, asOf);
  if (!sourceReceipt) reasonCodes.push("source_receipt_missing_or_stale");
  if (executionReceipt) {
    if (
      asString(executionReceipt.action) !== "create_calendar_event" ||
      asString(executionReceipt.status) !== "succeeded" ||
      !asString(executionReceipt.externalId)
    ) {
      reasonCodes.push("execution_receipt_not_succeeded");
    }
  }

  if (reasonCodes.length > 0 || !entityId || !bookedAt || !sourceReceipt) {
    return { evidence: null, reasonCodes: [...new Set(reasonCodes)], observedAt };
  }
  const receiptId = `daily-evidence-${sha256(
    `${organization.workspaceId}|meeting_booked|${entityId}|${sourceReceipt.receiptId}|${providerEventId}`
  ).slice(0, 32)}`;
  return {
    evidence: {
      receiptId,
      kind: "meeting_booked",
      entityId,
      title: "Confirmed meeting",
      occurredAt: bookedAt,
      sourceObservedAt: sourceReceipt.observedAt,
      sourceUrl: null,
      deadline: startsAt,
      score: null,
      qualificationReasons: [
        "provider_event_confirmed",
        "external_attendee_accepted",
        "future_event",
        "booked_today",
      ],
      nextAction: "Prepare for the confirmed meeting.",
      approvalRequired: false,
    },
    reasonCodes: [],
    observedAt,
  };
}

function newestIso(values: Array<string | null>): string | null {
  return values.filter((value): value is string => Boolean(value)).sort().at(-1) || null;
}

export function evaluateDailyOutcome(input: DailyOutcomeEvaluationInput): DailyOutcomeResult {
  const timeZone = input.timeZone || DAILY_OUTCOME_TIME_ZONE;
  const asOf = input.asOf;
  const localDate = localDateKey(asOf, timeZone);
  const organization = input.organization;
  const canonicalRecords = input.canonicalRecords || [];
  const executionReceipts = input.executionReceipts || [];
  const artistOpportunities = input.artistOpportunities || [];
  const receiptsByRecordId = new Map<string, SourceDocument>();
  for (const receipt of executionReceipts) {
    if (asString(receipt.workspaceId) !== organization.workspaceId) continue;
    const recordId = asString(receipt.recordId);
    if (!recordId) continue;
    const prior = receiptsByRecordId.get(recordId);
    const priorDate = toIso(prior?.completedAt) || toIso(prior?.startedAt) || "";
    const nextDate = toIso(receipt.completedAt) || toIso(receipt.startedAt) || "";
    if (!prior || nextDate > priorDate) receiptsByRecordId.set(recordId, receipt);
  }

  const meetingResults = canonicalRecords
    .filter((record) => asString(record.recordType) === "event")
    .map((record) =>
      meetingReadiness(
        record,
        organization,
        asOf,
        timeZone,
        receiptsByRecordId.get(recordEntityId(record) || "")
      )
    );
  const opportunityResults = [...canonicalRecords, ...artistOpportunities]
    .filter((record) => record.recordType === undefined || asString(record.recordType) === "opportunity")
    .map((record) => applicationReadiness(record, organization, asOf, timeZone));
  const allResults = [...meetingResults, ...opportunityResults];
  const evidence = allResults
    .map((result) => result.evidence)
    .filter((item): item is DailyOutcomeEvidence => Boolean(item))
    .sort((left, right) => left.receiptId.localeCompare(right.receiptId));
  const verifiedMeetings = evidence.filter((item) => item.kind === "meeting_booked").length;
  const applicationReady = evidence.filter((item) => item.kind === "application_ready").length;
  const observedAt = newestIso([
    ...allResults.map((result) => result.observedAt),
    ...executionReceipts.map(latestObservedAt),
  ]);
  const hasObservation = hasCurrentObservation(observedAt, asOf);
  const unavailableSourceCodes = [...new Set(input.unavailableSourceCodes || [])];
  const afterFinalCutoff = localMinutes(asOf, timeZone) >= DAILY_OUTCOME_FINAL_CUTOFF_MINUTES;
  const status: DailyOutcomeStatus =
    evidence.length > 0
      ? "met"
      : !hasObservation
        ? "not_observed"
        : afterFinalCutoff
          ? "missed"
          : "at_risk";
  const rejectionReasonCodes = [...new Set(allResults.flatMap((result) => result.reasonCodes))]
    .filter((reason) => reason !== "not_event" && reason !== "not_opportunity")
    .sort();
  const sourceHealth: DailyOutcomeSourceHealth = {
    status:
      unavailableSourceCodes.length > 0 && !hasObservation
        ? "unavailable"
        : hasObservation
          ? "observed"
          : "stale",
    lastObservedAt: observedAt,
    reasonCodes: unavailableSourceCodes.length > 0
      ? unavailableSourceCodes
      : hasObservation
        ? []
        : ["no_current_source_observation"],
  };
  const alert =
    status === "missed"
      ? { active: true, severity: "urgent" as const, reason: "Daily outcome cutoff passed without qualifying evidence." }
      : status === "not_observed"
        ? { active: true, severity: "urgent" as const, reason: "Current source evidence is unavailable or stale." }
        : status === "at_risk"
          ? { active: true, severity: "warning" as const, reason: "No qualifying outcome receipt yet today." }
          : { active: false, severity: "none" as const, reason: null };
  const outcomeId = buildDailyOutcomeId({
    workspaceId: organization.workspaceId,
    businessUnit: organization.businessUnit,
    localDate,
    timeZone,
  });
  return {
    schemaVersion: "1",
    outcomeId,
    idempotencyKey: `sha256:${sha256(
      `${organization.workspaceId}|${organization.businessUnit}|${timeZone}|${localDate}`
    )}`,
    businessUnit: organization.businessUnit,
    organizationName: organization.organizationName,
    workspaceId: organization.workspaceId,
    businessIdentityId: organization.businessIdentityId,
    localDate,
    timeZone,
    asOf: asOf.toISOString(),
    evaluatorVersion: DAILY_OUTCOME_EVALUATOR_VERSION,
    status,
    winningKind: verifiedMeetings > 0 ? "meeting_booked" : applicationReady > 0 ? "application_ready" : null,
    evidence,
    counts: {
      verifiedMeetings,
      applicationReady,
      rejectedCandidates: allResults.filter((result) => !result.evidence).length,
      observedRecords: allResults.filter((result) => Boolean(result.observedAt)).length,
    },
    sourceHealth,
    alert,
    rejectionReasonCodes,
  };
}

export function toPublicDailyOutcome(outcome: DailyOutcomeResult): PublicDailyOutcome {
  return {
    outcomeId: outcome.outcomeId,
    businessUnit: outcome.businessUnit,
    organizationName: outcome.organizationName,
    localDate: outcome.localDate,
    timeZone: outcome.timeZone,
    asOf: outcome.asOf,
    status: outcome.status,
    winningKind: outcome.winningKind,
    evidence: outcome.evidence.map(({ entityId: _entityId, ...item }) => item),
    counts: outcome.counts,
    sourceHealth: outcome.sourceHealth,
    alert: outcome.alert,
    rejectionReasonCodes: outcome.rejectionReasonCodes,
  };
}

async function authorizedOrganizations(uid: string): Promise<DailyOutcomeOrganization[]> {
  const ownerUid = asString(process.env.REVENUE_AUTOMATION_OWNER_UID);
  if (ownerUid && ownerUid === uid) return [...DAILY_OUTCOME_ORGANIZATIONS];

  const db = getAdminDb();
  const memberships = await Promise.all(
    DAILY_OUTCOME_ORGANIZATIONS.map(async (organization) => {
      const snapshot = await db
        .collection("workspace_members")
        .doc(`${organization.workspaceId}__${uid}`)
        .get();
      const data = snapshot.exists ? asRecord(snapshot.data()) : {};
      const status = asString(data.status)?.toLowerCase();
      return status === "active" || status === "invited" ? organization : null;
    })
  );
  return memberships.filter((item): item is DailyOutcomeOrganization => Boolean(item));
}

async function readWorkspaceCollection(args: {
  collectionName: string;
  workspaceId: string;
  log: Logger;
}): Promise<{ documents: SourceDocument[]; unavailableCode: string | null }> {
  try {
    const snapshot = await getAdminDb()
      .collection(args.collectionName)
      .where("workspaceId", "==", args.workspaceId)
      .limit(500)
      .get();
    return {
      documents: snapshot.docs.map((document) => ({
        ...asRecord(document.data()),
        __docId: document.id,
      })),
      unavailableCode: null,
    };
  } catch (error) {
    args.log.warn("revenue.daily_outcome.source_unavailable", {
      workspaceIdHash: sha256(args.workspaceId).slice(0, 12),
      collection: args.collectionName,
      errorType: error instanceof Error ? error.name : "unknown",
    });
    return {
      documents: [],
      unavailableCode: `${args.collectionName}_unavailable`,
    };
  }
}

async function persistDailyOutcome(outcome: DailyOutcomeResult): Promise<void> {
  const db = getAdminDb();
  const ref = db.collection("mission_control_daily_outcomes").doc(outcome.outcomeId);
  await db.runTransaction(async (transaction) => {
    const existing = await transaction.get(ref);
    transaction.set(
      ref,
      {
        ...outcome,
        createdAt: existing.exists
          ? existing.data()?.createdAt || FieldValue.serverTimestamp()
          : FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  });
}

export async function getDailyOutcomeDashboard(args: {
  uid: string;
  asOf?: Date;
  timeZone?: string;
  correlationId: string;
  log: Logger;
}): Promise<{ asOf: string; timeZone: string; outcomes: PublicDailyOutcome[] }> {
  const asOf = args.asOf || new Date();
  if (Number.isNaN(asOf.valueOf())) throw new ApiError(400, "Invalid as-of timestamp");
  const timeZone = args.timeZone || DAILY_OUTCOME_TIME_ZONE;
  const organizations = await authorizedOrganizations(args.uid);
  if (organizations.length === 0) {
    throw new ApiError(403, "No authorized daily-outcome organization mapping");
  }

  const outcomes = await Promise.all(
    organizations.map(async (organization) => {
      const [canonical, receipts, artist] = await Promise.all([
        readWorkspaceCollection({
          collectionName: "mission_control_records",
          workspaceId: organization.workspaceId,
          log: args.log,
        }),
        readWorkspaceCollection({
          collectionName: "mission_control_execution_receipts",
          workspaceId: organization.workspaceId,
          log: args.log,
        }),
        readWorkspaceCollection({
          collectionName: "artist_manager_opportunities",
          workspaceId: organization.workspaceId,
          log: args.log,
        }),
      ]);
      const outcome = evaluateDailyOutcome({
        organization,
        asOf,
        timeZone,
        canonicalRecords: canonical.documents,
        executionReceipts: receipts.documents,
        artistOpportunities: artist.documents,
        unavailableSourceCodes: [
          canonical.unavailableCode,
          receipts.unavailableCode,
          artist.unavailableCode,
        ].filter((item): item is string => Boolean(item)),
      });
      await persistDailyOutcome(outcome);
      args.log.info("revenue.daily_outcome.evaluated", {
        correlationId: args.correlationId,
        businessUnit: organization.businessUnit,
        workspaceIdHash: sha256(organization.workspaceId).slice(0, 12),
        localDate: outcome.localDate,
        timeZone: outcome.timeZone,
        status: outcome.status,
        verifiedMeetings: outcome.counts.verifiedMeetings,
        applicationReady: outcome.counts.applicationReady,
        rejectedCandidates: outcome.counts.rejectedCandidates,
        sourceStatus: outcome.sourceHealth.status,
      });
      return toPublicDailyOutcome(outcome);
    })
  );

  return {
    asOf: asOf.toISOString(),
    timeZone,
    outcomes,
  };
}
