#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import process from "node:process";
import {
  AICF_RETIREMENT_OPERATION_ID,
  AICF_RETIREMENT_REASON,
  assertProtectedDocumentsUnchanged,
  buildRetirementPlan,
  canonicalJson,
  computeRetirementAggregate,
  decodeFirestoreFields,
  sha256,
} from "../lib/operations/aicf-firestore-retirement.ts";

const EXPECTED_PROJECT_ID = "leadflow-review";
const RECEIPT_COLLECTION = "operational_retirement_receipts";
const RECEIPT_SCHEMA_VERSION = 1;
const MAX_SAFE_SNAPSHOT_BYTES = 850_000;

function takeValue(values, index, name) {
  const token = values[index];
  if (token.startsWith(`${name}=`)) return { value: token.slice(name.length + 1), consumed: 0 };
  if (token === name && values[index + 1] && !values[index + 1].startsWith("--")) {
    return { value: values[index + 1], consumed: 1 };
  }
  return null;
}

function parseArguments(values) {
  const options = { projectId: null, mode: null, confirmation: null };
  for (let index = 0; index < values.length; index += 1) {
    const token = values[index];
    if (token === "--dry-run") {
      if (options.mode) throw new Error("Choose exactly one operation mode.");
      options.mode = "dry_run";
      continue;
    }
    if (token === "--apply") {
      if (options.mode) throw new Error("Choose exactly one operation mode.");
      options.mode = "apply";
      continue;
    }
    let parsed = takeValue(values, index, "--project-id");
    if (parsed) {
      options.projectId = parsed.value;
      index += parsed.consumed;
      continue;
    }
    parsed = takeValue(values, index, "--confirm");
    if (parsed) {
      options.confirmation = parsed.value;
      index += parsed.consumed;
      continue;
    }
    throw new Error("Unsupported argument.");
  }
  if (options.projectId !== EXPECTED_PROJECT_ID) {
    throw new Error(`This operator is pinned to ${EXPECTED_PROJECT_ID}.`);
  }
  if (!options.mode) throw new Error("Choose --dry-run or --apply.");
  if (options.mode === "dry_run" && options.confirmation) {
    throw new Error("--confirm is apply-only.");
  }
  if (options.mode === "apply" && !/^sha256:[a-f0-9]{64}$/.test(options.confirmation || "")) {
    throw new Error("Apply requires the exact --confirm plan hash from a fresh dry-run.");
  }
  return options;
}

function structuredLog(event, fields) {
  process.stdout.write(
    `${JSON.stringify({ level: "info", event, timestamp: new Date().toISOString(), ...fields })}\n`
  );
}

function encodeFirestoreValue(value) {
  if (value === null) return { nullValue: null };
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") {
    return Number.isInteger(value)
      ? { integerValue: String(value) }
      : { doubleValue: value };
  }
  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map(encodeFirestoreValue) } };
  }
  if (value && typeof value === "object") {
    return {
      mapValue: {
        fields: Object.fromEntries(
          Object.entries(value).map(([key, child]) => [key, encodeFirestoreValue(child)])
        ),
      },
    };
  }
  throw new Error("Unsupported audit receipt value.");
}

function encodeFirestoreFields(value) {
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, encodeFirestoreValue(child)])
  );
}

function aggregateForOutput(aggregate) {
  return {
    templates: aggregate.templates,
    socialDrafts: aggregate.socialDrafts,
    aggregateHash: aggregate.aggregateHash,
    protectedAggregateHash: aggregate.protectedAggregateHash,
  };
}

