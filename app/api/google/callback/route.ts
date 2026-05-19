import { NextResponse } from "next/server";
import { ApiError, withApiHandler } from "@/lib/api/handler";
import { getAdminDb } from "@/lib/firebase-admin";
import { getOAuthClient, resolveMissionControlOrigin, storeGoogleTokens } from "@/lib/google/oauth";

function sanitizeReturnTo(returnTo: string | undefined, origin: string) {
  if (!returnTo) {
    return new URL("/dashboard/integrations", origin);
  }

  if (returnTo.startsWith("/")) {
    return new URL(returnTo, origin);
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

    // Best-effort: if we have state, honor the original returnTo and delete state.
    if (state) {
      try {
        const stateRef = getAdminDb().collection("google_oauth_state").doc(state);
        const stateSnap = await stateRef.get();
        if (stateSnap.exists) {
          const stateData = stateSnap.data() as {
            uid: string;
            returnTo?: string;
            origin?: string;
            correlationId?: string;
          };
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
          await stateRef.delete();
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

    log.warn("google.oauth.error", {
      uid: uid || null,
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

  const stateData = stateSnap.data() as {
    uid: string;
    returnTo?: string;
    origin?: string;
    correlationId?: string;
  };
  const client = getOAuthClient();
  const { tokens } = await client.getToken(code);

  await storeGoogleTokens(stateData.uid, tokens, log);
  await stateRef.delete();

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
  log.info("oauth.connect.completed", {
    uid: stateData.uid,
    redirectOrigin,
    correlationId: stateData.correlationId || null,
  });

  return NextResponse.redirect(redirectUrl);
}, { route: "google.callback" });
