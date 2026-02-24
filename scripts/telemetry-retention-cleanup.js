/* eslint-disable @typescript-eslint/no-require-imports */

const admin = require("firebase-admin");
const crypto = require("crypto");

const DAY_MS = 24 * 60 * 60 * 1000;

function getEnv(name, env = process.env, fallback = undefined) {
  const value = env[name];
  return value === undefined || value === "" ? fallback : value;
}

function requiredEnv(name, env = process.env) {
  const value = getEnv(name, env);
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

function isTruthy(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function parsePositiveInt(name, raw, fallback) {
  const resolved = raw === undefined ? fallback : Number(raw);
  if (!Number.isFinite(resolved) || resolved <= 0 || !Number.isInteger(resolved)) {
    throw new Error(`${name} must be a positive integer, got: ${raw}`);
  }
  return resolved;
}

function parseConfig(env = process.env) {
  const config = {
    eventRetentionDays: parsePositiveInt(
      "TELEMETRY_EVENT_RETENTION_DAYS",
      getEnv("TELEMETRY_EVENT_RETENTION_DAYS", env),
      30
    ),
    groupRetentionDays: parsePositiveInt(
      "TELEMETRY_GROUP_RETENTION_DAYS",
      getEnv("TELEMETRY_GROUP_RETENTION_DAYS", env),
      180
    ),
    batchSize: parsePositiveInt("TELEMETRY_CLEANUP_BATCH_SIZE", getEnv("TELEMETRY_CLEANUP_BATCH_SIZE", env), 200),
    maxDeletesPerCollection: parsePositiveInt(
      "TELEMETRY_CLEANUP_MAX_DELETES_PER_COLLECTION",
      getEnv("TELEMETRY_CLEANUP_MAX_DELETES_PER_COLLECTION", env),
      5000
    ),
    dryRun: isTruthy(getEnv("TELEMETRY_CLEANUP_DRY_RUN", env, "false")),
  };

  if (config.groupRetentionDays < config.eventRetentionDays) {
    throw new Error(
      "TELEMETRY_GROUP_RETENTION_DAYS must be >= TELEMETRY_EVENT_RETENTION_DAYS to keep aggregate history coherent."
    );
  }

  return config;
}

function initLogger(correlationId) {
  return (level, message, fields = {}) => {
    const payload = {
      level,
      message,
      timestamp: new Date().toISOString(),
      correlationId,
      ...fields,
    };
    const line = JSON.stringify(payload);
    if (level === "error") {
      console.error(line);
      return;
    }
    console.log(line);
  };
}

async function initFirestore(projectId) {
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
      projectId,
    });
  }
  return admin.firestore();
}

async function deleteCollectionBeforeCutoff(args) {
  const { db, collectionName, timestampField, cutoffDate, batchSize, maxDeletes, dryRun, log } = args;

  let deleted = 0;
  let batches = 0;

  while (deleted < maxDeletes) {
    const remaining = maxDeletes - deleted;
    const take = Math.min(batchSize, remaining);

    const snap = await db
      .collection(collectionName)
      .where(timestampField, "<", cutoffDate)
      .orderBy(timestampField, "asc")
      .limit(take)
      .get();

    if (!snap || snap.empty || !Array.isArray(snap.docs) || snap.docs.length === 0) {
      break;
    }

    const docs = snap.docs;
    batches += 1;

    if (!dryRun) {
      const batch = db.batch();
      for (const doc of docs) {
        batch.delete(doc.ref);
      }
      await batch.commit();
    }

    deleted += docs.length;

    log("info", "telemetry.cleanup.batch", {
      collection: collectionName,
      timestampField,
      cutoffDate: cutoffDate.toISOString(),
      deletedInBatch: docs.length,
      deletedTotal: deleted,
      batchNumber: batches,
      dryRun,
    });

    if (docs.length < take) {
      break;
    }
  }

  return {
    collection: collectionName,
    timestampField,
    cutoffDate: cutoffDate.toISOString(),
    deleted,
    batches,
    dryRun,
    reachedDeleteCap: deleted >= maxDeletes,
  };
}

async function cleanupTelemetryRetention(db, config, log) {
  const now = new Date();
  const eventCutoff = new Date(now.getTime() - config.eventRetentionDays * DAY_MS);
  const groupCutoff = new Date(now.getTime() - config.groupRetentionDays * DAY_MS);

  const events = await deleteCollectionBeforeCutoff({
    db,
    collectionName: "telemetry_error_events",
    timestampField: "createdAt",
    cutoffDate: eventCutoff,
    batchSize: config.batchSize,
    maxDeletes: config.maxDeletesPerCollection,
    dryRun: config.dryRun,
    log,
  });

  const groups = await deleteCollectionBeforeCutoff({
    db,
    collectionName: "telemetry_error_groups",
    timestampField: "lastSeenAt",
    cutoffDate: groupCutoff,
    batchSize: config.batchSize,
    maxDeletes: config.maxDeletesPerCollection,
    dryRun: config.dryRun,
    log,
  });

  return {
    now: now.toISOString(),
    eventCutoff: eventCutoff.toISOString(),
    groupCutoff: groupCutoff.toISOString(),
    events,
    groups,
  };
}

async function main(env = process.env) {
  const projectId = requiredEnv("GCLOUD_PROJECT", env);
  const correlationId = getEnv("TELEMETRY_CLEANUP_CORRELATION_ID", env, crypto.randomUUID());
  const config = parseConfig(env);
  const log = initLogger(correlationId);

  log("info", "telemetry.cleanup.start", { projectId, ...config });

  const db = await initFirestore(projectId);
  const result = await cleanupTelemetryRetention(db, config, log);

  log("info", "telemetry.cleanup.completed", { projectId, ...result });
  return result;
}

if (require.main === module) {
  main().catch((err) => {
    const correlationId = process.env.TELEMETRY_CLEANUP_CORRELATION_ID || crypto.randomUUID();
    const payload = {
      level: "error",
      message: "telemetry.cleanup.failed",
      timestamp: new Date().toISOString(),
      correlationId,
      error: err instanceof Error ? { message: err.message, stack: err.stack } : String(err),
    };
    console.error(JSON.stringify(payload));
    process.exitCode = 1;
  });
}

module.exports = {
  DAY_MS,
  isTruthy,
  parsePositiveInt,
  parseConfig,
  deleteCollectionBeforeCutoff,
  cleanupTelemetryRetention,
  main,
};
