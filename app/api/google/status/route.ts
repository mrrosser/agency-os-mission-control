import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api/handler";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { getStoredGoogleTokens } from "@/lib/google/oauth";

export const GET = withApiHandler(async ({ request, log }) => {
  const user = await requireFirebaseAuth(request, log);
  const tokens = await getStoredGoogleTokens(user.uid);

  const scopeString = tokens?.scope || "";
  const scopes = scopeString
    .split(" ")
    .map((value) => value.trim())
    .filter(Boolean);

  const capabilities = {
    drive: scopes.some((s) => s.includes("/auth/drive")),
    gmail: scopes.some((s) => s.includes("/auth/gmail")),
    calendar: scopes.some((s) => s.includes("/auth/calendar")),
  };

  return NextResponse.json({
    connected: Boolean(tokens?.refreshToken || tokens?.accessToken),
    scopes: scopeString || null,
    capabilities,
  });
}, { route: "google.status" });
