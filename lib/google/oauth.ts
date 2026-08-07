import "server-only";

import { google } from "googleapis";
import { ApiError } from "@/lib/api/handler";
import { getAdminDb } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import type { Logger } from "@/lib/logging";
import {
  persistGoogleAccountProfileTokens,
  persistGoogleAccountTokenFailure,
  persistGoogleAccountTokens,
  resolveGoogleAccountTokens,
  type StoredGoogleAccountTokens,
} from "@/lib/google/account-token-store";

const TOKEN_COLLECTION = "google_oauth_tokens";
const ACCESS_TOKEN_REUSE_WINDOW_MS = 60_000;

export interface GoogleAccessTokenOptions {
  profileId?: string | null;
}

function describeAccountTokenResolutionError(error: unknown): {
  errorCategory: "credential_vault_unavailable";
  grpcStatus: number | null;
} {
  const meta =
    typeof error === "object" && error !== null
      ? (error as Record<string, unknown>)
      : {};
  const rawCode = meta.code;

  return {
    errorCategory: "credential_vault_unavailable",
    grpcStatus:
      typeof rawCode === "number" && Number.isInteger(rawCode)
        ? rawCode
        : null,
  };
}

function parseGoogleRefreshFailure(error: unknown): {
  code: string;
  reauthRequired: boolean;
} {
  const meta =
    typeof error === "object" && error !== null
      ? (error as Record<string, unknown>)
      : {};
  const response =
    typeof meta.response === "object" && meta.response !== null
      ? (meta.response as Record<string, unknown>)
      : {};
  const responseData =
    typeof response.data === "object" && response.data !== null
      ? (response.data as Record<string, unknown>)
      : {};
  const rawCode = String(
    responseData.error || meta.code || meta.status || "refresh_failed"
  )
    .trim()
    .toLowerCase();
  const code = rawCode.replace(/[^a-z0-9_-]/g, "_").slice(0, 64) || "refresh_failed";
  const numericStatus = Number(response.status || meta.status || meta.code);
  const reauthRequired =
    ["invalid_grant", "invalid_client", "unauthorized_client", "access_denied"].includes(code) ||
    numericStatus === 401 ||
    numericStatus === 403;

  return { code, reauthRequired };
}

export const GOOGLE_OAUTH_SCOPES = [
  // Default = full access preset. Prefer using a preset via getGoogleAuthUrl(..., { scopePreset }).
  // Note: keep scopes minimal to reduce verification friction.
  // FreeBusy + list needs calendar.readonly; create/update needs calendar.events.
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
];

export type GoogleScopePreset = "core" | "drive" | "calendar" | "gmail" | "full";

const GOOGLE_SCOPE_GROUPS = {
  identity: [
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile",
  ],
  drive: ["https://www.googleapis.com/auth/drive.readonly", "https://www.googleapis.com/auth/drive.file"],
  calendar: [
    "https://www.googleapis.com/auth/calendar.readonly",
    "https://www.googleapis.com/auth/calendar.events",
  ],
  gmail: ["https://www.googleapis.com/auth/gmail.readonly", "https://www.googleapis.com/auth/gmail.send"],
} as const;

function getMissionControlPublicOrigin(): string | null {
  const raw = process.env.MISSION_CONTROL_PUBLIC_ORIGIN?.trim();
  if (!raw) {
    return null;
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ApiError(500, "Invalid MISSION_CONTROL_PUBLIC_ORIGIN");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ApiError(500, "MISSION_CONTROL_PUBLIC_ORIGIN must use http or https");
  }

  if (url.hostname === "0.0.0.0" || url.hostname === "::") {
    throw new ApiError(500, "MISSION_CONTROL_PUBLIC_ORIGIN must not use bind-all addresses");
  }

  return url.origin;
}

function uniqueScopes(values: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const scope of values) {
    if (seen.has(scope)) continue;
    seen.add(scope);
    out.push(scope);
  }
  return out;
}

