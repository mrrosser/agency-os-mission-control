import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, withApiHandler } from "@/lib/api/handler";
import { getAdminDb } from "@/lib/firebase-admin";
import {
  GoogleBusinessProfileContextError,
  resolveGoogleBusinessProfileContext,
  type GoogleBusinessProfile,
} from "@/lib/google/business-profiles";
import {
  getOAuthClient,
  fetchGoogleAccountEmail,
  resolveMissionControlOrigin,
  storeGoogleProfileTokens,
  storeGoogleTokens,
  assertGoogleTokenScopeForPreset,
  type GoogleScopePreset,
} from "@/lib/google/oauth";

const oauthStateSchema = z
  .object({
    uid: z.string().trim().min(1).max(128),
    returnTo: z.string().max(500).optional(),
    origin: z.string().max(500).optional(),
    correlationId: z.string().trim().min(1).max(128).optional(),
    businessId: z.string().trim().min(1).max(64).nullable().optional(),
    profileId: z.string().trim().min(1).max(64).nullable().optional(),
    scopePreset: z
      .enum(["core", "drive", "calendar", "gmail", "gmail_send", "full"])
      .optional(),
    createdAt: z.unknown(),
  })
  .passthrough();

const OAUTH_STATE_MAX_AGE_MS = 10 * 60 * 1000;

function oauthStateCreatedAtMs(value: unknown): number | null {
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
    if (Number.isFinite(seconds)) return seconds * 1000;
  }
  return null;
}

function assertFreshOAuthState(createdAt: unknown, nowMs = Date.now()): void {
  const createdAtMs = oauthStateCreatedAtMs(createdAt);
  if (
    createdAtMs === null ||
    createdAtMs > nowMs + 60_000 ||
    nowMs - createdAtMs > OAUTH_STATE_MAX_AGE_MS
  ) {
    throw new ApiError(400, "Expired OAuth state");
  }
}

type OAuthStateData = z.infer<typeof oauthStateSchema>;

function parseOAuthState(value: unknown): {
  stateData: OAuthStateData;
  profileContext: GoogleBusinessProfile | null;
} {
  const parsed = oauthStateSchema.safeParse(value);
  if (!parsed.success) {
    throw new ApiError(400, "Invalid OAuth state");
  }

  assertFreshOAuthState(parsed.data.createdAt);

  try {
    return {
      stateData: parsed.data,
      profileContext: resolveGoogleBusinessProfileContext({
        businessId: parsed.data.businessId,
        profileId: parsed.data.profileId,
      }),
    };
  } catch (error) {
    if (error instanceof GoogleBusinessProfileContextError) {
      throw new ApiError(400, error.message);
    }
    throw error;
  }
}

function sanitizeReturnTo(returnTo: string | undefined, origin: string) {
  if (!returnTo) {
    return new URL("/dashboard/integrations", origin);
  }

  if (
    returnTo.startsWith("/") &&
    !returnTo.startsWith("//") &&
    !returnTo.includes("\\")
  ) {
    const candidate = new URL(returnTo, origin);
    if (candidate.origin === new URL(origin).origin) {
      return candidate;
    }
  }

  return new URL("/dashboard/integrations", origin);
}

async function consumeOAuthState(state: string): Promise<unknown> {
  const db = getAdminDb();
  const stateRef = db.collection("google_oauth_state").doc(state);
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(stateRef);
    if (!snapshot.exists) throw new ApiError(400, "Invalid OAuth state");
    transaction.delete(stateRef);
    return snapshot.data();
  });
}

