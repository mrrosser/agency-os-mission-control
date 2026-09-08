import { NextResponse } from "next/server";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { withApiHandler } from "@/lib/api/handler";
import { assertSecondBrainReviewerAllowed, requireSecondBrainOperatorUid } from "@/lib/second-brain-auth";
import { getSecondBrainSnapshot } from "@/lib/second-brain";

export const runtime = "nodejs";

export const GET = withApiHandler(
  async ({ request, log, correlationId }) => {
    const user = await requireFirebaseAuth(request, log);
    assertSecondBrainReviewerAllowed({ uid: user.uid, email: user.email });
    const operatorUid = requireSecondBrainOperatorUid();
    const snapshot = await getSecondBrainSnapshot(operatorUid);
    log.info("second_brain.snapshot", {
      uid: operatorUid,
      reviewerUid: user.uid,
      candidateCount: snapshot.candidates.length,
      pendingReviewCount: snapshot.candidates.filter((candidate) => candidate.status === "reviewable").length,
    });
    return NextResponse.json({ ...snapshot, correlationId });
  },
  { route: "agents.second-brain.get" }
);
