import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, withApiHandler } from "@/lib/api/handler";
import { parseJson } from "@/lib/api/validation";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { getIdempotencyKey, withIdempotency } from "@/lib/api/idempotency";
import { dbAdmin } from "@/lib/db-admin";
import { resolveSecret } from "@/lib/api/secrets";

const bodySchema = z.object({
  elevenLabsKey: z.string().optional(),
  text: z.string().min(1),
  voiceId: z.string().optional(),
  modelId: z.string().optional(),
  idempotencyKey: z.string().optional(),
});

export const POST = withApiHandler(
  async ({ request, log }) => {
    const body = await parseJson(request, bodySchema);
    const user = await requireFirebaseAuth(request, log);
    const idempotencyKey = getIdempotencyKey(request, body);

    const elevenLabsKey = await resolveSecret(user.uid, "elevenLabsKey", "ELEVENLABS_API_KEY");
    if (!elevenLabsKey) {
      throw new ApiError(400, "ElevenLabs API key is required");
    }

    const result = await withIdempotency(
      { uid: user.uid, route: "elevenlabs.synthesize", key: idempotencyKey, log },
      async () => {
        const voiceId = body.voiceId || "21m00Tcm4TlvDq8ikWAM";
        const modelId = body.modelId || "eleven_monolingual_v1";

        log.info("elevenlabs.synthesize", { voiceId });
        const response = await fetch(
          `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
          {
            method: "POST",
            headers: {
              Accept: "audio/mpeg",
              "Content-Type": "application/json",
              "xi-api-key": elevenLabsKey,
            },
            body: JSON.stringify({
              text: body.text,
              model_id: modelId,
              voice_settings: {
                stability: 0.5,
                similarity_boost: 0.75,
              },
            }),
          }
        );

        if (!response.ok) {
          const errorText = await response.text();
          throw new ApiError(502, `ElevenLabs API error: ${errorText}`);
        }

        const audioBuffer = await response.arrayBuffer();
        const base64Audio = Buffer.from(audioBuffer).toString("base64");

        return {
          audioBase64: base64Audio,
          mimeType: "audio/mpeg",
          voiceId,
        };
      }
    );

    await dbAdmin.logActivity({
      userId: user.uid,
      action: "Voice synthesized",
      details: `Voice ID: ${result.data.voiceId}`,
      type: "system"
    });

    return NextResponse.json({
      success: true,
      replayed: result.replayed,
      ...result.data,
    });
  },
  { route: "elevenlabs.synthesize" }
);
