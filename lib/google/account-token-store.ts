import "server-only";

import { createHash, randomUUID } from "crypto";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase-admin";
import {
  accessUserSecret,
  deleteUserSecret,
  setUserSecret,
} from "@/lib/secret-manager";

const TOKEN_COLLECTION = "google_oauth_tokens";
const ACCOUNT_SUBCOLLECTION = "accounts";
const PROFILE_BINDING_SUBCOLLECTION = "profile_bindings";
const ACCOUNT_SECRET_PREFIX = "google-oauth-account";

export type GoogleAccountScopePreset =
  | "core"
  | "drive"
  | "calendar"
  | "gmail"
  | "gmail_send"
  | "full";

export interface StoredGoogleAccountTokens {
  accessToken?: string | null;
  refreshToken?: string | null;
  expiryDate?: number | null;
  scope?: string | null;
  tokenType?: string | null;
  accountEmail?: string | null;
  accountSubject?: string | null;
  scopePreset?: GoogleAccountScopePreset | null;
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

function normalizedAccountEmail(value: string | null | undefined): string | null {
  const email = String(value || "").trim().toLowerCase();
  return email && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)
    ? email
    : null;
}

export interface GoogleAccountProfileDisconnect {
  profileId: string;
  accountId: string | null;
  operationId: string | null;
  localCredentialDeletionRequired: boolean;
}

export class GoogleAccountProfileConflictError extends Error {
  readonly code = "google_account_already_connected";

  constructor() {
    super("This Google account is already connected to another organization profile");
    this.name = "GoogleAccountProfileConflictError";
  }
}

export class GoogleAccountProfileReplacementRequiresDisconnectError extends Error {
  readonly code = "google_profile_replacement_requires_disconnect";

  constructor() {
    super(
      "Disconnect this organization profile before connecting a different Google account"
    );
    this.name = "GoogleAccountProfileReplacementRequiresDisconnectError";
  }
}

const GOOGLE_IDENTITY_SCOPE_ALIASES = new Set([
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  "openid",
  "email",
  "profile",
]);

const GOOGLE_DATA_SCOPES_BY_PRESET: Readonly<
  Record<GoogleAccountScopePreset, readonly string[]>
> = {
  core: [
    "https://www.googleapis.com/auth/drive.readonly",
    "https://www.googleapis.com/auth/drive.file",
    "https://www.googleapis.com/auth/calendar.readonly",
    "https://www.googleapis.com/auth/calendar.events",
  ],
  drive: [
    "https://www.googleapis.com/auth/drive.readonly",
    "https://www.googleapis.com/auth/drive.file",
  ],
  calendar: [
    "https://www.googleapis.com/auth/calendar.readonly",
    "https://www.googleapis.com/auth/calendar.events",
  ],
  gmail: [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.send",
  ],
  gmail_send: ["https://www.googleapis.com/auth/gmail.send"],
  full: [
    "https://www.googleapis.com/auth/drive.readonly",
    "https://www.googleapis.com/auth/drive.file",
    "https://www.googleapis.com/auth/calendar.readonly",
    "https://www.googleapis.com/auth/calendar.events",
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.send",
  ],
};

function normalizeScopePreset(value: unknown): GoogleAccountScopePreset | null {
  const preset = String(value || "").trim().toLowerCase();
  return preset === "core" ||
    preset === "drive" ||
    preset === "calendar" ||
    preset === "gmail" ||
    preset === "gmail_send" ||
    preset === "full"
    ? preset
    : null;
}

function normalizedScopeSet(value: string | null | undefined): string[] {
  return [
    ...new Set(
      String(value || "")
        .split(/\s+/)
        .map((scope) => scope.trim())
        .filter(Boolean)
    ),
  ].sort();
}

function isBoundedScopeForPreset(
  preset: GoogleAccountScopePreset,
  value: string | null | undefined
): boolean {
  const granted = new Set(normalizedScopeSet(value));
  const requiredDataScopes = GOOGLE_DATA_SCOPES_BY_PRESET[preset];
  const hasEmailIdentity =
    granted.has("https://www.googleapis.com/auth/userinfo.email") ||
    (granted.has("openid") && granted.has("email"));
  if (!hasEmailIdentity || requiredDataScopes.some((scope) => !granted.has(scope))) {
    return false;
  }
  const allowed = new Set([
    ...requiredDataScopes,
    ...GOOGLE_IDENTITY_SCOPE_ALIASES,
  ]);
  return [...granted].every((scope) => allowed.has(scope));
}

