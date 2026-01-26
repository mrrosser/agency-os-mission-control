import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, withApiHandler } from "@/lib/api/handler";
import { parseJson } from "@/lib/api/validation";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { resolveSecret } from "@/lib/api/secrets";

const bodySchema = z.object({
  heyGenKey: z.string().optional(),
  videoId: z.string().min(1),
});

export const POST = withApiHandler(
  async ({ request, log }) => {
    const body = await parseJson(request, bodySchema);
    const user = await requireFirebaseAuth(request, log);

    const heyGenKey = await resolveSecret(user.uid, "heyGenKey", "HEYGEN_API_KEY");
    if (!heyGenKey) {
      throw new ApiError(400, "HeyGen API key is required");
    }

    log.info("heygen.status", { videoId: body.videoId });
    const response = await fetch(
      `https://api.heygen.com/v1/video_status.get?video_id=${body.videoId}`,
      {
        method: "GET",
        headers: {
          Accept: "application/json",
          "X-Api-Key": heyGenKey,
        },
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new ApiError(502, `HeyGen API error: ${errorText}`);
    }

    const result = await response.json();

    return NextResponse.json({
      success: true,
      videoId: body.videoId,
      status: result.data?.status,
      videoUrl: result.data?.video_url,
      thumbnailUrl: result.data?.thumbnail_url,
      duration: result.data?.duration,
    });
  },
  { route: "heygen.get-status" }
);
