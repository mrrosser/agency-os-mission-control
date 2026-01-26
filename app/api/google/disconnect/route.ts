import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api/handler";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { revokeGoogleTokens } from "@/lib/google/oauth";

export const POST = withApiHandler(async ({ request, log }) => {
  const user = await requireFirebaseAuth(request, log);
  await revokeGoogleTokens(user.uid, log);

  return NextResponse.json({ success: true });
}, { route: "google.disconnect" });
