import { NextResponse } from "next/server";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { withApiHandler } from "@/lib/api/handler";
import { assertSecondBrainReviewerAllowed } from "@/lib/second-brain-auth";
import { inspectSecondBrainEmailAction } from "@/lib/second-brain";

export const runtime = "nodejs";

export const GET = withApiHandler(
  async ({ request, log, correlationId }) => {
    const user = await requireFirebaseAuth(request, log);
    assertSecondBrainReviewerAllowed({ uid: user.uid, email: user.email });
    const token = new URL(request.url).searchParams.get("token")?.trim() || "";
    if (token.length < 32) return NextResponse.json({ error: "token is required", correlationId }, { status: 400 });
    const action = await inspectSecondBrainEmailAction({ token, reviewerUid: user.uid, reviewerEmail: user.email || null });
    return NextResponse.json({ ...action, correlationId });
  },
  { route: "agents.second-brain.email-action.inspect" }
);
