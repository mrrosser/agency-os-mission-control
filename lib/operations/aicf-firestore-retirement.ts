import { createHash } from "node:crypto";

export const AICF_RETIREMENT_OPERATION_ID = "aicf-operational-retirement-v1";
export const AICF_RETIREMENT_REASON =
  "aicf_operational_retirement_transition_to_rt_solutions";

export type FirestoreValue = Record<string, unknown>;

export interface FirestoreRestDocument {
  name: string;
  fields?: Record<string, FirestoreValue>;
  createTime?: string;
  updateTime: string;
}

export interface RetirementAggregate {
  templates: {
    aicfMatching: number;
    targetUnarchivedUnretired: number;
    alreadyArchivedOrRetired: number;
    activeTrueAmongTargets: number;
  };
  socialDrafts: {
    aicfTotal: number;
    targetGenuinelyPending: number;
    finalApprovedDispatched: number;
    rejected: number;
    excludedOther: number;
    retiredByOperation: number;
  };
  aggregateHash: string;
  protectedAggregateHash: string;
}

export interface RetirementTarget {
  kind: "lead_run_template" | "social_draft";
  source: FirestoreRestDocument;
  pathHash: string;
  previousContentHash: string;
  updatedFields: Record<string, FirestoreValue>;
  expectedContentHash: string;
}

export interface RetirementPlan {
  planHash: string;
  preAggregate: RetirementAggregate;
  targets: RetirementTarget[];
  protectedDocuments: Array<{
    name: string;
    pathHash: string;
    updateTime: string;
    contentHash: string;
  }>;
  expectedTargetContentHash: string;
}

interface ClassifiedDocument {
  kind: "lead_run_template" | "social_draft";
  document: FirestoreRestDocument;
  data: Record<string, unknown>;
  pathHash: string;
  contentHash: string;
  target: boolean;
  protectedFinal: boolean;
  templateMatches?: boolean;
  templateArchivedOrRetired?: boolean;
  templateActive?: boolean;
  draftStatus?: string;
  draftDecision?: string;
  draftHasDispatch?: boolean;
  draftRetiredByOperation?: boolean;
}

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => [key, sortDeep((value as Record<string, unknown>)[key])])
  );
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortDeep(value));
}

export function sha256(value: unknown): string {
  const input = typeof value === "string" ? value : canonicalJson(value);
  return `sha256:${createHash("sha256").update(input).digest("hex")}`;
}

export function decodeFirestoreValue(value: FirestoreValue | undefined): unknown {
  if (!value || typeof value !== "object") return undefined;
  if ("stringValue" in value) return value.stringValue;
  if ("booleanValue" in value) return value.booleanValue;
  if ("nullValue" in value) return null;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return value.doubleValue;
  if ("timestampValue" in value) return value.timestampValue;
  if ("referenceValue" in value) return value.referenceValue;
  if ("bytesValue" in value) return value.bytesValue;
  if ("geoPointValue" in value) return value.geoPointValue;
  if ("mapValue" in value) {
    const mapValue = value.mapValue as { fields?: Record<string, FirestoreValue> };
    return Object.fromEntries(
      Object.entries(mapValue.fields || {}).map(([key, child]) => [
        key,
        decodeFirestoreValue(child),
      ])
    );
  }
  if ("arrayValue" in value) {
    const arrayValue = value.arrayValue as { values?: FirestoreValue[] };
    return (arrayValue.values || []).map((child) => decodeFirestoreValue(child));
  }
  return value;
}

export function decodeFirestoreFields(
  fields: Record<string, FirestoreValue> | undefined
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(fields || {}).map(([key, value]) => [key, decodeFirestoreValue(value)])
  );
}

function cloneFields(
  fields: Record<string, FirestoreValue> | undefined
): Record<string, FirestoreValue> {
  return structuredClone(fields || {});
}

function stringValue(value: string): FirestoreValue {
  return { stringValue: value };
}

function booleanValue(value: boolean): FirestoreValue {
  return { booleanValue: value };
}

function timestampValue(value: string): FirestoreValue {
  return { timestampValue: value };
}

function mapValue(fields: Record<string, FirestoreValue>): FirestoreValue {
  return { mapValue: { fields } };
}

