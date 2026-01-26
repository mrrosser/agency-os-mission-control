import { NextResponse } from "next/server";
import { ApiError, withApiHandler } from "@/lib/api/handler";
import { getAdminDb } from "@/lib/firebase-admin";
import { getOAuthClient, storeGoogleTokens } from "@/lib/google/oauth";

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
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const oauthError = request.nextUrl.searchParams.get("error");

  if (oauthError) {
    log.warn("google.oauth.error", { error: oauthError });
    const redirectUrl = sanitizeReturnTo("/dashboard/integrations?google=error", request.nextUrl.origin);
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

  const stateData = stateSnap.data() as { uid: string; returnTo?: string };
  const client = getOAuthClient();
  const { tokens } = await client.getToken(code);

  await storeGoogleTokens(stateData.uid, tokens, log);
  await stateRef.delete();

  const redirectUrl = sanitizeReturnTo(stateData.returnTo, request.nextUrl.origin);
  log.info("google.oauth.connected", { uid: stateData.uid });

  return NextResponse.redirect(redirectUrl);
}, { route: "google.callback" });
