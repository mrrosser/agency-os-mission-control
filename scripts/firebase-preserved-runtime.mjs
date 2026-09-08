import fs from "node:fs";
import { fileURLToPath } from "node:url";

export const SECOND_BRAIN_SECRET_REFERENCES = Object.freeze({
  SECOND_BRAIN_SERVICE_TOKEN: "second-brain-service-token",
  SECOND_BRAIN_EMAIL_ACTION_SECRET: "second-brain-email-action-secret",
  SECOND_BRAIN_REVIEW_ALLOWED_UIDS: "second-brain-review-allowed-uids",
  SECOND_BRAIN_REVIEW_EMAILS: "second-brain-review-emails",
  SECOND_BRAIN_OPERATOR_UID: "second-brain-operator-uid",
});

export function validateProviderSendFlag(value) {
  if (value !== "true" && value !== "false") {
    throw new Error("WARM_RECONNECT_PROVIDER_SEND_ENABLED must be exactly true or false");
  }
  return value;
}

function revisionEnvironment(revision) {
  const containers = revision?.spec?.containers;
  if (!Array.isArray(containers) || containers.length !== 1 || !Array.isArray(containers[0]?.env)) {
    throw new Error("Expected a single-container Cloud Run revision with environment metadata");
  }
  return containers[0].env;
}

export function snapshotSecondBrainReferences(revision) {
  const env = revisionEnvironment(revision);
  const bindings = Object.entries(SECOND_BRAIN_SECRET_REFERENCES).map(([envName, secret]) => {
    const matches = env.filter((entry) => entry?.name === envName);
    const entry = matches[0];
    if (matches.length !== 1 || Object.hasOwn(entry, "value")
      || entry?.valueFrom?.secretKeyRef?.name !== secret
      || entry?.valueFrom?.secretKeyRef?.key !== "latest") {
      throw new Error(`Missing or unexpected existing Secret Manager reference: ${envName}`);
    }
    return { envName, secret, version: "latest" };
  });
  return { schemaVersion: 1, bindings };
}

export function secondBrainUpdateSecrets(snapshot) {
  const expected = Object.entries(SECOND_BRAIN_SECRET_REFERENCES).map(([envName, secret]) => ({ envName, secret, version: "latest" }));
  if (snapshot?.schemaVersion !== 1 || JSON.stringify(snapshot.bindings) !== JSON.stringify(expected)) {
    throw new Error("The preserved reference snapshot does not match the five approved bindings");
  }
  return expected.map(({ envName, secret, version }) => `${envName}=${secret}:${version}`).join(",");
}

export function verifyPreservedRuntime(revision, snapshot, expectedSendFlag) {
  validateProviderSendFlag(expectedSendFlag);
  const expected = secondBrainUpdateSecrets(snapshot);
  if (secondBrainUpdateSecrets(snapshotSecondBrainReferences(revision)) !== expected) {
    throw new Error("Runtime Secret Manager references do not match the pre-deploy snapshot");
  }
  const flagEntries = revisionEnvironment(revision).filter((entry) => entry?.name === "WARM_RECONNECT_PROVIDER_SEND_ENABLED");
  if (flagEntries.length !== 1 || flagEntries[0].value !== expectedSendFlag || flagEntries[0].valueFrom) {
    throw new Error("Runtime provider-send flag does not match this workflow's explicit setting");
  }
  return true;
}

export function replaceProviderSendDotenvFlag(contents, flag) {
  validateProviderSendFlag(flag);
  const lines = contents.split(/\r?\n/).filter((line) => !/^\s*(?:export\s+)?WARM_RECONNECT_PROVIDER_SEND_ENABLED\s*=/.test(line));
  while (lines.at(-1) === "") lines.pop();
  return `${lines.join("\n")}\nWARM_RECONNECT_PROVIDER_SEND_ENABLED=${flag}\n`;
}

function readRevisionFromStdin() {
  const raw = fs.readFileSync(0, "utf8");
  if (Buffer.byteLength(raw, "utf8") > 2_000_000) throw new Error("Cloud Run metadata input exceeds the safety limit");
  try { return JSON.parse(raw); } catch { throw new Error("Invalid Cloud Run metadata JSON"); }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) {
  try {
    const [command, path, flag] = process.argv.slice(2);
    if (!path) throw new Error("A snapshot or dotenv file path is required");
    if (command === "capture") {
      const snapshot = snapshotSecondBrainReferences(readRevisionFromStdin());
      const references = secondBrainUpdateSecrets(snapshot);
      fs.writeFileSync(path, `${JSON.stringify(snapshot, null, 2)}\n`, { mode: 0o600 });
      // Only allowlisted secret names and version selectors are emitted, never values.
      process.stdout.write(`${references}\n`);
    } else if (command === "verify") {
      const snapshot = JSON.parse(fs.readFileSync(path, "utf8"));
      verifyPreservedRuntime(readRevisionFromStdin(), snapshot, flag);
      process.stdout.write("Verified five preserved secret references and the exact provider-send flag.\n");
    } else if (command === "set-send-flag") {
      const revised = replaceProviderSendDotenvFlag(fs.readFileSync(path, "utf8"), flag);
      fs.writeFileSync(path, revised, { mode: 0o600 });
      process.stdout.write("Pinned the workflow's explicit provider-send flag for framework discovery.\n");
    } else {
      throw new Error("Unknown preserved-runtime command");
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "Preserved runtime validation failed"}\n`);
    process.exitCode = 1;
  }
}
