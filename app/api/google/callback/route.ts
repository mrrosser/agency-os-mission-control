import { NextRequest, NextResponse } from "next/server";
import type { Credentials } from "google-auth-library";
import { Timestamp } from "firebase-admin/firestore";
import { z } from "zod";
import { ApiError, withApiHandler } from "@/lib/api/handler";
import { getAdminDb } from "@/lib/firebase-admin";
import {
  GoogleBusinessProfileContextError,
  resolveGoogleBusinessProfileContext,
  type GoogleBusinessProfile,
} from "@/lib/google/business-profiles";
import {
  assertGoogleTokenScopeForPreset,
  fetchGoogleAccountIdentity,
  getOAuthClient,
  resolveMissionControlOrigin,
  storeGoogleProfileTokens,
  type GoogleScopePreset,
} from "@/lib/google/oauth";
import {
  clearGoogleOAuthPkceCookie,
  GOOGLE_OAUTH_ATTEMPT_COLLECTION,
  GOOGLE_OAUTH_PROCESSING_MAX_AGE_SECONDS,
  GOOGLE_OAUTH_STATE_COLLECTION,
  GOOGLE_OAUTH_STATE_MAX_AGE_SECONDS,
  googleOAuthAttemptDocumentId,
  isGoogleOAuthStateIdentifier,
  readGoogleOAuthPkceCookie,
  verifyGoogleOAuthPkceBinding,
} from "@/lib/google/oauth-state";
import {
  GoogleAccountProfileConflictError,
  GoogleAccountProfileReplacementRequiresDisconnectError,
} from "@/lib/google/account-token-store";

const contextIdSchema = z.string().trim().min(1).max(64);
const oauthStateSchema = z
  .object({
    uid: z.string().trim().min(1).max(128),
    returnTo: z.string().max(500).optional(),
    origin: z.string().max(500),
    correlationId: z.string().trim().min(1).max(128).optional(),
    workspaceId: z.string().trim().min(1).max(128).nullable().optional(),
    businessId: contextIdSchema,
    profileId: contextIdSchema,
    scopePreset: z
      .enum(["core", "drive", "calendar", "gmail", "gmail_send", "full"]),
    codeChallenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    attemptDocumentId: z.string().regex(/^[a-f0-9]{64}$/),
    createdAt: z.unknown(),
    expiresAt: z.unknown().optional(),
  })
  .strict();

type OAuthStateData = z.infer<typeof oauthStateSchema>;

type OAuthResultCode =
  | "access_denied"
  | "temporarily_unavailable"
  | "provider_error"
  | "connection_session_invalid"
  | "connection_superseded"
  | "token_exchange_failed"
  | "scope_not_allowed"
  | "account_identity_failed"
  | "account_already_connected"
  | "profile_replacement_requires_disconnect"
  | "credential_storage_failed"
  | "configuration_error";

function timestampMs(value: unknown): number | null {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (typeof value === "object" && value !== null) {
    const candidate = value as {
      toMillis?: () => number;
      toDate?: () => Date;
      seconds?: number;
      _seconds?: number;
    };
    try {
      if (typeof candidate.toMillis === "function") return candidate.toMillis();
      if (typeof candidate.toDate === "function") return candidate.toDate().getTime();
    } catch {
      return null;
    }
    const seconds = Number(candidate.seconds ?? candidate._seconds);
    return Number.isFinite(seconds) ? seconds * 1_000 : null;
  }
  return null;
}

function assertFreshOAuthState(data: OAuthStateData, nowMs = Date.now()): void {
  const createdAtMs = timestampMs(data.createdAt);
  const expiresAtMs = timestampMs(data.expiresAt);
  const maximumAgeMs = GOOGLE_OAUTH_STATE_MAX_AGE_SECONDS * 1_000;
  if (
    createdAtMs === null ||
    createdAtMs > nowMs + 60_000 ||
    nowMs - createdAtMs > maximumAgeMs ||
    (expiresAtMs !== null && (expiresAtMs < nowMs || expiresAtMs > createdAtMs + maximumAgeMs + 60_000))
  ) {
    throw new ApiError(400, "Expired OAuth state");
  }
}

