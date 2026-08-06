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
  resolveMissionControlOrigin,
  storeGoogleProfileTokens,
  storeGoogleTokens,
} from "@/lib/google/oauth";

const oauthStateSchema = z
  .object({
    uid: z.string().trim().min(1).max(128),
    returnTo: z.string().max(500).optional(),
    origin: z.string().max(500).optional(),
    correlationId: z.string().trim().min(1).max(128).optional(),
    businessId: z.string().trim().min(1).max(64).nullable().optional(),
    profileId: z.string().trim().min(1).max(64).nullable().optional(),
  })
  .passthrough();

type OAuthStateData = z.infer<typeof oauthStateSchema>;

function parseOAuthState(value: unknown): {
  stateData: OAuthStateData;
  profileContext: GoogleBusinessProfile | null;
} {
  const parsed = oauthStateSchema.safeParse(value);
  if (!parsed.success) {
    throw new ApiError(400, "Invalid OAuth state");
  }

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
    const errorDescription = request.nextUrl.searchParams.get("error_description");

    let redirectOrigin = resolveMissionControlOrigin(undefined, request.nextUrl.origin).origin;
    let redirectUrl = sanitizeReturnTo(undefined, redirectOrigin);
    let uid: string | undefined;
    let profileContext: GoogleBusinessProfile | null = null;

    // Best-effort: if we have state, honor the original returnTo and delete state.
    if (state) {
      try {
        const stateRef = getAdminDb().collection("google_oauth_state").doc(state);
        const stateSnap = await stateRef.get();
        if (stateSnap.exists) {
          const rawState = stateSnap.data();
          await stateRef.delete();
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
        }
      } catch (error) {
        log.warn("google.oauth.error_state_lookup_failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    redirectUrl.searchParams.set("google", "error");
    redirectUrl.searchParams.set("googleError", oauthError);
    if (errorDescription) {
      // Keep the URL bounded and avoid stuffing potentially sensitive content.
      redirectUrl.searchParams.set("googleErrorDescription", errorDescription.slice(0, 220));
    }
    if (profileContext) {
      redirectUrl.searchParams.set("googleBusiness", profileContext.businessId);
      redirectUrl.searchParams.set("googleProfile", profileContext.profileId);
    }

    log.warn("google.oauth.error", {
      uid: uid || null,
      businessId: profileContext?.businessId || null,
      profileId: profileContext?.profileId || null,
      error: oauthError,
      errorDescription: errorDescription ? errorDescription.slice(0, 220) : null,
    });
    return NextResponse.redirect(redirectUrl);
  }

  if (!code || !state) {
    throw new ApiError(400, "Missing OAuth code or state");
  }

  const stateRef = getAdminDb().collection("google_oauth_state").doc(state);
  const stateSnap = await stateRef.get();

  if (!stateSnap.exists) {
    throw new ApiError(400, "Invalid OAuth state");
  }

  // Consume state before exchanging the authorization code. A failed exchange
  // requires a fresh connect attempt and cannot replay this state document.
  const rawState = stateSnap.data();
  await stateRef.delete();
  const { stateData, profileContext } = parseOAuthState(rawState);
  const client = getOAuthClient();
  const { tokens } = await client.getToken(code);

  if (profileContext) {
    await storeGoogleProfileTokens(stateData.uid, profileContext.profileId, tokens, log);
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
