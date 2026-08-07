import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, withApiHandler } from "@/lib/api/handler";
import { getIdempotencyKey, withIdempotency } from "@/lib/api/idempotency";
import { parseJson } from "@/lib/api/validation";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { getAdminDb } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import {
  GoogleBusinessProfileContextError,
  resolveGoogleBusinessProfileContext,
} from "@/lib/google/business-profiles";
import { getGoogleAuthUrl, resolveMissionControlOrigin } from "@/lib/google/oauth";

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
    scopePreset: z.enum(["core", "drive", "calendar", "gmail", "full"]).optional(),
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
    idempotencyKey: z.string().trim().min(1).max(200).optional(),
  })
  .strict();

export const POST = withApiHandler(async ({ request, correlationId: requestCorrelationId, log }) => {
  const body = await parseJson(request, bodySchema);
  const user = await requireFirebaseAuth(request, log);
  const returnTo = body.returnTo || "/dashboard/integrations";
  const resolvedOrigin = resolveMissionControlOrigin(undefined, request.nextUrl.origin);
  const origin = resolvedOrigin.origin;
  const scopePreset = body.scopePreset || "full";
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
  const idempotencyKey = getIdempotencyKey(request, body);

  if (resolvedOrigin.redirected) {
    log.warn("oauth.connect.redirect_blocked", {
      uid: user.uid,
      requestOrigin: request.nextUrl.origin,
      origin,
      correlationId,
    });
  }

  const result = await withIdempotency(
    {
      uid: user.uid,
      route: `google.connect.${profileContext?.profileId || "legacy"}`,
      key: idempotencyKey,
      log,
    },
    async () => {
      const state = randomUUID();
      await getAdminDb().collection("google_oauth_state").doc(state).set({
        uid: user.uid,
        returnTo,
        origin,
        scopePreset,
        workspaceId: body.workspaceId || null,
        businessId: profileContext?.businessId || null,
        profileId: profileContext?.profileId || null,
        correlationId,
        createdAt: FieldValue.serverTimestamp(),
      });

      const authUrl = getGoogleAuthUrl(state, { scopePreset });
      return profileContext
        ? {
            authUrl,
            businessId: profileContext.businessId,
            profileId: profileContext.profileId,
          }
        : { authUrl };
    }
  );

  log.info("oauth.connect.init", {
    uid: user.uid,
    scopePreset,
    origin,
    workspaceId: body.workspaceId || null,
    businessId: profileContext?.businessId || null,
    profileId: profileContext?.profileId || null,
    correlationId,
    replayed: result.replayed,
  });

  return NextResponse.json(result.data);
}, { route: "google.connect" });
