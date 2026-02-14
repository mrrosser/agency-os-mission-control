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
  twilioPhoneNumber: z.string().optional(),
  to: z.string().min(1),
  from: z.string().optional(),
  message: z.string().min(1),
  idempotencyKey: z.string().optional(),
});

export const POST = withApiHandler(
  async ({ request, log }) => {
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
      { uid: user.uid, route: "twilio.send-sms", key: idempotencyKey, log },
      async () => {
        log.info("twilio.sms.send", { to: body.to });
        const client = twilio(twilioSid, twilioToken);
        const message = await client.messages.create({
          body: body.message,
          to: body.to,
          from: twilioFrom,
        });
        return {
          messageSid: message.sid,
          status: message.status,
          to: message.to,
          from: message.from,
        };
      }
    );

    return NextResponse.json({
      success: true,
      replayed: result.replayed,
      ...result.data,
    });
  },
  { route: "twilio.send-sms" }
);
