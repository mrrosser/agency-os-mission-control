import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api/handler";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { getAccessTokenForUser } from "@/lib/google/oauth";
import { getThread } from "@/lib/google/gmail";

export const GET = withApiHandler(
    async ({ request, params, log }) => {
        const threadId = params?.threadId;
        const user = await requireFirebaseAuth(request, log);
        const accessToken = await getAccessTokenForUser(user.uid, log);

        if (!threadId) {
            return NextResponse.json({ error: "Missing thread ID" }, { status: 400 });
        }

        const result = await getThread(accessToken, threadId, log);
        return NextResponse.json(result);
    },
    { route: "gmail.thread" }
);
