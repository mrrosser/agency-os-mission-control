/* eslint-disable @typescript-eslint/no-require-imports */

const fs = require("node:fs");
const path = require("node:path");

/**
 * @typedef {{
 *   exists: boolean,
 *   sizeBytes: number | null,
 *   lastWriteTimeIso: string | null,
 *   ageHours: number | null
 * }} StorageStateCheck
 */

const DEFAULT_STORAGE_STATE_PATH = path.join(
  "C:",
  "CTO Projects",
  "ui-tests",
  "storage",
  "socialops-client.json"
);

function nowMs() {
  return Date.now();
}

function toIsoSafe(value) {
  try {
    return new Date(value).toISOString();
  } catch {
    return null;
  }
}

function computeStorageStateCheck(storageStatePath) {
  /** @type {StorageStateCheck} */
  const result = {
    exists: false,
    sizeBytes: null,
    lastWriteTimeIso: null,
    ageHours: null,
  };

  let stat;
  try {
    stat = fs.statSync(storageStatePath);
  } catch {
    return result;
  }

  result.exists = true;
  result.sizeBytes = stat.size;
  result.lastWriteTimeIso = toIsoSafe(stat.mtimeMs);
  result.ageHours = Math.max(0, (nowMs() - stat.mtimeMs) / 3_600_000);
  return result;
}

function storageStateIsFresh(check, maxAgeHours) {
  if (!check.exists) return false;
  if (!Number.isFinite(check.ageHours)) return false;
  return check.ageHours <= maxAgeHours;
}

function appendJsonl(jsonlPath, entry) {
  fs.mkdirSync(path.dirname(jsonlPath), { recursive: true });
  fs.appendFileSync(jsonlPath, `${JSON.stringify(entry)}\n`, { encoding: "utf8" });
}

function redactEnv() {
  return {
    SOCIALOPS_PLAYWRIGHT_STORAGE_STATE_SECRET: process.env.SOCIALOPS_PLAYWRIGHT_STORAGE_STATE_SECRET ? "[set]" : "[unset]",
    SOCIALOPS_GCP_PROJECT_ID: process.env.SOCIALOPS_GCP_PROJECT_ID ? "[set]" : "[unset]",
  };
}

async function fetchSecretText({ projectId, secretId, version }) {
  // Lazy require to avoid loading GCP deps during unit tests unless actually needed.
  const { SecretManagerServiceClient } = require("@google-cloud/secret-manager");
  const client = new SecretManagerServiceClient();
  const name = `projects/${projectId}/secrets/${secretId}/versions/${version}`;
  const [resp] = await client.accessSecretVersion({ name });
  const data = resp?.payload?.data;
  if (!data) return "";
  return Buffer.isBuffer(data) ? data.toString("utf8") : String(data);
}

async function main() {
  const runId = String(process.env.AUTOPILOT_RUN_ID || "").trim() || null;
  const correlationId = String(process.env.AUTOPILOT_CORRELATION_ID || "").trim() || null;

  const storageStatePath = String(process.env.SOCIALOPS_STORAGE_STATE_PATH || DEFAULT_STORAGE_STATE_PATH).trim();
  const maxAgeHours = Number(process.env.SOCIALOPS_STORAGE_STATE_MAX_AGE_HOURS || "24");
  const checkJsonPath = String(process.env.AUTOPILOT_STORAGE_STATE_CHECK_JSON || "").trim() || null;
  const secretAccessJsonl = String(process.env.AUTOPILOT_SECRET_ACCESS_JSONL || "").trim() || null;
  const logPath = String(process.env.AUTOPILOT_AUTH_BOOTSTRAP_LOG || "").trim() || null;

  const capturedAt = new Date().toISOString();
  const check = computeStorageStateCheck(storageStatePath, maxAgeHours);

  const checkRecord = {
    event: "storage_state.check",
    run_id: runId,
    correlation_id: correlationId,
    captured_at: capturedAt,
    storage_state_path: storageStatePath,
    exists: check.exists,
    size_bytes: check.sizeBytes,
    last_write_time: check.lastWriteTimeIso,
    age_hours: check.ageHours,
    max_age_hours: maxAgeHours,
  };

  if (checkJsonPath) {
    fs.mkdirSync(path.dirname(checkJsonPath), { recursive: true });
    fs.writeFileSync(checkJsonPath, `${JSON.stringify(checkRecord, null, 2)}\n`, { encoding: "utf8" });
  }

  if (storageStateIsFresh(check, maxAgeHours)) {
    const msg = "Storage state appears fresh; bootstrap not required.";
    if (logPath) {
      fs.mkdirSync(path.dirname(logPath), { recursive: true });
      fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${msg}\n`, { encoding: "utf8" });
    }
    process.stdout.write(`${msg}\n`);
    return;
  }

  const projectId = String(process.env.SOCIALOPS_GCP_PROJECT_ID || "").trim();
  const secretId = String(process.env.SOCIALOPS_PLAYWRIGHT_STORAGE_STATE_SECRET || "").trim();
  const version = String(process.env.SOCIALOPS_PLAYWRIGHT_STORAGE_STATE_SECRET_VERSION || "latest").trim() || "latest";

  if (!projectId || !secretId) {
    const msg =
      "Storage state is missing/stale and no Secret Manager source is configured. " +
      "Set SOCIALOPS_GCP_PROJECT_ID and SOCIALOPS_PLAYWRIGHT_STORAGE_STATE_SECRET.";
    if (logPath) {
      fs.mkdirSync(path.dirname(logPath), { recursive: true });
      fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${msg} env=${JSON.stringify(redactEnv())}\n`, {
        encoding: "utf8",
      });
    }
    process.stderr.write(`${msg}\n`);
    process.exitCode = 2;
    return;
  }

  if (secretAccessJsonl) {
    appendJsonl(secretAccessJsonl, {
      project: projectId,
      secret: secretId,
      version,
      run_id: runId,
      correlation_id: correlationId,
      event: "secret_manager.storage_state.access",
      captured_at: capturedAt,
      ok: true,
    });
  }

  const secretText = (await fetchSecretText({ projectId, secretId, version })).trim();
  if (!secretText) {
    const msg = "Secret Manager returned empty storage state payload.";
    if (logPath) {
      fs.mkdirSync(path.dirname(logPath), { recursive: true });
      fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${msg}\n`, { encoding: "utf8" });
    }
    process.stderr.write(`${msg}\n`);
    process.exitCode = 3;
    return;
  }

  fs.mkdirSync(path.dirname(storageStatePath), { recursive: true });
  fs.writeFileSync(storageStatePath, `${secretText}\n`, { encoding: "utf8" });

  const msg = "Storage state refreshed from Secret Manager.";
  if (logPath) {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${msg}\n`, { encoding: "utf8" });
  }
  process.stdout.write(`${msg}\n`);
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`bootstrap_socialops_storage_state.failed: ${err?.message || String(err)}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  DEFAULT_STORAGE_STATE_PATH,
  computeStorageStateCheck,
  storageStateIsFresh,
};
