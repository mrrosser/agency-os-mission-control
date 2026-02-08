import "server-only";

import { google } from "googleapis";
import { ApiError } from "@/lib/api/handler";
import { getAdminDb } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import type { Logger } from "@/lib/logging";

const TOKEN_COLLECTION = "google_oauth_tokens";

export const GOOGLE_OAUTH_SCOPES = [
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/contacts.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
];

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

  return { clientId, clientSecret, redirectUri: redirectUrl.toString() };
}

export function getOAuthClient() {
  const { clientId, clientSecret, redirectUri } = getOAuthConfig();
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

export function getGoogleAuthUrl(state: string) {
  const client = getOAuthClient();
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: GOOGLE_OAUTH_SCOPES,
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

  log?.info("google.oauth.tokens_saved", { uid });
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

export async function getAccessTokenForUser(uid: string, log?: Logger) {
  log?.info("oauth.getAccessToken.start", { uid });

  const tokens = await getStoredGoogleTokens(uid);
  if (!tokens?.refreshToken) {
    log?.warn("oauth.no_tokens", { uid, hasTokens: !!tokens });
    const error = new ApiError(403, "Google account not connected");
    log?.warn("oauth.throwing_403", {
      uid,
      isApiError: error instanceof ApiError,
      errorStatus: error.status,
      errorMessage: error.message
    });
    throw error;
  }

  log?.info("oauth.tokens_found", { uid });

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

    log?.info("google.oauth.access_token", { uid });
    return accessToken;
  } catch (error: any) {
    log?.error("oauth.refresh_failed", {
      uid,
      errorMessage: error.message,
      errorCode: error.code,
      errorStatus: error.status
    });

    // If it's already an ApiError, rethrow it
    if (error instanceof ApiError) {
      throw error;
    }

    // Otherwise wrap it
    throw new ApiError(500, `Failed to refresh access token: ${error.message}`);
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
  } catch (error) {
    log?.warn("google.oauth.revoke_failed");
  }

  await getAdminDb().collection(TOKEN_COLLECTION).doc(uid).delete();
  log?.info("google.oauth.revoked", { uid });
}
