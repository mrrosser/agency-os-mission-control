import "server-only";

import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase-admin";
import { accessUserSecret, setUserSecret } from "@/lib/secret-manager";

const TOKEN_COLLECTION = "google_oauth_tokens";
const ACCOUNT_SUBCOLLECTION = "accounts";
const PROFILE_BINDING_SUBCOLLECTION = "profile_bindings";
const ACCOUNT_SECRET_PREFIX = "google-oauth-account";

export interface StoredGoogleAccountTokens {
  accessToken?: string | null;
  refreshToken?: string | null;
  expiryDate?: number | null;
  scope?: string | null;
  tokenType?: string | null;
}

export interface GoogleAccountTokenRecord {
  accountId: string;
  profileId: string | null;
  tokens: StoredGoogleAccountTokens | null;
}

export interface GoogleAccountTokenResolution {
  registryFound: boolean;
  profileMapped: boolean;
  record: GoogleAccountTokenRecord | null;
}

export interface GoogleAccountTokenFailure {
  reauthRequired: boolean;
  code: string;
}

export interface PersistedGoogleAccountProfile {
  accountId: string;
  profileId: string;
}

function normalizeProfileId(value: string | null | undefined): string | null {
  const profileId = String(value || "").trim().toLowerCase();
  if (!profileId) return null;
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(profileId)) {
    throw new Error("Invalid Google account profile id");
  }
  return profileId;
}

function accountSecretKey(accountId: string): string {
  return `${ACCOUNT_SECRET_PREFIX}-${accountId}`;
}

function normalizeAccountId(value: string | null | undefined): string | null {
  const accountId = String(value || "").trim();
  if (!accountId) return null;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(accountId)) {
    throw new Error("Invalid Google account id");
  }
  return accountId;
}

function parseStoredTokens(raw: string | undefined): StoredGoogleAccountTokens | null {
  if (!raw) return null;

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error("Stored Google account secret is invalid JSON");
  }

  return {
    accessToken: typeof parsed.accessToken === "string" ? parsed.accessToken : null,
    refreshToken: typeof parsed.refreshToken === "string" ? parsed.refreshToken : null,
    expiryDate: typeof parsed.expiryDate === "number" ? parsed.expiryDate : null,
    scope: typeof parsed.scope === "string" ? parsed.scope : null,
    tokenType: typeof parsed.tokenType === "string" ? parsed.tokenType : null,
  };
}

function serializeStoredTokens(tokens: StoredGoogleAccountTokens): string {
  return JSON.stringify({
    accessToken: tokens.accessToken || null,
    refreshToken: tokens.refreshToken || null,
    expiryDate: tokens.expiryDate || null,
    scope: tokens.scope || null,
    tokenType: tokens.tokenType || null,
  });
}

export async function resolveGoogleAccountTokens(
  uid: string,
  profileIdInput?: string | null
): Promise<GoogleAccountTokenResolution> {
  const profileId = normalizeProfileId(profileIdInput);
  const registryRef = getAdminDb().collection(TOKEN_COLLECTION).doc(uid);
  const registrySnap = await registryRef.get();
  if (!registrySnap.exists) {
    return { registryFound: false, profileMapped: false, record: null };
  }

  const registry = registrySnap.data() || {};
  let accountId = "";

  if (profileId) {
    const bindingSnap = await registryRef
      .collection(PROFILE_BINDING_SUBCOLLECTION)
      .doc(profileId)
      .get();
    accountId = bindingSnap.exists
      ? String(bindingSnap.data()?.accountId || "").trim()
      : "";
    if (!accountId) {
      return { registryFound: true, profileMapped: false, record: null };
    }
  } else {
    accountId = String(registry.defaultAccountId || "").trim();
    if (!accountId) {
      return { registryFound: true, profileMapped: false, record: null };
    }
  }

  const accountRef = registryRef.collection(ACCOUNT_SUBCOLLECTION).doc(accountId);
  const accountSnap = await accountRef.get();
  if (!accountSnap.exists || accountSnap.data()?.pendingRevocation === true) {
    return {
      registryFound: true,
      profileMapped: Boolean(profileId),
      record: null,
    };
  }

  const tokens = parseStoredTokens(
    await accessUserSecret(uid, accountSecretKey(accountId))
  );
  return {
    registryFound: true,
    profileMapped: Boolean(profileId),
    record: { accountId, profileId, tokens },
  };
}

