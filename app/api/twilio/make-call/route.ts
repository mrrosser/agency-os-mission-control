import { NextResponse } from "next/server";
import twilio from "twilio";
import { z } from "zod";
import { ApiError, withApiHandler } from "@/lib/api/handler";
import { parseJson } from "@/lib/api/validation";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { getIdempotencyKey, withIdempotency } from "@/lib/api/idempotency";
import { resolveSecret } from "@/lib/api/secrets";
import { createHostedCallAudio } from "@/lib/voice/call-audio";
import { getAdminDb } from "@/lib/firebase-admin";

const bodySchema = z.object({
  twilioSid: z.string().optional(),
  twilioToken: z.string().optional(),
  twilioPhoneNumber: z.string().optional(),
  to: z.string().min(1),
  from: z.string().optional(),
  audioUrl: z.string().url().optional(),
  text: z.string().trim().min(1).max(700).optional(),
  businessKey: z.string().trim().min(1).max(40).optional(),
  voiceId: z.string().trim().min(1).max(120).optional(),
  modelId: z.string().trim().min(1).max(120).optional(),
  idempotencyKey: z.string().optional(),
}).superRefine((value, ctx) => {
  if (!value.audioUrl && !value.text) {
    ctx.addIssue({
      code: "custom",
      path: ["audioUrl"],
      message: "audioUrl or text is required",
    });
  }
});

export const POST = withApiHandler(
  async ({ request, log, correlationId }) => {
    const body = await parseJson(request, bodySchema);
    const user = await requireFirebaseAuth(request, log);
    const idempotencyKey = getIdempotencyKey(request, body);

    const twilioSid = await resolveSecret(user.uid, "twilioSid", "TWILIO_ACCOUNT_SID");
    const twilioToken = await resolveSecret(user.uid, "twilioToken", "TWILIO_AUTH_TOKEN");
    const twilioFrom =
      body.from ||
      body.twilioPhoneNumber ||
      (await resolveSecret(user.uid, "twilioPhoneNumber", "TWILIO_PHONE_NUMBER"));

    if (!twilioSid || !twilioToken || !twilioFrom) {
      throw new ApiError(400, "Twilio SID, Token, and Phone Number (from) are required");
    }

    const result = await withIdempotency(
      { uid: user.uid, route: "twilio.make-call", key: idempotencyKey, log },
      async () => {
        let audioUrl = body.audioUrl;
        let clipId: string | undefined;
        let voiceId: string | undefined;
        let modelId: string | undefined;

        if (!audioUrl) {
          const elevenLabsKey = await resolveSecret(user.uid, "elevenLabsKey", "ELEVENLABS_API_KEY");
          if (!elevenLabsKey) {
            throw new ApiError(400, "ElevenLabs API key is required for text-to-call");
          }

          let configuredVoiceId: string | undefined;
          let configuredModelId: string | undefined;
          if (!body.voiceId || !body.modelId) {
            const identitySnap = await getAdminDb().collection("identities").doc(user.uid).get();
            const identity = identitySnap.data() || {};
            const profiles = (identity.voiceProfiles || {}) as Record<
              string,
              { voiceId?: string; modelId?: string }
            >;
            const businessKey = String(body.businessKey || "")
              .trim()
              .toLowerCase();
            const profile = (businessKey && profiles[businessKey]) || profiles.default || {};
            configuredVoiceId = typeof profile.voiceId === "string" ? profile.voiceId : undefined;
            configuredModelId = typeof profile.modelId === "string" ? profile.modelId : undefined;
          }

          const origin = request.nextUrl?.origin || new URL(request.url).origin;
          const hosted = await createHostedCallAudio(
            {
              uid: user.uid,
              elevenLabsKey,
              origin,
              text: body.text || "",
              businessKey: body.businessKey,
              voiceId: body.voiceId || configuredVoiceId,
              modelId: body.modelId || configuredModelId,
              correlationId,
            },
            log
          );
          audioUrl = hosted.audioUrl;
          clipId = hosted.clipId;
          voiceId = hosted.voiceId;
          modelId = hosted.modelId;
        }

        log.info("twilio.call.create", {
          to: body.to,
          mode: "play",
          clipId: clipId || null,
          voiceId: voiceId || null,
        });
        const client = twilio(twilioSid, twilioToken);
        const call = await client.calls.create({
          twiml: `<Response><Play>${audioUrl}</Play></Response>`,
          to: body.to,
          from: twilioFrom,
        });
        return {
          callSid: call.sid,
          status: call.status,
          audioUrl,
          clipId,
          voiceId,
          modelId,
        };
      }
    );

    return NextResponse.json({
      success: true,
      replayed: result.replayed,
      ...result.data,
    });
  },
  { route: "twilio.make-call" }
);