function scopeSetsMatch(
  left: string | null | undefined,
  right: string | null | undefined
): boolean {
  const leftScopes = normalizedScopeSet(left);
  const rightScopes = normalizedScopeSet(right);
  return (
    leftScopes.length === rightScopes.length &&
    leftScopes.every((scope, index) => scope === rightScopes[index])
  );
}

function normalizedAccountSubject(value: string | null | undefined): string | null {
  const subject = String(value || "").trim();
  return subject && /^[A-Za-z0-9._~-]{1,255}$/.test(subject) ? subject : null;
}

function googleAccountIdForSubject(uid: string, subject: string): string {
  const digest = createHash("sha256")
    .update(`${uid.length}:${uid}:${subject.length}:${subject}`, "utf8")
    .digest("hex")
    .slice(0, 48);
  return `google-${digest}`;
}

function operationId(value: unknown): string | null {
  const normalized = String(value || "").trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    normalized
  )
    ? normalized
    : null;
}

function isSchemaV2Registry(value: Record<string, unknown>): boolean {
  return Number(value.schemaVersion) === 2;
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
    accountEmail:
      typeof parsed.accountEmail === "string" ? parsed.accountEmail : null,
    accountSubject:
      typeof parsed.accountSubject === "string" ? parsed.accountSubject : null,
    scopePreset: normalizeScopePreset(parsed.scopePreset),
  };
}

function serializeStoredTokens(tokens: StoredGoogleAccountTokens): string {
  return JSON.stringify({
    accessToken: tokens.accessToken || null,
    refreshToken: tokens.refreshToken || null,
    expiryDate: tokens.expiryDate || null,
    scope: tokens.scope || null,
    tokenType: tokens.tokenType || null,
    accountEmail: tokens.accountEmail || null,
    accountSubject: tokens.accountSubject || null,
    scopePreset: normalizeScopePreset(tokens.scopePreset),
  });
}

export async function resolveGoogleAccountTokens(
  uid: string,
  profileIdInput?: string | null
): Promise<GoogleAccountTokenResolution> {
  const requestedProfileId = normalizeProfileId(profileIdInput);
  const registryRef = getAdminDb().collection(TOKEN_COLLECTION).doc(uid);
  const registrySnap = await registryRef.get();
  if (!registrySnap.exists) {
    return { registryFound: false, profileMapped: false, record: null };
  }

  const registry = registrySnap.data() || {};
  if (!requestedProfileId && !isSchemaV2Registry(registry)) {
    return { registryFound: false, profileMapped: false, record: null };
  }
  const profileId =
    requestedProfileId || normalizeProfileId(registry.defaultProfileId);
  if (!profileId) {
    return { registryFound: true, profileMapped: false, record: null };
  }
  const bindingSnap = await registryRef
    .collection(PROFILE_BINDING_SUBCOLLECTION)
    .doc(profileId)
    .get();
  const accountId = bindingSnap.exists
    ? String(bindingSnap.data()?.accountId || "").trim()
    : "";
  if (!accountId) {
    return { registryFound: true, profileMapped: false, record: null };
  }

  const accountRef = registryRef.collection(ACCOUNT_SUBCOLLECTION).doc(accountId);
  const accountSnap = await accountRef.get();
  if (
    !accountSnap.exists ||
    accountSnap.data()?.pendingRevocation === true ||
    operationId(accountSnap.data()?.credentialWriteOperationId)
  ) {
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
    profileMapped: true,
    record: { accountId, profileId, tokens },
  };
}

export async function getGoogleDefaultProfileId(uid: string): Promise<string | null> {
  const snapshot = await getAdminDb().collection(TOKEN_COLLECTION).doc(uid).get();
  if (!snapshot.exists) return null;
  const data = snapshot.data() || {};
  return isSchemaV2Registry(data)
    ? normalizeProfileId(data.defaultProfileId)
    : null;
}

export async function getGoogleAccountRegistryMode(
  uid: string
): Promise<"missing" | "legacy" | "schema_v2"> {
  const snapshot = await getAdminDb().collection(TOKEN_COLLECTION).doc(uid).get();
  if (!snapshot.exists) return "missing";
  return isSchemaV2Registry(snapshot.data() || {}) ? "schema_v2" : "legacy";
}

