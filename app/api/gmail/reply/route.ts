import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/api/handler";
import { parseJson } from "@/lib/api/validation";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { getAccessTokenForUser } from "@/lib/google/oauth";
import { replyToMessage } from "@/lib/google/gmail";
import { getIdempotencyKey, withIdempotency } from "@/lib/api/idempotency";

const bodySchema = z.object({
  messageId: z.string().min(1),
  threadId: z.string().min(1),
  replyBody: z.string().min(1),
  isHtml: z.boolean().optional(),
  idempotencyKey: z.string().optional(),
});

export const POST = withApiHandler(
  async ({ request, log }) => {
    const body = await parseJson(request, bodySchema);
    const user = await requireFirebaseAuth(request, log);
    const accessToken = await getAccessTokenForUser(user.uid, log);
    const idempotencyKey = getIdempotencyKey(request, body);

    const result = await withIdempotency(
      { uid: user.uid, route: "gmail.reply", key: idempotencyKey, log },
      () =>
        replyToMessage(
          accessToken,
          body.messageId,
          body.threadId,
          body.replyBody,
          body.isHtml || false,
          log
        )
    );

    return NextResponse.json({
      success: true,
      messageId: result.data.id,
      threadId: result.data.threadId,
      replayed: result.replayed,
    });
  },
  { route: "gmail.reply" }
);