export function scopesForPreset(preset: GoogleScopePreset): string[] {
  if (preset === "drive") {
    return uniqueScopes([...GOOGLE_SCOPE_GROUPS.identity, ...GOOGLE_SCOPE_GROUPS.drive]);
  }
  if (preset === "calendar") {
    return uniqueScopes([...GOOGLE_SCOPE_GROUPS.identity, ...GOOGLE_SCOPE_GROUPS.calendar]);
  }
  if (preset === "gmail") {
    return uniqueScopes([...GOOGLE_SCOPE_GROUPS.identity, ...GOOGLE_SCOPE_GROUPS.gmail]);
  }
  if (preset === "core") {
    return uniqueScopes([
      ...GOOGLE_SCOPE_GROUPS.identity,
      ...GOOGLE_SCOPE_GROUPS.drive,
      ...GOOGLE_SCOPE_GROUPS.calendar,
    ]);
  }

  // "full"
  return uniqueScopes([
    ...GOOGLE_SCOPE_GROUPS.identity,
    ...GOOGLE_SCOPE_GROUPS.drive,
    ...GOOGLE_SCOPE_GROUPS.calendar,
    ...GOOGLE_SCOPE_GROUPS.gmail,
  ]);
}

function getOAuthConfig() {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    throw new ApiError(500, "Missing Google OAuth configuration");
  }

  let redirectUrl: URL;
  try {
    redirectUrl = new URL(redirectUri);
  } catch {
    throw new ApiError(500, "Invalid GOOGLE_OAUTH_REDIRECT_URI");
  }

  if (redirectUrl.protocol !== "http:" && redirectUrl.protocol !== "https:") {
    throw new ApiError(500, "GOOGLE_OAUTH_REDIRECT_URI must use http or https");
  }

  // 0.0.0.0 / :: are bind-all addresses, not valid browser origins for OAuth redirects.
  if (redirectUrl.hostname === "0.0.0.0" || redirectUrl.hostname === "::") {
    throw new ApiError(
      500,
      "Invalid GOOGLE_OAUTH_REDIRECT_URI (do not use 0.0.0.0/::). Use localhost or your public domain."
    );
  }

  if (!redirectUrl.pathname.endsWith("/api/google/callback")) {
    throw new ApiError(500, "GOOGLE_OAUTH_REDIRECT_URI must end with /api/google/callback");
  }

  const publicOrigin = getMissionControlPublicOrigin();
  if (publicOrigin && redirectUrl.origin !== publicOrigin) {
    throw new ApiError(
      500,
      `GOOGLE_OAUTH_REDIRECT_URI must match MISSION_CONTROL_PUBLIC_ORIGIN (${publicOrigin})`
    );
  }

  return { clientId, clientSecret, redirectUri: redirectUrl.toString() };
}

export function getOAuthClient() {
  const { clientId, clientSecret, redirectUri } = getOAuthConfig();
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

export function getGoogleAuthUrl(state: string, options?: { scopePreset?: GoogleScopePreset }) {
  const client = getOAuthClient();
  const preset = options?.scopePreset ?? "full";
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: true,
    scope: scopesForPreset(preset),
    state,
  });
}