function mapFields(value: FirestoreValue | undefined): Record<string, FirestoreValue> {
  if (!value || typeof value !== "object" || !("mapValue" in value)) return {};
  const candidate = value.mapValue as { fields?: Record<string, FirestoreValue> };
  return cloneFields(candidate.fields);
}

function documentContentHash(document: FirestoreRestDocument): string {
  return sha256(document.fields || {});
}

function classifyTemplates(documents: FirestoreRestDocument[]): ClassifiedDocument[] {
  return documents.flatMap((document) => {
    const data = decodeFirestoreFields(document.fields);
    const params = data.params && typeof data.params === "object"
      ? (data.params as Record<string, unknown>)
      : {};
    const outreach = data.outreach && typeof data.outreach === "object"
      ? (data.outreach as Record<string, unknown>)
      : {};
    const templateMatches =
      normalizeString(params.businessUnit) === "ai_cofoundry" ||
      normalizeString(outreach.businessKey) === "aicf";
    if (!templateMatches) return [];
    const archivedOrRetired = data.archived === true || data.retired === true;
    return [
      {
        kind: "lead_run_template" as const,
        document,
        data,
        pathHash: sha256(document.name),
        contentHash: documentContentHash(document),
        target: !archivedOrRetired,
        protectedFinal: archivedOrRetired,
        templateMatches,
        templateArchivedOrRetired: archivedOrRetired,
        templateActive: data.active === true,
      },
    ];
  });
}

function classifyDrafts(documents: FirestoreRestDocument[]): ClassifiedDocument[] {
  const finalStatuses = new Set(["approved", "rejected", "scheduled", "posted"]);
  return documents.flatMap((document) => {
    const data = decodeFirestoreFields(document.fields);
    if (normalizeString(data.businessKey) !== "aicf") return [];
    const approval = data.approval && typeof data.approval === "object"
      ? (data.approval as Record<string, unknown>)
      : {};
    const dispatch = data.dispatch && typeof data.dispatch === "object"
      ? (data.dispatch as Record<string, unknown>)
      : {};
    const status = normalizeString(data.status);
    const decision = normalizeString(approval.decision);
    const hasFinalApproval =
      decision === "approve" || decision === "reject" || finalStatuses.has(status);
    const hasDispatch = Boolean(
      normalizeString(dispatch.status) ||
        normalizeString(dispatch.queueDocId) ||
        normalizeString(dispatch.queuedAt) ||
        normalizeString(dispatch.externalTool) ||
        normalizeString(data.dispatchState) ||
        normalizeString(data.queueDocId) ||
        status === "scheduled" ||
        status === "posted"
    );
    const pendingStatus = status === "draft" || status === "pending_approval" || status === "";
    const target = pendingStatus && !hasFinalApproval && !hasDispatch && data.retired !== true;
    const rejected = status === "rejected" || decision === "reject";
    const approvedDispatched = status === "approved" && hasDispatch;
    const retirement = data.operationalRetirement && typeof data.operationalRetirement === "object"
      ? (data.operationalRetirement as Record<string, unknown>)
      : {};
    return [
      {
        kind: "social_draft" as const,
        document,
        data,
        pathHash: sha256(document.name),
        contentHash: documentContentHash(document),
        target,
        protectedFinal: !target && (rejected || approvedDispatched),
        draftStatus: status,
        draftDecision: decision,
        draftHasDispatch: hasDispatch,
        draftRetiredByOperation:
          normalizeString(retirement.operationKey) === AICF_RETIREMENT_OPERATION_ID,
      },
    ];
  });
}