export async function setGoogleDefaultProfileId(
  uid: string,
  profileIdInput: string
): Promise<string> {
  const profileId = normalizeProfileId(profileIdInput);
  if (!profileId) throw new Error("Google account profile id is required");
  const db = getAdminDb();
  const registryRef = db.collection(TOKEN_COLLECTION).doc(uid);
  const bindingRef = registryRef
    .collection(PROFILE_BINDING_SUBCOLLECTION)
    .doc(profileId);
  await db.runTransaction(async (transaction) => {
    const [registrySnapshot, bindingSnapshot] = await Promise.all([
      transaction.get(registryRef),
      transaction.get(bindingRef),
    ]);
    const registry = registrySnapshot.exists ? registrySnapshot.data() || {} : {};
    if (!isSchemaV2Registry(registry) || !bindingSnapshot.exists) {
      throw new Error("Google account profile is not connected");
    }
    const accountId = normalizeAccountId(bindingSnapshot.data()?.accountId);
    if (!accountId) throw new Error("Google account binding is invalid");
    const accountRef = registryRef.collection(ACCOUNT_SUBCOLLECTION).doc(accountId);
    const accountSnapshot = await transaction.get(accountRef);
    const account = accountSnapshot.exists ? accountSnapshot.data() || {} : {};
    if (
      !accountSnapshot.exists ||
      account.pendingRevocation === true ||
      operationId(account.credentialWriteOperationId)
    ) {
      throw new Error("Google account profile needs to be reconnected");
    }
    transaction.set(
      registryRef,
      {
        defaultProfileId: profileId,
        defaultAccountId: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  });
  return profileId;
}

export async function persistGoogleAccountTokens(
  uid: string,
  accountId: string,
  tokens: StoredGoogleAccountTokens
): Promise<void> {
  const db = getAdminDb();
  const accountRef = db
    .collection(TOKEN_COLLECTION)
    .doc(uid)
    .collection(ACCOUNT_SUBCOLLECTION)
    .doc(accountId);
  const credentialWriteOperationId = randomUUID();
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(accountRef);
    const data = snapshot.exists ? snapshot.data() || {} : {};
    if (
      !snapshot.exists ||
      data.pendingRevocation === true ||
      operationId(data.credentialWriteOperationId)
    ) {
      throw new Error("Google account credential update is not available");
    }
    transaction.set(
      accountRef,
      {
        credentialWriteOperationId,
        oauthHealthStatus: "refreshing",
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  });

  const refreshedAt = new Date().toISOString();
  try {
    await setUserSecret(uid, accountSecretKey(accountId), serializeStoredTokens(tokens));
  } catch (error) {
    await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(accountRef);
      if (
        operationId(snapshot.data()?.credentialWriteOperationId) ===
        credentialWriteOperationId
      ) {
        transaction.set(
          accountRef,
          {
            credentialWriteOperationId: null,
            oauthHealthStatus: "refresh_due",
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      }
    });
    throw error;
  }

  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(accountRef);
    const data = snapshot.exists ? snapshot.data() || {} : {};
    if (
      data.pendingRevocation === true ||
      operationId(data.credentialWriteOperationId) !== credentialWriteOperationId
    ) {
      throw new Error("Google account credential update lost its lock");
    }
    transaction.set(
      accountRef,
      {
        expiryDate: tokens.expiryDate || null,
        scope: tokens.scope || null,
        scopePreset: normalizeScopePreset(tokens.scopePreset),
        tokenType: tokens.tokenType || null,
        oauthHealthStatus: "healthy",
        lastRefreshStatus: "ok",
        lastCheckedAt: refreshedAt,
        lastRefreshAt: refreshedAt,
        lastRefreshErrorCode: null,
        lastRefreshErrorMessage: null,
        lastRefreshErrorAt: null,
        credentialWriteOperationId: null,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  });
}

/** Stores a completed, stable-subject-bound OAuth grant in schema v2. */
export async function persistGoogleAccountProfileTokens(
  uid: string,
  profileIdInput: string,
  tokens: StoredGoogleAccountTokens,
  scopePresetInput: GoogleAccountScopePreset
): Promise<PersistedGoogleAccountProfile> {
  const profileId = normalizeProfileId(profileIdInput);
  if (!profileId) throw new Error("Google account profile id is required");
  const scopePreset = normalizeScopePreset(scopePresetInput);
  if (!scopePreset || !isBoundedScopeForPreset(scopePreset, tokens.scope)) {
    throw new Error("Google account grant scope is invalid");
  }
  const incomingAccountEmail = normalizedAccountEmail(tokens.accountEmail);
  const incomingAccountSubject = normalizedAccountSubject(tokens.accountSubject);
  if (!incomingAccountEmail || !incomingAccountSubject) {
    throw new Error("Google account identity is required");
  }

  const db = getAdminDb();
  const registryRef = db.collection(TOKEN_COLLECTION).doc(uid);
  const bindingRef = registryRef
    .collection(PROFILE_BINDING_SUBCOLLECTION)
    .doc(profileId);
  const accountId = googleAccountIdForSubject(uid, incomingAccountSubject);
  const accountRef = registryRef.collection(ACCOUNT_SUBCOLLECTION).doc(accountId);
  const credentialWriteOperationId = randomUUID();

  const reservation = await db.runTransaction(async (transaction) => {
    const bindingSnapshot = await transaction.get(bindingRef);
    const existingAccountId = bindingSnapshot.exists
      ? normalizeAccountId(bindingSnapshot.data()?.accountId)
      : null;
    if (existingAccountId && existingAccountId !== accountId) {
      throw new GoogleAccountProfileReplacementRequiresDisconnectError();
    }
    const [accountSnapshot, destinationBindings] = await Promise.all([
      transaction.get(accountRef),
      transaction.get(
        registryRef
          .collection(PROFILE_BINDING_SUBCOLLECTION)
          .where("accountId", "==", accountId)
          .limit(3)
      ),
    ]);
    if (destinationBindings.docs.some((document) => document.id !== profileId)) {
      throw new GoogleAccountProfileConflictError();
    }
    const accountData = accountSnapshot.exists ? accountSnapshot.data() || {} : {};
    if (
      accountData.pendingRevocation === true ||
      operationId(accountData.credentialWriteOperationId)
    ) {
      throw new Error("Google account connection is already changing");
    }

    transaction.set(
      accountRef,
      {
        credentialWriteOperationId,
        oauthHealthStatus: "connecting",
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    transaction.set(
      bindingRef,
      {
        accountId,
        credentialWriteOperationId,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    return {
      bindingExisted: bindingSnapshot.exists,
      existingAccountId,
      destinationAccountExisted: accountSnapshot.exists,
    };
  });

  const abortReservation = async () => {
    await db.runTransaction(async (transaction) => {
      const bindingSnapshot = await transaction.get(bindingRef);
      const destinationSnapshot = await transaction.get(accountRef);
      if (
        operationId(bindingSnapshot.data()?.credentialWriteOperationId) ===
        credentialWriteOperationId
      ) {
        if (reservation.bindingExisted && reservation.existingAccountId) {
          transaction.set(
            bindingRef,
            {
              accountId: reservation.existingAccountId,
              credentialWriteOperationId: null,
              updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true }
          );
        } else {
          transaction.delete(bindingRef);
        }
      }
      if (
        operationId(destinationSnapshot.data()?.credentialWriteOperationId) ===
        credentialWriteOperationId
      ) {
        if (reservation.destinationAccountExisted) {
          transaction.set(
            accountRef,
            {
              credentialWriteOperationId: null,
              updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true }
          );
        } else {
          transaction.delete(accountRef);
        }
      }
    });
  };

  let existingTokens: StoredGoogleAccountTokens | null = null;
  try {
    existingTokens =
      reservation.existingAccountId || reservation.destinationAccountExisted
      ? parseStoredTokens(await accessUserSecret(uid, accountSecretKey(accountId)))
      : null;
  } catch (error) {
    await abortReservation();
    throw error;
  }
  const sameSubjectExisting =
    normalizedAccountSubject(existingTokens?.accountSubject) === incomingAccountSubject
      ? existingTokens
      : null;
  const mayReuseRefreshToken = Boolean(
    sameSubjectExisting?.refreshToken &&
      normalizeScopePreset(sameSubjectExisting.scopePreset) === scopePreset &&
      isBoundedScopeForPreset(scopePreset, sameSubjectExisting.scope) &&
      scopeSetsMatch(sameSubjectExisting.scope, tokens.scope)
  );

  const mergedTokens: StoredGoogleAccountTokens = {
    accessToken:
      tokens.accessToken ??
      sameSubjectExisting?.accessToken ??
      null,
    refreshToken:
      tokens.refreshToken ??
      (mayReuseRefreshToken ? sameSubjectExisting?.refreshToken : null) ??
      null,
    expiryDate:
      tokens.expiryDate ??
      sameSubjectExisting?.expiryDate ??
      null,
    scope: tokens.scope ?? null,
    tokenType:
      tokens.tokenType ??
      sameSubjectExisting?.tokenType ??
      null,
    accountEmail: incomingAccountEmail,
    accountSubject: incomingAccountSubject,
    scopePreset,
  };
  if (!mergedTokens.refreshToken) {
    await abortReservation();
    throw new Error("Missing refresh token from Google");
  }

  const refreshedAt = new Date().toISOString();
  try {
    await setUserSecret(
      uid,
      accountSecretKey(accountId),
      serializeStoredTokens(mergedTokens)
    );
  } catch (error) {
    await abortReservation();
    throw error;
  }

  await db.runTransaction(async (transaction) => {
    const [bindingSnapshot, accountSnapshot] = await Promise.all([
      transaction.get(bindingRef),
      transaction.get(accountRef),
    ]);
    if (
      !bindingSnapshot.exists ||
      bindingSnapshot.data()?.accountId !== accountId ||
      operationId(bindingSnapshot.data()?.credentialWriteOperationId) !==
        credentialWriteOperationId ||
      !accountSnapshot.exists ||
      accountSnapshot.data()?.pendingRevocation === true ||
      operationId(accountSnapshot.data()?.credentialWriteOperationId) !==
        credentialWriteOperationId
    ) {
      throw new Error("Google account connection lost its lock");
    }

    transaction.set(
      registryRef,
      {
        schemaVersion: 2,
        defaultAccountId: FieldValue.delete(),
        accessToken: FieldValue.delete(),
        refreshToken: FieldValue.delete(),
        expiryDate: FieldValue.delete(),
        scope: FieldValue.delete(),
        scopePreset: FieldValue.delete(),
        tokenType: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    transaction.set(
      bindingRef,
      {
        accountId,
        credentialWriteOperationId: null,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    transaction.set(
      accountRef,
      {
        expiryDate: mergedTokens.expiryDate || null,
        scope: mergedTokens.scope || null,
        scopePreset,
        tokenType: mergedTokens.tokenType || null,
        oauthHealthStatus: "healthy",
        lastRefreshStatus: "ok",
        lastCheckedAt: refreshedAt,
        lastRefreshAt: refreshedAt,
        lastRefreshErrorCode: null,
        lastRefreshErrorMessage: null,
        lastRefreshErrorAt: null,
        pendingRevocation: false,
        pendingRevocationOperationId: null,
        credentialWriteOperationId: null,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  });

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

export async function beginGoogleAccountProfileDisconnect(
  uid: string,
  profileIdInput: string
): Promise<GoogleAccountProfileDisconnect> {
  const profileId = normalizeProfileId(profileIdInput);
  if (!profileId) throw new Error("Google account profile id is required");

  const db = getAdminDb();
  const registryRef = db.collection(TOKEN_COLLECTION).doc(uid);
  const bindingRef = registryRef
    .collection(PROFILE_BINDING_SUBCOLLECTION)
    .doc(profileId);
  const newOperationId = randomUUID();

  const result = await db.runTransaction(async (transaction) => {
    const [registrySnapshot, bindingSnapshot] = await Promise.all([
      transaction.get(registryRef),
      transaction.get(bindingRef),
    ]);
    if (!bindingSnapshot.exists) {
      return {
        accountId: null,
        operationId: null,
        localCredentialDeletionRequired: false,
      };
    }
    const accountId = normalizeAccountId(bindingSnapshot.data()?.accountId);
    if (!accountId) throw new Error("Google account binding is invalid");

    const accountRef = registryRef
      .collection(ACCOUNT_SUBCOLLECTION)
      .doc(accountId);
    const sharedBindingsQuery = registryRef
      .collection(PROFILE_BINDING_SUBCOLLECTION)
      .where("accountId", "==", accountId)
      .limit(3);
    const [accountSnapshot, sharedBindingsSnapshot] = await Promise.all([
      transaction.get(accountRef),
      transaction.get(sharedBindingsQuery),
    ]);
    const account = accountSnapshot.exists ? accountSnapshot.data() || {} : {};
    if (!accountSnapshot.exists) {
      throw new Error("Google account binding is unavailable");
    }
    if (operationId(account.credentialWriteOperationId)) {
      throw new Error("Google account connection is already changing");
    }
    const otherBindingExists = sharedBindingsSnapshot.docs.some(
      (document) => document.id !== profileId
    );
    if (otherBindingExists) {
      transaction.delete(bindingRef);
      if (registrySnapshot.data()?.defaultProfileId === profileId) {
        transaction.set(
          registryRef,
          {
            defaultProfileId: FieldValue.delete(),
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      }
      return {
        accountId,
        operationId: null,
        localCredentialDeletionRequired: false,
      };
    }

    const existingOperationId = operationId(account.pendingRevocationOperationId);
    if (account.pendingRevocation === true && !existingOperationId) {
      throw new Error("Google account disconnect state is invalid");
    }
    const pendingOperationId = existingOperationId || newOperationId;
    transaction.set(
      accountRef,
      {
        pendingRevocation: true,
        pendingRevocationOperationId: pendingOperationId,
        oauthHealthStatus: "disconnecting",
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    return {
      accountId,
      operationId: pendingOperationId,
      localCredentialDeletionRequired: true,
    };
  });
  return { profileId, ...result };
}

export async function finishGoogleAccountProfileDisconnect(
  uid: string,
  profileIdInput: string,
  accountIdInput: string,
  operationIdInput: string
): Promise<void> {
  const profileId = normalizeProfileId(profileIdInput);
  const accountId = normalizeAccountId(accountIdInput);
  const expectedOperationId = operationId(operationIdInput);
  if (!profileId || !accountId || !expectedOperationId) {
    throw new Error("Invalid Google disconnect binding");
  }
  const db = getAdminDb();
  const registryRef = db.collection(TOKEN_COLLECTION).doc(uid);
  const bindingRef = registryRef
    .collection(PROFILE_BINDING_SUBCOLLECTION)
    .doc(profileId);
  const accountRef = registryRef.collection(ACCOUNT_SUBCOLLECTION).doc(accountId);

  const assertOperation = async () =>
    db.runTransaction(async (transaction) => {
      const [bindingSnapshot, accountSnapshot, sharedBindingsSnapshot] =
        await Promise.all([
          transaction.get(bindingRef),
          transaction.get(accountRef),
          transaction.get(
            registryRef
              .collection(PROFILE_BINDING_SUBCOLLECTION)
              .where("accountId", "==", accountId)
              .limit(3)
          ),
        ]);
      if (
        !bindingSnapshot.exists ||
        normalizeAccountId(bindingSnapshot.data()?.accountId) !== accountId ||
        !accountSnapshot.exists ||
        accountSnapshot.data()?.pendingRevocation !== true ||
        operationId(accountSnapshot.data()?.pendingRevocationOperationId) !==
          expectedOperationId ||
        operationId(accountSnapshot.data()?.credentialWriteOperationId) ||
        sharedBindingsSnapshot.docs.some((document) => document.id !== profileId)
      ) {
        throw new Error("Google disconnect operation changed");
      }
    });

  await assertOperation();
  await deleteUserSecret(uid, accountSecretKey(accountId));

  await db.runTransaction(async (transaction) => {
    const [registrySnapshot, bindingSnapshot, accountSnapshot] = await Promise.all([
      transaction.get(registryRef),
      transaction.get(bindingRef),
      transaction.get(accountRef),
    ]);
    if (
      !bindingSnapshot.exists ||
      normalizeAccountId(bindingSnapshot.data()?.accountId) !== accountId ||
      !accountSnapshot.exists ||
      accountSnapshot.data()?.pendingRevocation !== true ||
      operationId(accountSnapshot.data()?.pendingRevocationOperationId) !==
        expectedOperationId ||
      operationId(accountSnapshot.data()?.credentialWriteOperationId)
    ) {
      throw new Error("Google disconnect operation changed");
    }
    transaction.delete(bindingRef);
    transaction.delete(accountRef);
    if (registrySnapshot.data()?.defaultProfileId === profileId) {
      transaction.set(
        registryRef,
        {
          defaultProfileId: FieldValue.delete(),
          defaultAccountId: FieldValue.delete(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    }
  });
}
