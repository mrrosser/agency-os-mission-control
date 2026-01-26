import type { NextRequest } from "next/server";
import { ApiError } from "@/lib/api/handler";
import { getAdminAuth } from "@/lib/firebase-admin";
import type { Logger } from "@/lib/logging";

export async function requireFirebaseAuth(request: NextRequest, log?: Logger) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    throw new ApiError(401, "Missing Authorization header");
  }

  const idToken = authHeader.slice("Bearer ".length).trim();
  if (!idToken) {
    throw new ApiError(401, "Missing ID token");
  }

  try {
    const decoded = await getAdminAuth().verifyIdToken(idToken);
    log?.info("auth.verified", { uid: decoded.uid });
    return decoded;
  } catch (error) {
    log?.warn("auth.failed", { reason: "invalid_id_token" });
    throw new ApiError(401, "Invalid ID token");
  }
}