function parseOAuthState(value: unknown): {
  stateData: OAuthStateData;
  profileContext: GoogleBusinessProfile;
} {
  const parsed = oauthStateSchema.safeParse(value);
  if (!parsed.success) throw new ApiError(400, "Invalid OAuth state");
  assertFreshOAuthState(parsed.data);

  let profileContext: GoogleBusinessProfile | null;
  try {
    profileContext = resolveGoogleBusinessProfileContext({
      businessId: parsed.data.businessId,
      profileId: parsed.data.profileId,
    });
  } catch (error) {
    if (error instanceof GoogleBusinessProfileContextError) {
      throw new ApiError(400, "Invalid OAuth profile context");
    }
    throw error;
  }
  if (!profileContext) throw new ApiError(400, "Invalid OAuth profile context");

  const expectedAttemptDocumentId = googleOAuthAttemptDocumentId(
    parsed.data.uid,
    profileContext.profileId
  );
  if (parsed.data.attemptDocumentId !== expectedAttemptDocumentId) {
    throw new ApiError(400, "Invalid OAuth attempt binding");
  }
  return { stateData: parsed.data, profileContext };
}

function sanitizeReturnTo(returnTo: string | undefined, origin: string): URL {
  if (
    returnTo?.startsWith("/") &&
    !returnTo.startsWith("//") &&
    !returnTo.includes("\\")
  ) {
    const candidate = new URL(returnTo, origin);
    if (candidate.origin === new URL(origin).origin) return candidate;
  }
  return new URL("/dashboard/integrations", origin);
}

function providerErrorCode(error: string | null): OAuthResultCode {
  if (error === "access_denied") return "access_denied";
  if (error === "temporarily_unavailable") return "temporarily_unavailable";
  return "provider_error";
}

function resultResponse(input: {
  request: NextRequest;
  state: string | null;
  stateData?: OAuthStateData;
  profileContext?: GoogleBusinessProfile;
  connected?: boolean;
  errorCode?: OAuthResultCode;
}): NextResponse {
  let origin: string;
  try {
    origin = resolveMissionControlOrigin(
      input.stateData?.origin,
      input.request.nextUrl.origin
    ).origin;
  } catch (error) {
    origin = "https://leadflow-review.web.app";
  }
  const redirectUrl = sanitizeReturnTo(input.stateData?.returnTo, origin);
  redirectUrl.searchParams.set("google", input.connected ? "connected" : "error");
  if (input.connected && input.profileContext) {
    redirectUrl.searchParams.set("googleBusiness", input.profileContext.businessId);
    redirectUrl.searchParams.set("googleProfile", input.profileContext.profileId);
  } else {
    redirectUrl.searchParams.set("googleError", input.errorCode || "provider_error");
  }
  if (input.stateData?.correlationId) {
    redirectUrl.searchParams.set("googleCorrelation", input.stateData.correlationId);
  }

  const response = NextResponse.redirect(redirectUrl, { status: 303 });
  clearGoogleOAuthPkceCookie(response, input.state);
  response.headers.set("cache-control", "private, no-store, max-age=0");
  response.headers.set("pragma", "no-cache");
  response.headers.set("referrer-policy", "no-referrer");
  return response;
}

