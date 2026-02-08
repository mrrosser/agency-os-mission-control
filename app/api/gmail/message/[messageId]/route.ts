import { NextResponse } from "next/server";
import { ApiError, withApiHandler } from "@/lib/api/handler";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { getAccessTokenForUser } from "@/lib/google/oauth";
import { getMessage } from "@/lib/google/gmail";

export const GET = withApiHandler(
  async ({ request, params, log }) => {
    const messageId = params?.messageId;
    if (!messageId) {
      throw new ApiError(400, "Missing message ID");
    }

    const user = await requireFirebaseAuth(request, log);
    const accessToken = await getAccessTokenForUser(user.uid, log);
    const message = await getMessage(accessToken, messageId, log);

    return NextResponse.json(message);
  },
  { route: "gmail.message" }
);

