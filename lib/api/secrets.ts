import "server-only";

import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase-admin";
import { accessUserSecret, setUserSecret } from "@/lib/secret-manager";

export interface ApiKeys {
  openaiKey?: string;
  twilioSid?: string;
  twilioToken?: string;
  elevenLabsKey?: string;
  heyGenKey?: string;
}

export type SecretKey = keyof ApiKeys;
export type SecretStatus = Record<SecretKey, "secret" | "env" | "missing">;

const SECRET_KEYS: SecretKey[] = [
  "openaiKey",
  "twilioSid",
  "twilioToken",
  "elevenLabsKey",
  "heyGenKey",
];

const SECRET_ENV_MAP: Record<SecretKey, string> = {
  openaiKey: "OPENAI_API_KEY",
  twilioSid: "TWILIO_ACCOUNT_SID",
  twilioToken: "TWILIO_AUTH_TOKEN",
  elevenLabsKey: "ELEVENLABS_API_KEY",
  heyGenKey: "HEYGEN_API_KEY",
};

async function migrateLegacyKeys(uid: string): Promise<void> {
  const docRef = getAdminDb().collection("identities").doc(uid);
  const doc = await docRef.get();
  if (!doc.exists) return;

  const data = doc.data();
  const legacyKeys = (data?.apiKeys as ApiKeys | undefined) || undefined;
  if (!legacyKeys) return;

  let migrated = false;
  for (const key of SECRET_KEYS) {
    const value = legacyKeys[key];
    if (!value) continue;
    const existing = await accessUserSecret(uid, key);
    if (!existing) {
      await setUserSecret(uid, key, value);
      migrated = true;
    }
  }

  if (migrated) {
    await docRef.set({ apiKeys: FieldValue.delete() }, { merge: true });
  }
}

export async function resolveSecret(
  uid: string,
  key: SecretKey,
  envVarName: string
): Promise<string | undefined> {
  const direct = await accessUserSecret(uid, key);
  if (direct) return direct;

  await migrateLegacyKeys(uid);
  const migrated = await accessUserSecret(uid, key);
  if (migrated) return migrated;

  return process.env[envVarName];
}

export async function setUserSecrets(uid: string, apiKeys: ApiKeys): Promise<void> {
  const updates = SECRET_KEYS.filter((key) => {
    const value = apiKeys[key];
    return typeof value === "string" && value.trim().length > 0;
  });

  if (updates.length === 0) {
    return;
  }

  for (const key of updates) {
    const value = (apiKeys[key] || "").trim();
    await setUserSecret(uid, key, value);
  }

  await getAdminDb().collection("identities").doc(uid).set(
    { apiKeys: FieldValue.delete() },
    { merge: true }
  );
}

export async function getSecretStatus(uid: string): Promise<SecretStatus> {
  await migrateLegacyKeys(uid);
  const status = {} as SecretStatus;

  for (const key of SECRET_KEYS) {
    const secret = await accessUserSecret(uid, key);
    if (secret) {
      status[key] = "secret";
      continue;
    }

    const envVar = SECRET_ENV_MAP[key];
    status[key] = process.env[envVar] ? "env" : "missing";
  }

  return status;
}
