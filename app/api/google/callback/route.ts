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

function sanitizeOrigin(stateOrigin: string | undefined, requestOrigin: string): string {
  const forced = process.env.MISSION_CONTROL_PUBLIC_ORIGIN;
  const candidate = forced || stateOrigin || requestOrigin;

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return requestOrigin;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return requestOrigin;
  }

  if (url.hostname === "0.0.0.0" || url.hostname === "::") {
    return requestOrigin;
  }

  if (forced) {
    return url.origin;
  }

  // Prevent open redirects: allow same-origin, or localhost for dev, or explicit allowlist.
  const req = new URL(requestOrigin);
  if (url.origin === req.origin) {
    return url.origin;
  }

  if (url.hostname === "localhost" || url.hostname === "127.0.0.1") {
    return url.origin;
  }

  const allowlist = (process.env.MISSION_CONTROL_ALLOWED_ORIGINS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (allowlist.includes(url.origin)) {
    return url.origin;
  }

  return requestOrigin;
}

export const GET = withApiHandler(async ({ request, log }) => {
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const oauthError = request.nextUrl.searchParams.get("error");

  if (oauthError) {
    log.warn("google.oauth.error", { error: oauthError });
    const redirectOrigin = sanitizeOrigin(undefined, request.nextUrl.origin);
    const redirectUrl = sanitizeReturnTo("/dashboard/integrations?google=error", redirectOrigin);
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

  const stateData = stateSnap.data() as { uid: string; returnTo?: string; origin?: string };
  const client = getOAuthClient();
  const { tokens } = await client.getToken(code);

  await storeGoogleTokens(stateData.uid, tokens, log);
  await stateRef.delete();

  const redirectOrigin = sanitizeOrigin(stateData.origin, request.nextUrl.origin);
  const redirectUrl = sanitizeReturnTo(stateData.returnTo, redirectOrigin);
  log.info("google.oauth.connected", { uid: stateData.uid });

  return NextResponse.redirect(redirectUrl);
}, { route: "google.callback" });