function createFirestoreClient({ projectId, accessToken }) {
  const databaseName = `projects/${projectId}/databases/(default)`;
  const documentsName = `${databaseName}/documents`;
  const apiBase = `https://firestore.googleapis.com/v1/${documentsName}`;
  const headers = {
    authorization: `Bearer ${accessToken}`,
    "content-type": "application/json",
  };

  async function request(url, init, allowedStatuses = []) {
    const response = await fetch(url, { ...init, headers: { ...headers, ...(init?.headers || {}) } });
    if (!response.ok && !allowedStatuses.includes(response.status)) {
      throw new Error(`Firestore request failed with status ${response.status}.`);
    }
    if (response.status === 404 || response.status === 204) return null;
    return response.json();
  }

  async function runCollectionGroupQuery(collectionId, transaction) {
    const body = {
      structuredQuery: { from: [{ collectionId, allDescendants: true }] },
      ...(transaction ? { transaction } : {}),
    };
    const rows = await request(`${apiBase}:runQuery`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    return (rows || []).flatMap((row) => (row.document ? [row.document] : []));
  }

  async function readState(transaction) {
    const [templateDocuments, socialDraftDocuments] = await Promise.all([
      runCollectionGroupQuery("lead_run_templates", transaction),
      runCollectionGroupQuery("social_drafts", transaction),
    ]);
    return { templateDocuments, socialDraftDocuments };
  }

  async function getReceipt() {
    return request(
      `https://firestore.googleapis.com/v1/${documentsName}/${RECEIPT_COLLECTION}/${AICF_RETIREMENT_OPERATION_ID}`,
      { method: "GET" },
      [404]
    );
  }

  async function readReceiptSnapshots() {
    const documents = await runCollectionGroupQuery("snapshots");
    const parentPrefix =
      `${documentsName}/${RECEIPT_COLLECTION}/${AICF_RETIREMENT_OPERATION_ID}/snapshots/`;
    return documents.filter((document) => document.name.startsWith(parentPrefix));
  }

  async function beginTransaction() {
    const response = await request(`${apiBase}:beginTransaction`, {
      method: "POST",
      body: JSON.stringify({ options: { readWrite: {} } }),
    });
    if (!response?.transaction) throw new Error("Firestore did not return a transaction token.");
    return response.transaction;
  }

  async function commit(transaction, writes) {
    return request(`${apiBase}:commit`, {
      method: "POST",
      body: JSON.stringify({ transaction, writes }),
    });
  }

  async function rollback(transaction) {
    try {
      await request(`${apiBase}:rollback`, {
        method: "POST",
        body: JSON.stringify({ transaction }),
      });
    } catch {
      // Preserve the original failure. A transaction with no commit has no writes.
    }
  }

  return {
    documentsName,
    readState,
    getReceipt,
    readReceiptSnapshots,
    beginTransaction,
    commit,
    rollback,
  };
}

function buildWrites({ client, plan, correlationId, timestamp }) {
  const receiptName =
    `${client.documentsName}/${RECEIPT_COLLECTION}/${AICF_RETIREMENT_OPERATION_ID}`;
  const targetWrites = plan.targets.map((target) => ({
    update: { name: target.source.name, fields: target.updatedFields },
    currentDocument: { updateTime: target.source.updateTime },
  }));
  const snapshotWrites = plan.targets.map((target) => {
    const snapshotId = target.pathHash.replace(/^sha256:/, "");
    const fields = {
      ...encodeFirestoreFields({
        schemaVersion: RECEIPT_SCHEMA_VERSION,
        operationKey: AICF_RETIREMENT_OPERATION_ID,
        targetKind: target.kind,
        targetPath: target.source.name,
        previousUpdateTime: target.source.updateTime,
        previousContentHash: target.previousContentHash,
        expectedContentHash: target.expectedContentHash,
        planHash: plan.planHash,
      }),
      previousFields: { mapValue: { fields: target.source.fields || {} } },
    };
    if (Buffer.byteLength(canonicalJson(fields), "utf8") > MAX_SAFE_SNAPSHOT_BYTES) {
      throw new Error("A rollback snapshot is too large for the restricted Firestore receipt.");
    }
    return {
      update: {
        name: `${receiptName}/snapshots/${snapshotId}`,
        fields,
      },
      currentDocument: { exists: false },
    };
  });
  const receiptFields = encodeFirestoreFields({
    schemaVersion: RECEIPT_SCHEMA_VERSION,
    operationKey: AICF_RETIREMENT_OPERATION_ID,
    status: "completed",
    projectId: EXPECTED_PROJECT_ID,
    reason: AICF_RETIREMENT_REASON,
    correlationId,
    appliedAt: timestamp,
    planHash: plan.planHash,
    preAggregateHash: plan.preAggregate.aggregateHash,
    preProtectedAggregateHash: plan.preAggregate.protectedAggregateHash,
    expectedTargetContentHash: plan.expectedTargetContentHash,
    rollbackReady: true,
    targetCount: plan.targets.length,
    templateTargetCount: plan.targets.filter((target) => target.kind === "lead_run_template").length,
    socialDraftTargetCount: plan.targets.filter((target) => target.kind === "social_draft").length,
    protectedHistoricalCount: plan.protectedDocuments.length,
    snapshotCount: snapshotWrites.length,
    externalQueueActions: 0,
    externalProviderActions: 0,
  });
  const receiptWrite = {
    update: { name: receiptName, fields: receiptFields },
    currentDocument: { exists: false },
  };
  return [...targetWrites, ...snapshotWrites, receiptWrite];
}

function assertAppliedTargets(plan, currentState) {
  const currentByName = new Map(
    [...currentState.templateDocuments, ...currentState.socialDraftDocuments].map((document) => [
      document.name,
      document,
    ])
  );
  for (const target of plan.targets) {
    const current = currentByName.get(target.source.name);
    if (!current || sha256(current.fields || {}) !== target.expectedContentHash) {
      throw new Error("A retired target failed exact post-commit content verification.");
    }
  }
}

async function verifyExistingReceipt({ client, receipt, correlationId }) {
  const receiptData = decodeFirestoreFields(receipt.fields);
  if (
    receiptData.operationKey !== AICF_RETIREMENT_OPERATION_ID ||
    receiptData.status !== "completed" ||
    receiptData.rollbackReady !== true ||
    receiptData.snapshotCount !== 13
  ) {
    throw new Error("The existing retirement receipt is incomplete or incompatible.");
  }
  const [state, snapshots] = await Promise.all([
    client.readState(),
    client.readReceiptSnapshots(),
  ]);
  if (snapshots.length !== 13) {
    throw new Error("The existing retirement receipt does not contain thirteen rollback snapshots.");
  }
  const currentByName = new Map(
    [...state.templateDocuments, ...state.socialDraftDocuments].map((document) => [
      document.name,
      document,
    ])
  );
  for (const snapshot of snapshots) {
    const snapshotData = decodeFirestoreFields(snapshot.fields);
    const targetPath = String(snapshotData.targetPath || "");
    const expectedContentHash = String(snapshotData.expectedContentHash || "");
    const current = currentByName.get(targetPath);
    if (!current || sha256(current.fields || {}) !== expectedContentHash) {
      throw new Error("An existing retired target no longer matches its restricted receipt.");
    }
  }
  const aggregate = computeRetirementAggregate(state);
  structuredLog("aicf.firestore_retirement.idempotent_verified", {
    correlationId,
    projectId: EXPECTED_PROJECT_ID,
    operationKey: AICF_RETIREMENT_OPERATION_ID,
    targetCount: 13,
  });
  return {
    ok: true,
    mode: "already_applied",
    projectId: EXPECTED_PROJECT_ID,
    operationKey: AICF_RETIREMENT_OPERATION_ID,
    correlationId,
    idempotent: true,
    rollbackReceiptVerified: true,
    targetCount: 13,
    aggregate: aggregateForOutput(aggregate),
    externalActions: { queue: 0, provider: 0 },
  };
}

const correlationId = randomUUID();

try {
  const options = parseArguments(process.argv.slice(2));
  const accessToken = String(process.env.AICF_FIRESTORE_ACCESS_TOKEN || "").trim();
  if (!accessToken) {
    throw new Error("AICF_FIRESTORE_ACCESS_TOKEN is required and must not be printed.");
  }
  const client = createFirestoreClient({ projectId: options.projectId, accessToken });
  const existingReceipt = await client.getReceipt();
  if (existingReceipt) {
    const report = await verifyExistingReceipt({ client, receipt: existingReceipt, correlationId });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exit(0);
  }

  if (options.mode === "dry_run") {
    const state = await client.readState();
    const plan = buildRetirementPlan({
      projectId: options.projectId,
      ...state,
      timestamp: new Date().toISOString(),
      correlationId,
    });
    structuredLog("aicf.firestore_retirement.dry_run_completed", {
      correlationId,
      projectId: options.projectId,
      operationKey: AICF_RETIREMENT_OPERATION_ID,
      planHash: plan.planHash,
      templateTargets: 4,
      socialDraftTargets: 9,
      protectedHistoricalRecords: 6,
    });
    process.stdout.write(
      `${JSON.stringify(
        {
          ok: true,
          mode: "dry_run",
          projectId: options.projectId,
          operationKey: AICF_RETIREMENT_OPERATION_ID,
          correlationId,
          planHash: plan.planHash,
          aggregate: aggregateForOutput(plan.preAggregate),
          proposedWrites: {
            targetUpdates: 13,
            restrictedRollbackSnapshots: 13,
            receipt: 1,
            total: 27,
          },
          protectedHistoricalRecords: 6,
          externalActions: { queue: 0, provider: 0 },
        },
        null,
        2
      )}\n`
    );
    process.exit(0);
  }

  let transaction = null;
  let committed = false;
  let plan;
  try {
    transaction = await client.beginTransaction();
    const state = await client.readState(transaction);
    const timestamp = new Date().toISOString();
    plan = buildRetirementPlan({
      projectId: options.projectId,
      ...state,
      timestamp,
      correlationId,
    });
    if (plan.planHash !== options.confirmation) {
      throw new Error("The confirmed dry-run hash no longer matches production state.");
    }
    const writes = buildWrites({ client, plan, correlationId, timestamp });
    if (writes.length !== 27) throw new Error("The transaction write count is not exactly 27.");
    await client.commit(transaction, writes);
    committed = true;
  } finally {
    if (transaction && !committed) await client.rollback(transaction);
  }

  const [postState, storedReceipt] = await Promise.all([
    client.readState(),
    client.getReceipt(),
  ]);
  if (!storedReceipt) throw new Error("The restricted rollback receipt was not committed.");
  assertAppliedTargets(plan, postState);
  assertProtectedDocumentsUnchanged({
    protectedDocuments: plan.protectedDocuments,
    ...postState,
  });
  const postAggregate = computeRetirementAggregate(postState);
  if (
    postAggregate.templates.aicfMatching !== 4 ||
    postAggregate.templates.targetUnarchivedUnretired !== 0 ||
    postAggregate.templates.alreadyArchivedOrRetired !== 4 ||
    postAggregate.socialDrafts.aicfTotal !== 15 ||
    postAggregate.socialDrafts.targetGenuinelyPending !== 0 ||
    postAggregate.socialDrafts.finalApprovedDispatched !== 3 ||
    postAggregate.socialDrafts.rejected !== 12 ||
    postAggregate.socialDrafts.excludedOther !== 0 ||
    postAggregate.socialDrafts.retiredByOperation !== 9
  ) {
    throw new Error("Post-commit AICF aggregate did not match the exact retirement outcome.");
  }

  structuredLog("aicf.firestore_retirement.applied", {
    correlationId,
    projectId: options.projectId,
    operationKey: AICF_RETIREMENT_OPERATION_ID,
    planHash: plan.planHash,
    targetUpdates: 13,
    rollbackSnapshots: 13,
    protectedHistoricalRecords: 6,
    externalQueueActions: 0,
    externalProviderActions: 0,
  });
  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        mode: "apply",
        projectId: options.projectId,
        operationKey: AICF_RETIREMENT_OPERATION_ID,
        correlationId,
        planHash: plan.planHash,
        preAggregate: aggregateForOutput(plan.preAggregate),
        postAggregate: aggregateForOutput(postAggregate),
        committedWrites: {
          targetUpdates: 13,
          restrictedRollbackSnapshots: 13,
          receipt: 1,
          total: 27,
        },
        rollbackReceiptVerified: true,
        protectedHistoricalRecordsVerified: 6,
        externalActions: { queue: 0, provider: 0 },
      },
      null,
      2
    )}\n`
  );
} catch (error) {
  process.stderr.write(
    `${JSON.stringify({
      level: "error",
      event: "aicf.firestore_retirement.failed",
      timestamp: new Date().toISOString(),
      correlationId,
      message: error instanceof Error ? error.message : "AICF Firestore retirement failed.",
      writesConfirmed: false,
      externalQueueActions: 0,
      externalProviderActions: 0,
    })}\n`
  );
  process.exitCode = 1;
}
