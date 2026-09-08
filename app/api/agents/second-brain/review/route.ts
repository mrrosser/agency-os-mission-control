import { createHash } from "crypto";
import { NextResponse } from "next/server";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { withApiHandler } from "@/lib/api/handler";
import { getIdempotencyKey, withIdempotency } from "@/lib/api/idempotency";
import { parseJson } from "@/lib/api/validation";
import { assertSecondBrainReviewerAllowed, requireSecondBrainOperatorUid } from "@/lib/second-brain-auth";
import { recordSecondBrainReview } from "@/lib/second-brain";
import { SecondBrainReviewRequestSchema } from "@/lib/second-brain-contract";

export const runtime = "nodejs";

export const POST = withApiHandler(
  async ({ request, log, correlationId }) => {
    const user = await requireFirebaseAuth(request, log);
    assertSecondBrainReviewerAllowed({ uid: user.uid, email: user.email });
    const operatorUid = requireSecondBrainOperatorUid();
    const body = await parseJson(request, SecondBrainReviewRequestSchema);
    const stableKey = createHash("sha256")
      .update(`${user.uid}:${body.candidateId}:${body.candidateHash}:${body.decision}:${body.reasonCode}`)
      .digest("hex");
    const idempotencyKey = getIdempotencyKey(request, body) || stableKey;
    const result = await withIdempotency(
      { uid: operatorUid, route: "agents.second-brain.review", key: idempotencyKey, log },
      () => recordSecondBrainReview({
        uid: operatorUid,
        candidateId: body.candidateId,
        candidateHash: body.candidateHash,
        decision: body.decision,
        reasonCode: body.reasonCode,
        notes: body.notes,
        reviewerUid: user.uid,
        reviewerEmail: user.email || null,
        correlationId,
        idempotencyKey,
      })
    );
    log.info("second_brain.review.recorded", {
      uid: operatorUid,
      reviewerUid: user.uid,
      candidateId: body.candidateId,
      decision: body.decision,
      replayed: result.replayed,
    });
    return NextResponse.json({ ok: true, review: result.data, replayed: result.replayed, correlationId });
  },
  { route: "agents.second-brain.review" }
);
