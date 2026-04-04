import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/api/handler";
import { parseJson } from "@/lib/api/validation";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { getAdminDb } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { getGoogleAuthUrl, resolveMissionControlOrigin } from "@/lib/google/oauth";

const bodySchema = z.object({
  returnTo: z.string().optional(),
  scopePreset: z.enum(["core", "drive", "calendar", "gmail", "full"]).optional(),
  workspaceId: z.string().trim().optional(),
  businessId: z.string().trim().optional(),
  correlationId: z.string().trim().optional(),
});

export const POST = withApiHandler(async ({ request, log }) => {
  const body = await parseJson(request, bodySchema);
  const user = await requireFirebaseAuth(request, log);
  const state = randomUUID();
  const returnTo = body.returnTo || "/dashboard/integrations";
  const resolvedOrigin = resolveMissionControlOrigin(undefined, request.nextUrl.origin);
  const origin = resolvedOrigin.origin;
  const scopePreset = body.scopePreset || "full";
  const correlationId = body.correlationId || state;

  if (resolvedOrigin.redirected) {
    log.warn("oauth.connect.redirect_blocked", {
      uid: user.uid,
      requestOrigin: request.nextUrl.origin,
      origin,
      correlationId,
    });
  }

  await getAdminDb().collection("google_oauth_state").doc(state).set({
    uid: user.uid,
    returnTo,
    origin,
    scopePreset,
    workspaceId: body.workspaceId || null,
    businessId: body.businessId || null,
    correlationId,
    createdAt: FieldValue.serverTimestamp(),
  });

  const authUrl = getGoogleAuthUrl(state, { scopePreset });
  log.info("oauth.connect.init", {
    uid: user.uid,
    scopePreset,
    origin,
    workspaceId: body.workspaceId || null,
    businessId: body.businessId || null,
    correlationId,
  });

  return NextResponse.json({ authUrl });
}, { route: "google.connect" });
