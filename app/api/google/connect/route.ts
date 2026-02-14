import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/api/handler";
import { parseJson } from "@/lib/api/validation";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { getAdminDb } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { getGoogleAuthUrl } from "@/lib/google/oauth";

const bodySchema = z.object({
  returnTo: z.string().optional(),
  scopePreset: z.enum(["core", "drive", "calendar", "gmail", "full"]).optional(),
});

export const POST = withApiHandler(async ({ request, log }) => {
  const body = await parseJson(request, bodySchema);
  const user = await requireFirebaseAuth(request, log);
  const state = randomUUID();
  const returnTo = body.returnTo || "/dashboard/integrations";
  const origin = request.nextUrl.origin;
  const scopePreset = body.scopePreset || "full";

  await getAdminDb().collection("google_oauth_state").doc(state).set({
    uid: user.uid,
    returnTo,
    origin,
    scopePreset,
    createdAt: FieldValue.serverTimestamp(),
  });

  const authUrl = getGoogleAuthUrl(state, { scopePreset });
  log.info("google.oauth.connect", { uid: user.uid, scopePreset });

  return NextResponse.json({ authUrl });
}, { route: "google.connect" });
