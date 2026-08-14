import "server-only";

import { createHash, randomBytes, timingSafeEqual } from "crypto";
import type { NextRequest, NextResponse } from "next/server";

export const GOOGLE_OAUTH_STATE_MAX_AGE_SECONDS = 10 * 60;
export const GOOGLE_OAUTH_PROCESSING_MAX_AGE_SECONDS = 20 * 60;
export const GOOGLE_OAUTH_STATE_COLLECTION = "google_oauth_state";
export const GOOGLE_OAUTH_ATTEMPT_COLLECTION = "google_oauth_connect_attempts";

const STATE_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PKCE_VERIFIER_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const PKCE_CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

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
    return request.cookies.get(googleOAuthStateCookieName(state))?.value || null;
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