async function consumeBrowserBoundOAuthState(
  request: NextRequest,
  state: string
): Promise<{
  stateData: OAuthStateData;
  profileContext: GoogleBusinessProfile;
}> {
  const verifier = readGoogleOAuthPkceCookie(request, state);
  const db = getAdminDb();
  const stateRef = db.collection(GOOGLE_OAUTH_STATE_COLLECTION).doc(state);

  return db.runTransaction(async (transaction) => {
    const stateSnapshot = await transaction.get(stateRef);
    if (!stateSnapshot.exists) throw new ApiError(400, "Invalid OAuth state");
    const parsed = parseOAuthState(stateSnapshot.data());
    if (!verifyGoogleOAuthPkceBinding(verifier, parsed.stateData.codeChallenge)) {
      throw new ApiError(400, "OAuth browser session does not match");
    }

    const attemptRef = db
      .collection(GOOGLE_OAUTH_ATTEMPT_COLLECTION)
      .doc(parsed.stateData.attemptDocumentId);
    const attemptSnapshot = await transaction.get(attemptRef);
    const attempt = attemptSnapshot.exists ? attemptSnapshot.data() || {} : {};
    if (
      !attemptSnapshot.exists ||
      attempt.latestState !== state ||
      (attempt.status !== undefined && attempt.status !== "pending") ||
      attempt.uid !== parsed.stateData.uid ||
      attempt.businessId !== parsed.profileContext.businessId ||
      attempt.profileId !== parsed.profileContext.profileId
    ) {
      throw new ApiError(409, "OAuth connection attempt was superseded");
    }

    const processingExpiresAt = Timestamp.fromMillis(
      Date.now() + GOOGLE_OAUTH_PROCESSING_MAX_AGE_SECONDS * 1_000
    );
    transaction.delete(stateRef);
    transaction.update(attemptRef, {
      status: "processing",
      processingState: state,
      processingExpiresAt,
      expiresAt: processingExpiresAt,
    });
    return parsed;
  });
}

async function finishBrowserBoundOAuthAttempt(
  stateData: OAuthStateData,
  state: string
): Promise<void> {
  const db = getAdminDb();
  const attemptRef = db
    .collection(GOOGLE_OAUTH_ATTEMPT_COLLECTION)
    .doc(stateData.attemptDocumentId);
  await db.runTransaction(async (transaction) => {
    const attemptSnapshot = await transaction.get(attemptRef);
    const attempt = attemptSnapshot.exists ? attemptSnapshot.data() || {} : {};
    if (
      attemptSnapshot.exists &&
      attempt.latestState === state &&
      attempt.status === "processing" &&
      attempt.processingState === state
    ) {
      transaction.delete(attemptRef);
    }
  });
}

async function authoritativeGrantedScope(
  client: ReturnType<typeof getOAuthClient>,
  accessToken: string,
  tokenScope: string | null | undefined
): Promise<string> {
  const supplied = String(tokenScope || "").trim();
  if (supplied) return supplied;
  const tokenInfo = await client.getTokenInfo(accessToken);
  const scopes = Array.isArray(tokenInfo.scopes)
    ? tokenInfo.scopes.map((scope) => String(scope).trim()).filter(Boolean)
    : [];
  if (scopes.length === 0) throw new ApiError(400, "Google grant scopes are unavailable");
  return scopes.join(" ");
}

