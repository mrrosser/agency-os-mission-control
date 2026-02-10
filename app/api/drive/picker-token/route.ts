import { NextResponse } from "next/server";
import { ApiError, withApiHandler } from "@/lib/api/handler";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { getAccessTokenForUser } from "@/lib/google/oauth";

function parseFirebaseProjectNumber(): string | null {
  const raw = process.env.__FIREBASE_DEFAULTS__;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { config?: { projectNumber?: string | number } };
    const projectNumber = parsed?.config?.projectNumber;
    if (typeof projectNumber === "string") return projectNumber;
    if (typeof projectNumber === "number") return String(projectNumber);
    return null;
  } catch {
    return null;
  }
}

/**
 * Returns a short-lived Google OAuth access token + config needed to launch the
 * Google Drive Picker (Google-native browsing/search UI).
 *
 * Note: the OAuth token is user-scoped and short-lived; keep refresh tokens server-side.
 */
export const GET = withApiHandler(
  async ({ request, log }) => {
    const user = await requireFirebaseAuth(request, log);

    const pickerApiKey = process.env.GOOGLE_PICKER_API_KEY;
    if (!pickerApiKey) {
      throw new ApiError(500, "Missing GOOGLE_PICKER_API_KEY");
    }

    const accessToken = await getAccessTokenForUser(user.uid, log);

    const appId =
      process.env.GOOGLE_DRIVE_APP_ID || parseFirebaseProjectNumber() || null;

    // NextRequest provides request.nextUrl, but tests and some runtimes may pass a plain Request.
    const origin = (() => {
      const anyReq = request as unknown as { nextUrl?: { origin?: string } };
      const nextOrigin = anyReq.nextUrl?.origin;
      if (nextOrigin) return nextOrigin;
      try {
        return new URL(request.url).origin;
      } catch {
        return "";
      }
    })();

    return NextResponse.json({
      accessToken,
      pickerApiKey,
      appId,
      origin,
    });
  },
  { route: "drive.picker-token" }
);