export const GET = withApiHandler(async ({ request, log }) => {
  log.info("oauth.callback.received", {
    requestOrigin: request.nextUrl.origin,
    hasCode: request.nextUrl.searchParams.has("code"),
    hasState: request.nextUrl.searchParams.has("state"),
    hasError: request.nextUrl.searchParams.has("error"),
  });

  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const oauthError = request.nextUrl.searchParams.get("error");

  if (oauthError) {
    let redirectOrigin = resolveMissionControlOrigin(undefined, request.nextUrl.origin).origin;
    let redirectUrl = sanitizeReturnTo(undefined, redirectOrigin);
    let uid: string | undefined;
    let profileContext: GoogleBusinessProfile | null = null;

    // Consume the one-time state with the same atomic boundary as a successful
    // callback. A concurrent error callback cannot reuse it.
    if (state) {
      try {
        const rawState = await consumeOAuthState(state);
        const parsedState = parseOAuthState(rawState);
        const stateData = parsedState.stateData;
        profileContext = parsedState.profileContext;
        uid = stateData.uid;
        const resolvedOrigin = resolveMissionControlOrigin(stateData.origin, request.nextUrl.origin);
        redirectOrigin = resolvedOrigin.origin;
        if (resolvedOrigin.redirected) {
          log.warn("oauth.callback.redirect_blocked", {
            uid,
            requestOrigin: request.nextUrl.origin,
            stateOrigin: stateData.origin || null,
            redirectOrigin,
            correlationId: stateData.correlationId || null,
          });
        }
        redirectUrl = sanitizeReturnTo(stateData.returnTo, redirectOrigin);
      } catch (error) {
        log.warn("google.oauth.error_state_lookup_failed", {
          reason:
            error instanceof ApiError && error.message.includes("Expired")
              ? "expired_state"
              : "invalid_or_consumed_state",
        });
      }
    }

    redirectUrl.searchParams.set("google", "error");
    const safeErrorCode = ["access_denied", "temporarily_unavailable", "server_error"].includes(
      oauthError
    )
      ? oauthError
      : "oauth_failed";
    redirectUrl.searchParams.set("googleError", safeErrorCode);
    if (profileContext) {
      redirectUrl.searchParams.set("googleBusiness", profileContext.businessId);
      redirectUrl.searchParams.set("googleProfile", profileContext.profileId);
    }

    log.warn("google.oauth.error", {
      uid: uid || null,
      businessId: profileContext?.businessId || null,
      profileId: profileContext?.profileId || null,
      errorCode: safeErrorCode,
    });
    return NextResponse.redirect(redirectUrl);
  }

  if (!code || !state) {
    throw new ApiError(400, "Missing OAuth code or state");
  }

  // Atomically consume state before exchanging the authorization code. A
  // concurrent callback cannot observe and reuse the same one-time grant.
  const rawState = await consumeOAuthState(state);
  const { stateData, profileContext } = parseOAuthState(rawState);
  const client = getOAuthClient();
  const { tokens } = await client.getToken(code);
  assertGoogleTokenScopeForPreset(
    (stateData.scopePreset || "full") as GoogleScopePreset,
    tokens.scope
  );

  if (profileContext) {
    const accountEmail = await fetchGoogleAccountEmail(
      String(tokens.access_token || ""),
      log
    );
    await storeGoogleProfileTokens(
      stateData.uid,
      profileContext.profileId,
      { ...tokens, account_email: accountEmail },
      log
    );
  } else {
    await storeGoogleTokens(stateData.uid, tokens, log);
  }

  const resolvedOrigin = resolveMissionControlOrigin(stateData.origin, request.nextUrl.origin);
  if (resolvedOrigin.redirected) {
    log.warn("oauth.callback.redirect_blocked", {
      uid: stateData.uid,
      requestOrigin: request.nextUrl.origin,
      stateOrigin: stateData.origin || null,
      redirectOrigin: resolvedOrigin.origin,
      correlationId: stateData.correlationId || null,
    });
  }

  const redirectOrigin = resolvedOrigin.origin;
  const redirectUrl = sanitizeReturnTo(stateData.returnTo, redirectOrigin);
  if (profileContext) {
    redirectUrl.searchParams.set("google", "connected");
    redirectUrl.searchParams.set("googleBusiness", profileContext.businessId);
    redirectUrl.searchParams.set("googleProfile", profileContext.profileId);
  }
  log.info("oauth.connect.completed", {
    uid: stateData.uid,
    redirectOrigin,
    businessId: profileContext?.businessId || null,
    profileId: profileContext?.profileId || null,
    correlationId: stateData.correlationId || null,
  });

  return NextResponse.redirect(redirectUrl);
}, { route: "google.callback" });