export async function persistGoogleAccountTokens(
  uid: string,
  accountId: string,
  tokens: StoredGoogleAccountTokens
): Promise<void> {
  const refreshedAt = new Date().toISOString();
  await setUserSecret(uid, accountSecretKey(accountId), serializeStoredTokens(tokens));
  await getAdminDb()
    .collection(TOKEN_COLLECTION)
    .doc(uid)
    .collection(ACCOUNT_SUBCOLLECTION)
    .doc(accountId)
    .set(
      {
        expiryDate: tokens.expiryDate || null,
        scope: tokens.scope || null,
        tokenType: tokens.tokenType || null,
        oauthHealthStatus: "healthy",
        lastRefreshStatus: "ok",
        lastCheckedAt: refreshedAt,
        lastRefreshAt: refreshedAt,
        lastRefreshErrorCode: null,
        lastRefreshErrorMessage: null,
        lastRefreshErrorAt: null,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
}

/**
 * Stores a completed OAuth grant in the existing schema-v2 profile registry.
 * Credentials remain in Secret Manager; Firestore receives only binding and
 * health metadata. The profile-derived fallback account id makes callback
 * retries idempotent without adding Google identity data to Firestore.
 */
export async function persistGoogleAccountProfileTokens(
  uid: string,
  profileIdInput: string,
  tokens: StoredGoogleAccountTokens
): Promise<PersistedGoogleAccountProfile> {
  const profileId = normalizeProfileId(profileIdInput);
  if (!profileId) {
    throw new Error("Google account profile id is required");
  }

  const registryRef = getAdminDb().collection(TOKEN_COLLECTION).doc(uid);
  const [registrySnap, bindingSnap] = await Promise.all([
    registryRef.get(),
    registryRef.collection(PROFILE_BINDING_SUBCOLLECTION).doc(profileId).get(),
  ]);
  const existingAccountId = bindingSnap.exists
    ? normalizeAccountId(bindingSnap.data()?.accountId)
    : null;
  const accountId = existingAccountId || `profile-${profileId}`;

  let existingTokens: StoredGoogleAccountTokens | null = null;
  if (existingAccountId) {
    existingTokens = parseStoredTokens(
      await accessUserSecret(uid, accountSecretKey(existingAccountId))
    );
  }

  const mergedTokens: StoredGoogleAccountTokens = {
    accessToken: tokens.accessToken ?? existingTokens?.accessToken ?? null,
    refreshToken: tokens.refreshToken ?? existingTokens?.refreshToken ?? null,
    expiryDate: tokens.expiryDate ?? existingTokens?.expiryDate ?? null,
    scope: tokens.scope ?? existingTokens?.scope ?? null,
    tokenType: tokens.tokenType ?? existingTokens?.tokenType ?? null,
  };
  if (!mergedTokens.refreshToken) {
    throw new Error("Missing refresh token from Google");
  }

  const refreshedAt = new Date().toISOString();
  await setUserSecret(uid, accountSecretKey(accountId), serializeStoredTokens(mergedTokens));

  const registryData = registrySnap.exists ? registrySnap.data() || {} : {};
  const registryUpdate: Record<string, unknown> = {
    schemaVersion: 2,
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (!String(registryData.defaultAccountId || "").trim()) {
    registryUpdate.defaultAccountId = accountId;
  }

  await Promise.all([
    registryRef.set(registryUpdate, { merge: true }),
    registryRef.collection(PROFILE_BINDING_SUBCOLLECTION).doc(profileId).set(
      {
        accountId,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    ),
    registryRef.collection(ACCOUNT_SUBCOLLECTION).doc(accountId).set(
      {
        expiryDate: mergedTokens.expiryDate || null,
        scope: mergedTokens.scope || null,
        tokenType: mergedTokens.tokenType || null,
        oauthHealthStatus: "healthy",
        lastRefreshStatus: "ok",
        lastCheckedAt: refreshedAt,
        lastRefreshAt: refreshedAt,
        lastRefreshErrorCode: null,
        lastRefreshErrorMessage: null,
        lastRefreshErrorAt: null,
        pendingRevocation: false,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    ),
  ]);

  return { accountId, profileId };
}

export async function persistGoogleAccountTokenFailure(
  uid: string,
  accountId: string,
  failure: GoogleAccountTokenFailure
): Promise<void> {
  const checkedAt = new Date().toISOString();
  const code =
    String(failure.code || "refresh_failed")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, "_")
      .slice(0, 64) || "refresh_failed";
  const message = failure.reauthRequired
    ? "Google OAuth refresh requires reconnection."
    : "Google OAuth token refresh failed.";

  await getAdminDb()
    .collection(TOKEN_COLLECTION)
    .doc(uid)
    .collection(ACCOUNT_SUBCOLLECTION)
    .doc(accountId)
    .set(
      {
        oauthHealthStatus: failure.reauthRequired ? "reauth_required" : "refresh_due",
        lastRefreshStatus: "error",
        lastCheckedAt: checkedAt,
        lastRefreshErrorCode: code,
        lastRefreshErrorMessage: message,
        lastRefreshErrorAt: checkedAt,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
}
