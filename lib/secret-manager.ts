import "server-only";

import { createHash } from "crypto";
import { SecretManagerServiceClient } from "@google-cloud/secret-manager";

const client = new SecretManagerServiceClient();

function getProjectId(): string {
  const projectId =
    process.env.FIREBASE_PROJECT_ID ||
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||
    process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.GCLOUD_PROJECT;

  if (!projectId) {
    throw new Error(
      "Missing FIREBASE_PROJECT_ID/GOOGLE_CLOUD_PROJECT/GCLOUD_PROJECT for Secret Manager"
    );
  }

  return projectId;
}

function normalizeSegment(input: string): string {
  return input.replace(/[^a-zA-Z0-9-_]/g, "_");
}

function getLegacySecretId(uid: string, key: string): string {
  const prefix = process.env.MISSION_CONTROL_SECRET_PREFIX || "mission-control";
  const safeUid = normalizeSegment(uid);
  const safeKey = normalizeSegment(key);
  return `${prefix}-${safeUid}-${safeKey}`;
}

function canReadLegacySecretId(uid: string, key: string): boolean {
  return normalizeSegment(uid) === uid && normalizeSegment(key) === key;
}

export function getUserSecretId(uid: string, key: string): string {
  const prefix = normalizeSegment(
    process.env.MISSION_CONTROL_SECRET_PREFIX || "mission-control"
  ).slice(0, 64);
  const digest = createHash("sha256")
    .update(`${uid.length}:${uid}:${key.length}:${key}`, "utf8")
    .digest("hex")
    .slice(0, 48);
  return `${prefix}-v2-${digest}`;
}

function getErrorCode(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  const code = (error as Record<string, unknown>)["code"];
  return typeof code === "number" ? code : null;
}

async function ensureSecret(projectId: string, secretId: string): Promise<void> {
  const name = `projects/${projectId}/secrets/${secretId}`;
  try {
    await client.getSecret({ name });
  } catch (error: unknown) {
    if (getErrorCode(error) === 5) {
      await client.createSecret({
        parent: `projects/${projectId}`,
        secretId,
        secret: {
          replication: { automatic: {} },
        },
      });
    } else {
      throw error;
    }
  }
}

export async function accessUserSecret(uid: string, key: string): Promise<string | undefined> {
  const projectId = getProjectId();
  const secretIds = [
    getUserSecretId(uid, key),
    ...(canReadLegacySecretId(uid, key) ? [getLegacySecretId(uid, key)] : []),
  ];
  for (const secretId of secretIds) {
    const name = `projects/${projectId}/secrets/${secretId}/versions/latest`;
    try {
      const [version] = await client.accessSecretVersion({ name });
      const data = version.payload?.data?.toString("utf-8");
      return data && data.length > 0 ? data : undefined;
    } catch (error: unknown) {
      if (getErrorCode(error) === 5) continue;
      throw error;
    }
  }
  return undefined;
}

export async function setUserSecret(uid: string, key: string, value: string): Promise<void> {
  const projectId = getProjectId();
  const secretId = getUserSecretId(uid, key);

  await ensureSecret(projectId, secretId);

  await client.addSecretVersion({
    parent: `projects/${projectId}/secrets/${secretId}`,
    payload: { data: Buffer.from(value, "utf-8") },
  });

  if (canReadLegacySecretId(uid, key)) {
    try {
      await client.deleteSecret({
        name: `projects/${projectId}/secrets/${getLegacySecretId(uid, key)}`,
      });
    } catch (error: unknown) {
      if (getErrorCode(error) !== 5) throw error;
    }
  }
}

export async function deleteUserSecret(uid: string, key: string): Promise<void> {
  const projectId = getProjectId();
  const secretIds = [
    getUserSecretId(uid, key),
    ...(canReadLegacySecretId(uid, key) ? [getLegacySecretId(uid, key)] : []),
  ];
  for (const secretId of secretIds) {
    try {
      await client.deleteSecret({
        name: `projects/${projectId}/secrets/${secretId}`,
      });
    } catch (error: unknown) {
      if (getErrorCode(error) !== 5) throw error;
    }
  }
}