export const GET = withApiHandler(async ({ request, log }) => {
  const state = request.nextUrl.searchParams.get("state");
  const code = request.nextUrl.searchParams.get("code");
  const oauthError = request.nextUrl.searchParams.get("error");

  log.info("oauth.callback.received", {
    requestOrigin: request.nextUrl.origin,
    hasCode: Boolean(code),
    hasState: Boolean(state),
    hasError: Boolean(oauthError),
  });

  if (!isGoogleOAuthStateIdentifier(state)) {
    return resultResponse({
      request,
      state,
      errorCode: "connection_session_invalid",
    });
  }

  let consumed: Awaited<ReturnType<typeof consumeBrowserBoundOAuthState>>;
  try {
    consumed = await consumeBrowserBoundOAuthState(request, state);
  } catch (error) {
    const superseded = error instanceof ApiError && error.status === 409;
    log.warn("oauth.callback.state_rejected", {
      reason: superseded ? "superseded" : "invalid_browser_binding_or_state",
    });
    return resultResponse({
      request,
      state,
      errorCode: superseded ? "connection_superseded" : "connection_session_invalid",
    });
  }

  const { stateData, profileContext } = consumed;
  try {
  if (oauthError) {
    const errorCode = providerErrorCode(oauthError);
    log.warn("oauth.callback.provider_denied", {
      uid: stateData.uid,
      businessId: profileContext.businessId,
      profileId: profileContext.profileId,
      errorCode,
      correlationId: stateData.correlationId || null,
    });
    return resultResponse({ request, state, stateData, profileContext, errorCode });
  }
  if (!code) {
    return resultResponse({
      request,
      state,
      stateData,
      profileContext,
      errorCode: "connection_session_invalid",
    });
  }

  let client: ReturnType<typeof getOAuthClient>;
  try {
    client = getOAuthClient();
  } catch {
    log.error("oauth.callback.configuration_invalid", {
      uid: stateData.uid,
      profileId: profileContext.profileId,
      correlationId: stateData.correlationId || null,
    });
    return resultResponse({
      request,
      state,
      stateData,
      profileContext,
      errorCode: "configuration_error",
    });
  }
  let tokens: Credentials;
  try {
    ({ tokens } = await client.getToken({
      code,
      codeVerifier: String(readGoogleOAuthPkceCookie(request, state) || ""),
    }));
  } catch {
    log.warn("oauth.callback.token_exchange_failed", {
      uid: stateData.uid,
      profileId: profileContext.profileId,
      correlationId: stateData.correlationId || null,
    });
    return resultResponse({
      request,
      state,
      stateData,
      profileContext,
      errorCode: "token_exchange_failed",
    });
  }

  const accessToken = String(tokens.access_token || "").trim();
  let grantedScope: string;
  try {
    if (!accessToken) throw new ApiError(400, "Google did not return an access token");
    grantedScope = await authoritativeGrantedScope(client, accessToken, tokens.scope);
    assertGoogleTokenScopeForPreset(
      (stateData.scopePreset || "full") as GoogleScopePreset,
      grantedScope
    );
  } catch {
    log.warn("oauth.callback.scope_rejected", {
      uid: stateData.uid,
      profileId: profileContext.profileId,
      scopePreset: stateData.scopePreset,
      correlationId: stateData.correlationId || null,
    });
    return resultResponse({
      request,
      state,
      stateData,
      profileContext,
      errorCode: "scope_not_allowed",
    });
  }

  let identity: Awaited<ReturnType<typeof fetchGoogleAccountIdentity>>;
  try {
    identity = await fetchGoogleAccountIdentity(accessToken, log);
  } catch (error) {
    return resultResponse({
      request,
      state,
      stateData,
      profileContext,
      errorCode: "account_identity_failed",
    });
  }

  try {
    await storeGoogleProfileTokens(
      stateData.uid,
      profileContext.profileId,
      {
        ...tokens,
        scope: grantedScope,
        account_email: identity.email,
        account_subject: identity.subject,
      },
      stateData.scopePreset,
      log
    );
  } catch (error) {
    return resultResponse({
      request,
      state,
      stateData,
      profileContext,
      errorCode:
        error instanceof GoogleAccountProfileConflictError
          ? "account_already_connected"
          : error instanceof GoogleAccountProfileReplacementRequiresDisconnectError
            ? "profile_replacement_requires_disconnect"
          : "credential_storage_failed",
    });
  }

  log.info("oauth.connect.completed", {
    uid: stateData.uid,
    businessId: profileContext.businessId,
    profileId: profileContext.profileId,
    scopePreset: stateData.scopePreset,
    correlationId: stateData.correlationId || null,
  });
  return resultResponse({
    request,
    state,
    stateData,
    profileContext,
    connected: true,
  });
  } finally {
    try {
      await finishBrowserBoundOAuthAttempt(stateData, state);
    } catch {
      log.error("oauth.callback.attempt_cleanup_failed", {
        uid: stateData.uid,
        profileId: profileContext.profileId,
        correlationId: stateData.correlationId || null,
      });
    }
  }
}, { route: "google.callback" });