function aggregateFromClassified(rows: ClassifiedDocument[]): RetirementAggregate {
  const templates = rows.filter((row) => row.kind === "lead_run_template");
  const drafts = rows.filter((row) => row.kind === "social_draft");
  const aggregateRows = rows
    .map((row) => ({
      kind: row.kind,
      pathHash: row.pathHash,
      updateTime: row.document.updateTime,
      dataHash: row.contentHash,
      target: row.target,
      protectedFinal: row.protectedFinal,
      templateArchivedOrRetired: row.templateArchivedOrRetired ?? null,
      templateActive: row.templateActive ?? null,
      draftStatus: row.draftStatus ?? null,
      draftDecision: row.draftDecision || null,
      draftHasDispatch: row.draftHasDispatch ?? null,
      draftRetiredByOperation: row.draftRetiredByOperation ?? null,
    }))
    .sort((left, right) => left.pathHash.localeCompare(right.pathHash));
  const protectedRows = rows
    .filter((row) => row.protectedFinal)
    .map((row) => ({
      kind: row.kind,
      pathHash: row.pathHash,
      updateTime: row.document.updateTime,
      dataHash: row.contentHash,
    }))
    .sort((left, right) => left.pathHash.localeCompare(right.pathHash));

  return {
    templates: {
      aicfMatching: templates.length,
      targetUnarchivedUnretired: templates.filter((row) => row.target).length,
      alreadyArchivedOrRetired: templates.filter((row) => !row.target).length,
      activeTrueAmongTargets: templates.filter((row) => row.target && row.templateActive).length,
    },
    socialDrafts: {
      aicfTotal: drafts.length,
      targetGenuinelyPending: drafts.filter((row) => row.target).length,
      finalApprovedDispatched: drafts.filter(
        (row) => row.draftStatus === "approved" && row.draftHasDispatch
      ).length,
      rejected: drafts.filter(
        (row) => row.draftStatus === "rejected" || row.draftDecision === "reject"
      ).length,
      excludedOther: drafts.filter((row) => !row.target && !row.protectedFinal).length,
      retiredByOperation: drafts.filter((row) => row.draftRetiredByOperation).length,
    },
    aggregateHash: sha256(aggregateRows),
    protectedAggregateHash: sha256(protectedRows),
  };
}

export function computeRetirementAggregate(args: {
  templateDocuments: FirestoreRestDocument[];
  socialDraftDocuments: FirestoreRestDocument[];
}): RetirementAggregate {
  return aggregateFromClassified([
    ...classifyTemplates(args.templateDocuments),
    ...classifyDrafts(args.socialDraftDocuments),
  ]);
}

export function assertExpectedPreRetirementAggregate(aggregate: RetirementAggregate): void {
  const expected = {
    templates: 4,
    pendingDrafts: 9,
    approvedDispatchedDrafts: 3,
    rejectedDrafts: 3,
    excludedOtherDrafts: 0,
  };
  const matches =
    aggregate.templates.aicfMatching === expected.templates &&
    aggregate.templates.targetUnarchivedUnretired === expected.templates &&
    aggregate.templates.alreadyArchivedOrRetired === 0 &&
    aggregate.socialDrafts.aicfTotal ===
      expected.pendingDrafts + expected.approvedDispatchedDrafts + expected.rejectedDrafts &&
    aggregate.socialDrafts.targetGenuinelyPending === expected.pendingDrafts &&
    aggregate.socialDrafts.finalApprovedDispatched === expected.approvedDispatchedDrafts &&
    aggregate.socialDrafts.rejected === expected.rejectedDrafts &&
    aggregate.socialDrafts.excludedOther === expected.excludedOtherDrafts;
  if (!matches) {
    throw new Error("Production AICF aggregate changed; refusing to build a retirement write set.");
  }
}

function updateTemplateFields(args: {
  fields: Record<string, FirestoreValue> | undefined;
  timestamp: string;
  correlationId: string;
}): Record<string, FirestoreValue> {
  const fields = cloneFields(args.fields);
  fields.archived = booleanValue(true);
  fields.active = booleanValue(false);
  fields.retired = booleanValue(true);
  fields.archivedAt = timestampValue(args.timestamp);
  fields.retiredAt = timestampValue(args.timestamp);
  fields.retirementReason = stringValue(AICF_RETIREMENT_REASON);
  fields.updatedAt = timestampValue(args.timestamp);
  fields.operationalRetirement = mapValue({
    operationKey: stringValue(AICF_RETIREMENT_OPERATION_ID),
    decision: stringValue("retire_template"),
    reason: stringValue(AICF_RETIREMENT_REASON),
    correlationId: stringValue(args.correlationId),
    decidedAt: timestampValue(args.timestamp),
  });
  return fields;
}

