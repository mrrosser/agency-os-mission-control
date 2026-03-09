import { NextResponse } from "next/server";
import { ApiError, withApiHandler } from "@/lib/api/handler";
import { requireFirebaseAuth } from "@/lib/api/auth";
import {
  getAccessTokenForUser,
  getStoredGoogleTokens,
  googleCapabilitiesFromScopeString,
} from "@/lib/google/oauth";

export const GET = withApiHandler(async ({ request, log }) => {
  const user = await requireFirebaseAuth(request, log);
  const tokens = await getStoredGoogleTokens(user.uid);

  const scopeString = tokens?.scope || "";
  const tokenPresent = Boolean(tokens?.refreshToken || tokens?.accessToken);
  let connected = false;
  let reconnectRequired = false;
  let capabilities = googleCapabilitiesFromScopeString(scopeString);
  let normalizedScopes: string | null = scopeString || null;

  if (tokenPresent) {
    try {
      await getAccessTokenForUser(user.uid, log);
      connected = true;
    } catch (error) {
      if (error instanceof ApiError && error.status === 403) {
        reconnectRequired = true;
        capabilities = {
          drive: false,
          gmail: false,
          calendar: false,
        };
        normalizedScopes = null;
      } else {
        throw error;
      }
    }
  }

  return NextResponse.json({
    connected,
    reconnectRequired,
    scopes: normalizedScopes,
    capabilities,
  });
}, { route: "google.status" });
