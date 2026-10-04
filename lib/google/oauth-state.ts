import "server-only";

import { createHash, createHmac, randomBytes, timingSafeEqual } from "crypto";
import type { NextRequest, NextResponse } from "next/server";

export const GOOGLE_OAUTH_STATE_MAX_AGE_SECONDS = 10 * 60;
export const GOOGLE_OAUTH_PROCESSING_MAX_AGE_SECONDS = 20 * 60;
export const GOOGLE_OAUTH_STATE_COLLECTION = "google_oauth_state";
export const GOOGLE_OAUTH_ATTEMPT_COLLECTION = "google_oauth_connect_attempts";

const STATE_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PKCE_VERIFIER_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const PKCE_CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const BROWSER_COOKIE_NAME = "__session";
const BROWSER_COOKIE_PREFIX = "mc-google-oauth-v1.";
const BROWSER_COOKIE_PATH = "/api/google";

// Firebase Hosting forwards only __session to Cloud Run. Scope this independent
// browser binding to Google routes so a Firebase Auth __session at / is untouched.
// Read the raw header: Next's cookie map can collapse the two same-name cookies.
function readBrowserSecret(request: NextRequest): string | null {
  const cookie = request.headers.get("cookie") || "";
  if (cookie.length > 16_384) throw new Error("Google browser binding header is too large");
  const values = cookie
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${BROWSER_COOKIE_NAME}=${BROWSER_COOKIE_PREFIX}`))
    .map((part) => part.slice(BROWSER_COOKIE_NAME.length + 1 + BROWSER_COOKIE_PREFIX.length));
  if (values.length === 0) return null;
  if (values.length !== 1 || !PKCE_VERIFIER_PATTERN.test(values[0])) {
    throw new Error("Ambiguous Google browser binding");
  }
  return values[0];
}

function browserVerifier(secret: string, state: string): string {
  if (!isGoogleOAuthStateIdentifier(state)) throw new Error("Invalid Google OAuth state identifier");
  return createHmac("sha256", secret)
    .update(`mission-control-google-pkce-v1:${state}`, "utf8")
    .digest("base64url");
}

export function createGoogleOAuthBrowserBinding(request: NextRequest, state: string): {
  browserSecret: string;
  verifier: string;
  challenge: string;
} {
  const browserSecret = readBrowserSecret(request) || randomBytes(32).toString("base64url");
  const verifier = browserVerifier(browserSecret, state);
  return { browserSecret, verifier, challenge: sha256Base64Url(verifier) };
}

export function setGoogleOAuthBrowserCookie(response: NextResponse, browserSecret: string): void {
  if (!PKCE_VERIFIER_PATTERN.test(browserSecret)) throw new Error("Invalid Google browser binding");
  response.cookies.set({
    name: BROWSER_COOKIE_NAME,
    value: BROWSER_COOKIE_PREFIX + browserSecret,
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: BROWSER_COOKIE_PATH,
    maxAge: GOOGLE_OAUTH_STATE_MAX_AGE_SECONDS,
  });
}

export function isGoogleOAuthStateIdentifier(value: string | null | undefined): value is string {
  return STATE_PATTERN.test(String(value || ""));
}

function sha256Base64Url(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("base64url");
}

export function googleOAuthAttemptDocumentId(uid: string, profileId: string): string {
  return createHash("sha256")
    .update(`${uid.length}:${uid}:${profileId.length}:${profileId}`, "utf8")
    .digest("hex");
}

export function googleOAuthStateCookieName(state: string): string {
  if (!isGoogleOAuthStateIdentifier(state)) {
    throw new Error("Invalid Google OAuth state identifier");
  }
  return `__Host-mc-google-oauth-${state.replace(/-/g, "")}`;
}

export function createGoogleOAuthPkceBinding(): {
  verifier: string;
  challenge: string;
} {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: sha256Base64Url(verifier) };
}

export function verifyGoogleOAuthPkceBinding(
  verifier: string | null | undefined,
  expectedChallenge: string | null | undefined
): boolean {
  if (
    !PKCE_VERIFIER_PATTERN.test(String(verifier || "")) ||
    !PKCE_CHALLENGE_PATTERN.test(String(expectedChallenge || ""))
  ) {
    return false;
  }
  const actual = Buffer.from(sha256Base64Url(String(verifier)), "utf8");
  const expected = Buffer.from(String(expectedChallenge), "utf8");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function readGoogleOAuthPkceCookie(
  request: NextRequest,
  state: string
): string | null {
  try {
    const browserSecret = readBrowserSecret(request);
    // An older attempt may coexist with a new profile's browser anchor. Its
    // exact per-state cookie remains authoritative for that attempt only.
    const legacyVerifier = request.cookies.get(googleOAuthStateCookieName(state))?.value;
    if (legacyVerifier) return PKCE_VERIFIER_PATTERN.test(legacyVerifier) ? legacyVerifier : null;
    if (browserSecret) return browserVerifier(browserSecret, state);
    return null;
  } catch {
    return null;
  }
}

export function setGoogleOAuthPkceCookie(
  response: NextResponse,
  state: string,
  verifier: string
): void {
  if (!PKCE_VERIFIER_PATTERN.test(verifier)) {
    throw new Error("Invalid Google OAuth PKCE verifier");
  }
  response.cookies.set({
    name: googleOAuthStateCookieName(state),
    value: verifier,
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: GOOGLE_OAUTH_STATE_MAX_AGE_SECONDS,
  });
}

export function clearGoogleOAuthPkceCookie(
  response: NextResponse,
  state: string | null | undefined
): void {
  // Clear only the legacy per-state cookie. The scoped shared browser cookie
  // expires naturally; a delayed callback must never clear a newer attempt.
  if (!isGoogleOAuthStateIdentifier(state)) return;
  response.cookies.set({
    name: googleOAuthStateCookieName(state),
    value: "",
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}
