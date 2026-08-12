import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, withApiHandler } from "@/lib/api/handler";
import { readBoundedRequestBody } from "@/lib/api/bounded-body";
import { getIdempotencyKey, withIdempotency } from "@/lib/api/idempotency";
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
    scopePreset: z
      .enum(["core", "drive", "calendar", "gmail", "gmail_send", "full"])
      .optional(),
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
