import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, withApiHandler } from "@/lib/api/handler";
import { parseJson } from "@/lib/api/validation";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { getIdempotencyKey, withIdempotency } from "@/lib/api/idempotency";
import { resolveSecret } from "@/lib/api/secrets";

const bodySchema = z.object({
  heyGenKey: z.string().optional(),
  script: z.string().min(1),
  avatarId: z.string().optional(),
  voiceId: z.string().optional(),
  idempotencyKey: z.string().optional(),
});

export const POST = withApiHandler(
  async ({ request, log }) => {
    const body = await parseJson(request, bodySchema);
    const user = await requireFirebaseAuth(request, log);
    const idempotencyKey = getIdempotencyKey(request, body);

    const heyGenKey = await resolveSecret(user.uid, "heyGenKey", "HEYGEN_API_KEY");
    if (!heyGenKey) {
      throw new ApiError(400, "HeyGen API key is required");
    }

    const result = await withIdempotency(
      { uid: user.uid, route: "heygen.create-avatar", key: idempotencyKey, log },
      async () => {
        log.info("heygen.create", { avatarId: body.avatarId || "default_avatar" });
        const response = await fetch("https://api.heygen.com/v1/video.generate", {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            "X-Api-Key": heyGenKey,
          },
          body: JSON.stringify({
            video_inputs: [
              {
                character: {
                  type: "avatar",
                  avatar_id: body.avatarId || "default_avatar",
                },
                voice: {
                  type: "text",
                  input_text: body.script,
                  voice_id: body.voiceId || "en-US-Neural2-J",
                },
              },
            ],
            dimension: {
              width: 1920,
              height: 1080,
            },
          }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new ApiError(502, `HeyGen API error: ${errorText}`);
        }

        const payload = await response.json();
        return {
          videoId: payload.data?.video_id,
          status: payload.data?.status || "processing",
        };
      }
    );

    return NextResponse.json({
      success: true,
      replayed: result.replayed,
      videoId: result.data.videoId,
      status: result.data.status,
      message:
        "Avatar video generation started. Use /api/heygen/get-status to check progress.",
    });
  },
  { route: "heygen.create-avatar" }
);
