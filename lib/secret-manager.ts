import "server-only";

import { SecretManagerServiceClient } from "@google-cloud/secret-manager";

const client = new SecretManagerServiceClient();

function getProjectId(): string {
  const projectId =
    process.env.FIREBASE_PROJECT_ID ||
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||
    process.env.GOOGLE_CLOUD_PROJECT;

  if (!projectId) {
    throw new Error("Missing FIREBASE_PROJECT_ID/GOOGLE_CLOUD_PROJECT for Secret Manager");
  }

  return projectId;
}

function normalizeSegment(input: string): string {
  return input.replace(/[^a-zA-Z0-9-_]/g, "_");
}

function getSecretId(uid: string, key: string): string {
  const prefix = process.env.MISSION_CONTROL_SECRET_PREFIX || "mission-control";
  const safeUid = normalizeSegment(uid);
  const safeKey = normalizeSegment(key);
  return `${prefix}-${safeUid}-${safeKey}`;
}

async function ensureSecret(projectId: string, secretId: string): Promise<void> {
  const name = `projects/${projectId}/secrets/${secretId}`;
  try {
    await client.getSecret({ name });
  } catch (error: any) {
    if (error?.code === 5) {
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
  const secretId = getSecretId(uid, key);
  const name = `projects/${projectId}/secrets/${secretId}/versions/latest`;
  try {
    const [version] = await client.accessSecretVersion({ name });
    const data = version.payload?.data?.toString("utf-8");
    return data && data.length > 0 ? data : undefined;
  } catch (error: any) {
    if (error?.code === 5) {
      return undefined;
    }
    throw error;
  }
}

export async function setUserSecret(uid: string, key: string, value: string): Promise<void> {
  const projectId = getProjectId();
  const secretId = getSecretId(uid, key);

  await ensureSecret(projectId, secretId);

  await client.addSecretVersion({
    parent: `projects/${projectId}/secrets/${secretId}`,
    payload: { data: Buffer.from(value, "utf-8") },
  });
}
