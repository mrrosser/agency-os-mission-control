import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/api/handler";
import { parseJson } from "@/lib/api/validation";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { getAccessTokenForUser } from "@/lib/google/oauth";
import { getInboxMessages } from "@/lib/google/gmail";

const bodySchema = z.object({
  maxResults: z.number().int().min(1).max(100).optional(),
  pageToken: z.string().optional(),
});

export const POST = withApiHandler(
  async ({ request, log }) => {
    const body = await parseJson(request, bodySchema);
    log.info("inbox.request_parsed", { maxResults: body.maxResults });

    const user = await requireFirebaseAuth(request, log);
    log.info("inbox.auth_verified", { uid: user.uid });

    let accessToken: string;
    try {
      accessToken = await getAccessTokenForUser(user.uid, log);
      log.info("inbox.token_retrieved", { uid: user.uid });
    } catch (error: any) {
      log.warn("inbox.token_failed", {
        uid: user.uid,
        error: error.message,
        status: error.status
      });
      throw error;
    }

    const result = await getInboxMessages(
      accessToken,
      body.maxResults || 10,
      body.pageToken,
      log
    );

    log.info("inbox.messages_retrieved", { count: result.messages?.length || 0 });
    return NextResponse.json(result);
  },
  { route: "gmail.inbox" }
);
