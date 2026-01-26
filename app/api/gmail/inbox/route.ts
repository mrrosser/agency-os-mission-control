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
    const user = await requireFirebaseAuth(request, log);
    const accessToken = await getAccessTokenForUser(user.uid, log);

    const result = await getInboxMessages(
      accessToken,
      body.maxResults || 10,
      body.pageToken,
      log
    );

    return NextResponse.json(result);
  },
  { route: "gmail.inbox" }
);
