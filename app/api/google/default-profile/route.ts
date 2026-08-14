import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, withApiHandler } from "@/lib/api/handler";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { readBoundedRequestBody } from "@/lib/api/bounded-body";
import {
  GoogleBusinessProfileContextError,
  resolveGoogleBusinessProfileContext,
} from "@/lib/google/business-profiles";
import { setGoogleDefaultProfileId } from "@/lib/google/account-token-store";

const bodySchema = z
  .object({
    businessId: z.string().trim().min(1).max(64),
    profileId: z.string().trim().min(1).max(64),
  })
  .strict();

async function parseBody(request: Request) {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim();
  if (contentType !== "application/json") {
    throw new ApiError(415, "Content-Type must be application/json.");
  }
  const raw = await readBoundedRequestBody(request, 2_048);
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

export const POST = withApiHandler(async ({ request, correlationId, log }) => {
  const user = await requireFirebaseAuth(request, log);
  if ([...request.nextUrl.searchParams.keys()].length > 0) {
    throw new ApiError(400, "Query parameters are not supported.");
  }
  const body = await parseBody(request);
  let profile;
  try {
    profile = resolveGoogleBusinessProfileContext(body);
  } catch (error) {
    if (error instanceof GoogleBusinessProfileContextError) {
      throw new ApiError(400, error.message);
    }
    throw error;
  }
  if (!profile) throw new ApiError(400, "A Google business profile is required.");

  try {
    await setGoogleDefaultProfileId(user.uid, profile.profileId);
  } catch {
    throw new ApiError(409, "That Google organization profile is not ready.");
  }

  log.info("google.oauth.default_profile_selected", {
    uid: user.uid,
    businessId: profile.businessId,
    profileId: profile.profileId,
    correlationId,
  });
  const response = NextResponse.json({
    success: true,
    businessId: profile.businessId,
    profileId: profile.profileId,
  });
  response.headers.set("cache-control", "private, no-store, max-age=0");
  response.headers.set("pragma", "no-cache");
  return response;
}, { route: "google.default-profile" });
