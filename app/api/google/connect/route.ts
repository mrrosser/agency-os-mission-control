import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, withApiHandler } from "@/lib/api/handler";
import { readBoundedRequestBody } from "@/lib/api/bounded-body";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { getAdminDb } from "@/lib/firebase-admin";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import {
  GoogleBusinessProfileContextError,
  resolveGoogleBusinessProfileContext,
} from "@/lib/google/business-profiles";
import { getGoogleAuthUrl, resolveMissionControlOrigin } from "@/lib/google/oauth";
import {
  createGoogleOAuthPkceBinding,
  GOOGLE_OAUTH_ATTEMPT_COLLECTION,
  GOOGLE_OAUTH_STATE_COLLECTION,
  GOOGLE_OAUTH_STATE_MAX_AGE_SECONDS,
  googleOAuthAttemptDocumentId,
  isGoogleOAuthStateIdentifier,
  setGoogleOAuthPkceCookie,
} from "@/lib/google/oauth-state";

const contextIdSchema = z.string().trim().min(1).max(64);
const bodySchema = z
  .object({
    returnTo: z
      .string()
      .trim()
      .min(1)
      .max(500)
      .refine(
        (value) =>
          value.startsWith("/") &&
          !value.startsWith("//") &&
          !value.includes("\\"),
        {
          message: "returnTo must be an app-relative path",
        }
      )
      .optional(),
    scopePreset: z
      .enum(["core", "drive", "calendar", "gmail", "gmail_send", "full"]),
    workspaceId: z
      .string()
      .trim()
      .min(1)
      .max(128)
      .regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/)
      .optional(),
    businessId: contextIdSchema.optional(),
    profileId: contextIdSchema.optional(),
    correlationId: z.string().trim().min(1).max(128).optional(),
  })
  .strict();

const GOOGLE_CONNECT_BODY_MAX_BYTES = 4_096;

async function parseBoundedConnectBody(request: Request) {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim();
  if (contentType !== "application/json") {
    throw new ApiError(415, "Content-Type must be application/json.");
  }
  const raw = await readBoundedRequestBody(request, GOOGLE_CONNECT_BODY_MAX_BYTES);
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    throw new ApiError(400, "Invalid JSON body.");
  }
  const parsed = bodySchema.safeParse(decoded);
  if (!parsed.success) throw new ApiError(400, "Invalid request body.");
  return parsed.data;
}

export const POST = withApiHandler(async ({ request, correlationId: requestCorrelationId, log }) => {
  const user = await requireFirebaseAuth(request, log);
  if ([...request.nextUrl.searchParams.keys()].length > 0) {
    throw new ApiError(400, "Query parameters are not supported.");
  }
  const body = await parseBoundedConnectBody(request);
  const returnTo = body.returnTo || "/dashboard/integrations";
  const resolvedOrigin = resolveMissionControlOrigin(undefined, request.nextUrl.origin);
  const origin = resolvedOrigin.origin;
  const scopePreset = body.scopePreset;
  const correlationId = body.correlationId || requestCorrelationId;
  let profileContext: ReturnType<typeof resolveGoogleBusinessProfileContext>;
  try {
    profileContext = resolveGoogleBusinessProfileContext({
      businessId: body.businessId,
      profileId: body.profileId,
    });
  } catch (error) {
    if (error instanceof GoogleBusinessProfileContextError) {
      throw new ApiError(400, error.message);
    }
    throw error;
  }
  if (!profileContext) {
    throw new ApiError(400, "A Google business profile is required.");
  }

  if (resolvedOrigin.redirected) {
    log.warn("oauth.connect.redirect_blocked", {
      uid: user.uid,
      requestOrigin: request.nextUrl.origin,
      origin,
      correlationId,
    });
  }

  const state = randomUUID();
  const pkce = createGoogleOAuthPkceBinding();
  const expiresAt = Timestamp.fromMillis(
    Date.now() + GOOGLE_OAUTH_STATE_MAX_AGE_SECONDS * 1000
  );
  const db = getAdminDb();
  const stateRef = db.collection(GOOGLE_OAUTH_STATE_COLLECTION).doc(state);
  const attemptRef = db
    .collection(GOOGLE_OAUTH_ATTEMPT_COLLECTION)
    .doc(googleOAuthAttemptDocumentId(user.uid, profileContext.profileId));

  await db.runTransaction(async (transaction) => {
    const previousAttempt = await transaction.get(attemptRef);
    const previousAttemptData = previousAttempt.exists
      ? previousAttempt.data() || {}
      : {};
    const previousExpiresAt =
      previousAttemptData.status === "processing"
        ? previousAttemptData.processingExpiresAt || previousAttemptData.expiresAt
        : previousAttemptData.expiresAt;
    const previousExpiresAtMs =
      previousExpiresAt && typeof previousExpiresAt.toMillis === "function"
        ? previousExpiresAt.toMillis()
        : previousExpiresAt instanceof Date
          ? previousExpiresAt.getTime()
          : Number.NaN;
    if (
      previousAttemptData.status === "processing" &&
      (!Number.isFinite(previousExpiresAtMs) || previousExpiresAtMs > Date.now())
    ) {
      throw new ApiError(409, "A Google connection is already completing for this profile.");
    }
    const previousState = previousAttempt.exists
      ? String(previousAttemptData.latestState || "")
      : "";
    if (isGoogleOAuthStateIdentifier(previousState) && previousState !== state) {
      transaction.delete(
        db.collection(GOOGLE_OAUTH_STATE_COLLECTION).doc(previousState)
      );
    }
    transaction.create(stateRef, {
        uid: user.uid,
        returnTo,
        origin,
        scopePreset,
        workspaceId: body.workspaceId || null,
        businessId: profileContext.businessId,
        profileId: profileContext.profileId,
        correlationId,
        codeChallenge: pkce.challenge,
        attemptDocumentId: attemptRef.id,
        createdAt: FieldValue.serverTimestamp(),
        expiresAt,
      });
    transaction.set(attemptRef, {
      uid: user.uid,
      businessId: profileContext.businessId,
      profileId: profileContext.profileId,
      latestState: state,
      status: "pending",
      createdAt: FieldValue.serverTimestamp(),
      expiresAt,
    });
  });

  const authUrl = getGoogleAuthUrl(state, {
    scopePreset,
    codeChallenge: pkce.challenge,
  });
  const response = NextResponse.json({
    authUrl,
    businessId: profileContext.businessId,
    profileId: profileContext.profileId,
  });
  setGoogleOAuthPkceCookie(response, state, pkce.verifier);
  response.headers.set("cache-control", "private, no-store, max-age=0");
  response.headers.set("pragma", "no-cache");
  response.headers.set("referrer-policy", "no-referrer");

  log.info("oauth.connect.init", {
    uid: user.uid,
    scopePreset,
    origin,
    workspaceId: body.workspaceId || null,
    businessId: profileContext.businessId,
    profileId: profileContext.profileId,
    correlationId,
    browserBound: true,
  });

  return response;
}, { route: "google.connect" });