function updateDraftFields(args: {
  fields: Record<string, FirestoreValue> | undefined;
  timestamp: string;
  correlationId: string;
}): Record<string, FirestoreValue> {
  const fields = cloneFields(args.fields);
  const approval = mapFields(fields.approval);
  approval.decision = stringValue("reject");
  approval.decisionSource = stringValue("aicf_operational_retirement");
  approval.decidedAt = timestampValue(args.timestamp);
  fields.approval = mapValue(approval);
  fields.status = stringValue("rejected");
  fields.retired = booleanValue(true);
  fields.retiredAt = timestampValue(args.timestamp);
  fields.retirementReason = stringValue(AICF_RETIREMENT_REASON);
  fields.updatedAt = timestampValue(args.timestamp);
  fields.operationalRetirement = mapValue({
    operationKey: stringValue(AICF_RETIREMENT_OPERATION_ID),
    decision: stringValue("reject_pending_draft"),
    reason: stringValue(AICF_RETIREMENT_REASON),
    correlationId: stringValue(args.correlationId),
    decidedAt: timestampValue(args.timestamp),
    queueAction: stringValue("none"),
    providerAction: stringValue("none"),
  });
  return fields;
}

export function buildRetirementPlan(args: {
  projectId: string;
  templateDocuments: FirestoreRestDocument[];
  socialDraftDocuments: FirestoreRestDocument[];
  timestamp: string;
  correlationId: string;
}): RetirementPlan {
  const rows = [
    ...classifyTemplates(args.templateDocuments),
    ...classifyDrafts(args.socialDraftDocuments),
  ];
  const preAggregate = aggregateFromClassified(rows);
  assertExpectedPreRetirementAggregate(preAggregate);

  const targets: RetirementTarget[] = rows
    .filter((row) => row.target)
    .map((row) => {
      const updatedFields = row.kind === "lead_run_template"
        ? updateTemplateFields({
            fields: row.document.fields,
            timestamp: args.timestamp,
            correlationId: args.correlationId,
          })
        : updateDraftFields({
            fields: row.document.fields,
            timestamp: args.timestamp,
            correlationId: args.correlationId,
          });
      return {
        kind: row.kind,
        source: row.document,
        pathHash: row.pathHash,
        previousContentHash: row.contentHash,
        updatedFields,
        expectedContentHash: sha256(updatedFields),
      };
    })
    .sort((left, right) => left.pathHash.localeCompare(right.pathHash));

  if (targets.filter((target) => target.kind === "lead_run_template").length !== 4) {
    throw new Error("The retirement plan does not contain exactly four lead templates.");
  }
  if (targets.filter((target) => target.kind === "social_draft").length !== 9) {
    throw new Error("The retirement plan does not contain exactly nine pending social drafts.");
  }

  const planHash = sha256({
    operationKey: AICF_RETIREMENT_OPERATION_ID,
    projectId: args.projectId,
    reason: AICF_RETIREMENT_REASON,
    targets: targets.map((target) => ({
      kind: target.kind,
      pathHash: target.pathHash,
      updateTime: target.source.updateTime,
      previousContentHash: target.previousContentHash,
    })),
  });
  const protectedDocuments = rows
    .filter((row) => row.protectedFinal)
    .map((row) => ({
      name: row.document.name,
      pathHash: row.pathHash,
      updateTime: row.document.updateTime,
      contentHash: row.contentHash,
    }))
    .sort((left, right) => left.pathHash.localeCompare(right.pathHash));

  return {
    planHash,
    preAggregate,
    targets,
    protectedDocuments,
    expectedTargetContentHash: sha256(
      targets.map((target) => ({
        kind: target.kind,
        pathHash: target.pathHash,
        expectedContentHash: target.expectedContentHash,
      }))
    ),
  };
}

export function assertProtectedDocumentsUnchanged(args: {
  protectedDocuments: RetirementPlan["protectedDocuments"];
  templateDocuments: FirestoreRestDocument[];
  socialDraftDocuments: FirestoreRestDocument[];
}): void {
  const currentByName = new Map(
    [...args.templateDocuments, ...args.socialDraftDocuments].map((document) => [
      document.name,
      document,
    ])
  );
  for (const protectedDocument of args.protectedDocuments) {
    const current = currentByName.get(protectedDocument.name);
    if (
      !current ||
      current.updateTime !== protectedDocument.updateTime ||
      documentContentHash(current) !== protectedDocument.contentHash
    ) {
      throw new Error("A protected final AICF record changed during retirement verification.");
    }
  }
}
