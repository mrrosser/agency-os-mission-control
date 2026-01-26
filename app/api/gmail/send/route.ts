import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/api/handler";
import { parseJson } from "@/lib/api/validation";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { getAccessTokenForUser } from "@/lib/google/oauth";
import { sendEmail } from "@/lib/google/gmail";
import { getIdempotencyKey, withIdempotency } from "@/lib/api/idempotency";
import { dbAdmin } from "@/lib/db-admin";

const emailSchema = z.object({
  to: z.array(z.string().email()).min(1),
  cc: z.array(z.string().email()).optional(),
  bcc: z.array(z.string().email()).optional(),
  subject: z.string().min(1),
  body: z.string().min(1),
  isHtml: z.boolean().optional(),
});

const bodySchema = z.object({
  email: emailSchema,
  idempotencyKey: z.string().optional(),
});

export const POST = withApiHandler(
  async ({ request, log }) => {
    const body = await parseJson(request, bodySchema);
    const user = await requireFirebaseAuth(request, log);
    const accessToken = await getAccessTokenForUser(user.uid, log);
    const idempotencyKey = getIdempotencyKey(request, body);

    const result = await withIdempotency(
      { uid: user.uid, route: "gmail.send", key: idempotencyKey, log },
      () => sendEmail(accessToken, body.email, log)
    );

    await dbAdmin.logActivity({
      userId: user.uid,
      action: "Email sent",
      details: body.email.subject,
      type: "email"
    });

    return NextResponse.json({
      success: true,
      messageId: result.data.id,
      threadId: result.data.threadId,
      replayed: result.replayed,
    });
  },
  { route: "gmail.send" }
);
