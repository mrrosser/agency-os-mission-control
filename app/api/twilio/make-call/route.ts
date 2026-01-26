import { NextResponse } from "next/server";
import twilio from "twilio";
import { z } from "zod";
import { ApiError, withApiHandler } from "@/lib/api/handler";
import { parseJson } from "@/lib/api/validation";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { getIdempotencyKey, withIdempotency } from "@/lib/api/idempotency";
import { resolveSecret } from "@/lib/api/secrets";

const bodySchema = z.object({
  twilioSid: z.string().optional(),
  twilioToken: z.string().optional(),
  to: z.string().min(1),
  from: z.string().optional(),
  audioUrl: z.string().url(),
  idempotencyKey: z.string().optional(),
});

export const POST = withApiHandler(
  async ({ request, log }) => {
    const body = await parseJson(request, bodySchema);
    const user = await requireFirebaseAuth(request, log);
    const idempotencyKey = getIdempotencyKey(request, body);

    const twilioSid = await resolveSecret(user.uid, "twilioSid", "TWILIO_ACCOUNT_SID");
    const twilioToken = await resolveSecret(user.uid, "twilioToken", "TWILIO_AUTH_TOKEN");
    const twilioFrom = body.from || await resolveSecret(user.uid, "twilioSid", "TWILIO_PHONE_NUMBER"); // Approximation

    if (!twilioSid || !twilioToken || !twilioFrom) {
      throw new ApiError(400, "Twilio SID, Token, and Phone Number (from) are required");
    }

    const result = await withIdempotency(
      { uid: user.uid, route: "twilio.make-call", key: idempotencyKey, log },
      async () => {
        log.info("twilio.call.create", { to: body.to });
        const client = twilio(twilioSid, twilioToken);
        const call = await client.calls.create({
          twiml: `<Response><Play>${body.audioUrl}</Play></Response>`,
          to: body.to,
          from: twilioFrom,
        });
        return {
          callSid: call.sid,
          status: call.status,
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