export async function storeGoogleTokens(
  uid: string,
  tokens: {
    access_token?: string | null;
    refresh_token?: string | null;
    expiry_date?: number | null;
    scope?: string | null;
    token_type?: string | null;
  },
  log?: Logger
) {
  const tokenDoc = getAdminDb().collection(TOKEN_COLLECTION).doc(uid);
  const existing = await tokenDoc.get();
  const existingData = existing.exists ? existing.data() : {};

  const refreshToken =
    tokens.refresh_token || (existingData?.refreshToken as string | undefined);

  if (!refreshToken) {
    throw new ApiError(500, "Missing refresh token from Google");
  }

  await tokenDoc.set(
    {
      accessToken: tokens.access_token || existingData?.accessToken || null,
      refreshToken,
      expiryDate: tokens.expiry_date || existingData?.expiryDate || null,
      scope: tokens.scope || existingData?.scope || null,
      tokenType: tokens.token_type || existingData?.tokenType || null,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  log?.info("oauth.tokens.saved", { uid });
}

export async function storeGoogleProfileTokens(
  uid: string,
  profileId: string,
  tokens: {
    access_token?: string | null;
    refresh_token?: string | null;
    expiry_date?: number | null;
    scope?: string | null;
    token_type?: string | null;
  },
  log?: Logger
) {
  try {
    const persisted = await persistGoogleAccountProfileTokens(uid, profileId, {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiryDate: tokens.expiry_date,
      scope: tokens.scope,
      tokenType: tokens.token_type,
    });
    log?.info("oauth.profile_tokens.saved", {
      uid,
      profileId: persisted.profileId,
      accountId: persisted.accountId,
      storageMode: "account_secret",
    });
    return persisted;
  } catch (error) {
    if (error instanceof Error && error.message === "Missing refresh token from Google") {
      throw new ApiError(500, error.message);
    }
    throw error;
  }
}

export function resolveMissionControlOrigin(
  stateOrigin: string | undefined,
  requestOrigin: string
): { origin: string; redirected: boolean } {
  const forcedOrigin = getMissionControlPublicOrigin();
  if (forcedOrigin) {
    return { origin: forcedOrigin, redirected: forcedOrigin !== requestOrigin };
  }

  const candidate = stateOrigin || requestOrigin;
  try {
    const url = new URL(candidate);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return { origin: requestOrigin, redirected: true };
    }
    if (url.hostname === "0.0.0.0" || url.hostname === "::") {
      return { origin: requestOrigin, redirected: true };
    }

    const req = new URL(requestOrigin);
    if (url.origin === req.origin) {
      return { origin: url.origin, redirected: false };
    }

    if (url.hostname === "localhost" || url.hostname === "127.0.0.1") {
      return { origin: url.origin, redirected: true };
    }

    const allowlist = (process.env.MISSION_CONTROL_ALLOWED_ORIGINS || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);

    if (allowlist.includes(url.origin)) {
      return { origin: url.origin, redirected: true };
    }

    return { origin: requestOrigin, redirected: true };
  } catch {
    return { origin: requestOrigin, redirected: true };
  }
}

export async function getStoredGoogleTokens(uid: string) {
  const tokenDoc = await getAdminDb().collection(TOKEN_COLLECTION).doc(uid).get();
  if (!tokenDoc.exists) {
    return null;
  }
  return tokenDoc.data() as {
    accessToken?: string | null;
    refreshToken?: string | null;
    expiryDate?: number | null;
    scope?: string | null;
    tokenType?: string | null;
  };
}

export async function getAccessTokenForUser(
  uid: string,
  log?: Logger,
  options?: GoogleAccessTokenOptions
) {
  const profileId = String(options?.profileId || "").trim().toLowerCase() || null;
  log?.info("oauth.getAccessToken.start", { uid, profileId });

  let accountResolution: Awaited<
    ReturnType<typeof resolveGoogleAccountTokens>
  >;
  if (profileId) {
    try {
      accountResolution = await resolveGoogleAccountTokens(uid, profileId);
    } catch (error) {
      log?.error("oauth.account_token_resolution_failed", {
        uid,
        profileId,
        ...describeAccountTokenResolutionError(error),
      });
      throw new ApiError(503, "Google account credential vault is unavailable");
    }
  } else {
    accountResolution = {
      registryFound: false,
      profileMapped: false,
      record: null,
    };
  }
  if (profileId && !accountResolution.profileMapped) {
    throw new ApiError(409, `Google account profile '${profileId}' is not connected`);
  }
  if (profileId && accountResolution.profileMapped && !accountResolution.record) {
    throw new ApiError(403, `Google account profile '${profileId}' needs to be reconnected`);
  }

  const accountRecord = accountResolution.record;
  const tokens: StoredGoogleAccountTokens | null =
    profileId
      ? accountRecord?.tokens || null
      : await getStoredGoogleTokens(uid);
  if (!tokens?.refreshToken) {
    if (accountRecord) {
      try {
        await persistGoogleAccountTokenFailure(uid, accountRecord.accountId, {
          reauthRequired: true,
          code: "missing_refresh_token",
        });
      } catch (healthError) {
        log?.warn("oauth.account_health_update_failed", {
          uid,
          profileId,
          accountId: accountRecord.accountId,
          reason: "missing_refresh_token",
          error: healthError instanceof Error ? healthError.message : String(healthError),
        });
      }
    }
    log?.warn("oauth.no_tokens", {
      uid,
      profileId,
      hasTokens: !!tokens,
      storageMode: accountRecord ? "account_secret" : "legacy",
    });
    const error = new ApiError(403, "Google account not connected");
    log?.warn("oauth.throwing_403", {
      uid,
      isApiError: error instanceof ApiError,
      errorStatus: error.status,
      errorMessage: error.message
    });
    throw error;
  }

  log?.info("oauth.tokens_found", {
    uid,
    profileId,
    accountId: accountRecord?.accountId || null,
    storageMode: accountRecord ? "account_secret" : "legacy",
  });

  if (
    tokens.accessToken &&
    typeof tokens.expiryDate === "number" &&
    tokens.expiryDate > Date.now() + ACCESS_TOKEN_REUSE_WINDOW_MS
  ) {
    log?.info("oauth.using_stored_access_token", {
      uid,
      profileId,
      accountId: accountRecord?.accountId || null,
      expiryDate: tokens.expiryDate,
    });
    return tokens.accessToken;
  }

  try {
    const client = getOAuthClient();
    client.setCredentials({
      refresh_token: tokens.refreshToken,
      access_token: tokens.accessToken || undefined,
      expiry_date: tokens.expiryDate || undefined,
    });

    log?.info("oauth.refreshing_token", { uid });
    const accessTokenResponse = await client.getAccessToken();
    const accessToken = accessTokenResponse?.token;

    if (!accessToken) {
      log?.error("oauth.no_access_token", { uid, response: accessTokenResponse });
      throw new ApiError(500, "Failed to refresh Google access token");
    }

    const updatedTokens = client.credentials;
    if (accountRecord) {
      await persistGoogleAccountTokens(uid, accountRecord.accountId, {
        accessToken: updatedTokens.access_token || accessToken,
        refreshToken: updatedTokens.refresh_token || tokens.refreshToken,
        expiryDate: updatedTokens.expiry_date || tokens.expiryDate || null,
        scope: updatedTokens.scope || tokens.scope || null,
        tokenType: updatedTokens.token_type || tokens.tokenType || null,
      });
    } else {
      await storeGoogleTokens(
        uid,
        {
          access_token: updatedTokens.access_token,
          refresh_token: updatedTokens.refresh_token,
          expiry_date: updatedTokens.expiry_date,
          scope: updatedTokens.scope,
          token_type: updatedTokens.token_type,
        },
        log
      );
    }

    log?.info("google.oauth.access_token", {
      uid,
      profileId,
      accountId: accountRecord?.accountId || null,
      storageMode: accountRecord ? "account_secret" : "legacy",
    });
    return accessToken;
  } catch (error: unknown) {
    const failure = parseGoogleRefreshFailure(error);
    if (accountRecord) {
      try {
        await persistGoogleAccountTokenFailure(uid, accountRecord.accountId, failure);
      } catch (healthError) {
        log?.warn("oauth.account_health_update_failed", {
          uid,
          profileId,
          accountId: accountRecord.accountId,
          reason: failure.code,
          error: healthError instanceof Error ? healthError.message : String(healthError),
        });
      }
    }

    log?.error("oauth.refresh_failed", {
      uid,
      profileId,
      accountId: accountRecord?.accountId || null,
      errorCode: failure.code,
      reauthRequired: failure.reauthRequired,
    });

    // If it's already an ApiError, rethrow it
    if (error instanceof ApiError) {
      throw error;
    }

    // Otherwise wrap it
    throw new ApiError(
      failure.reauthRequired ? 403 : 500,
      failure.reauthRequired
        ? "Google account needs to be reconnected."
        : "Failed to refresh Google access token."
    );
  }
}

export async function revokeGoogleTokens(uid: string, log?: Logger) {
  const tokens = await getStoredGoogleTokens(uid);
  if (!tokens?.refreshToken && !tokens?.accessToken) {
    return;
  }

  const client = getOAuthClient();
  client.setCredentials({
    refresh_token: tokens.refreshToken || undefined,
    access_token: tokens.accessToken || undefined,
  });

  try {
    await client.revokeCredentials();
  } catch (_error) {
    log?.warn("google.oauth.revoke_failed");
  }

  await getAdminDb().collection(TOKEN_COLLECTION).doc(uid).delete();
  log?.info("google.oauth.revoked", { uid });
}
