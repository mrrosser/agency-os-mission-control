import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api/handler";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { getStoredGoogleTokens } from "@/lib/google/oauth";

export const GET = withApiHandler(async ({ request, log }) => {
  const user = await requireFirebaseAuth(request, log);
  const tokens = await getStoredGoogleTokens(user.uid);

  return NextResponse.json({
    connected: Boolean(tokens?.refreshToken || tokens?.accessToken),
    scopes: tokens?.scope || null,
  });
}, { route: "google.status" });
