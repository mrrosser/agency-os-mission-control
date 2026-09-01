import { createHash } from "crypto";
import { NextResponse } from "next/server";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { withApiHandler } from "@/lib/api/handler";
import { getIdempotencyKey, withIdempotency } from "@/lib/api/idempotency";
import { parseJson } from "@/lib/api/validation";
import { assertSecondBrainReviewerAllowed } from "@/lib/second-brain-auth";
import { confirmSecondBrainEmailAction } from "@/lib/second-brain";
import { SecondBrainEmailActionConfirmSchema } from "@/lib/second-brain-contract";

export const runtime = "nodejs";

export const POST = withApiHandler(
  async ({ request, log, correlationId }) => {
    const user = await requireFirebaseAuth(request, log);
    assertSecondBrainReviewerAllowed({ uid: user.uid, email: user.email });
    const body = await parseJson(request, SecondBrainEmailActionConfirmSchema);
    const stableKey = createHash("sha256").update(`${user.uid}:${body.token}:${body.reasonCode}`).digest("hex");
    const idempotencyKey = getIdempotencyKey(request, body) || stableKey;
    const result = await withIdempotency(
      { uid: user.uid, route: "agents.second-brain.email-action.confirm", key: idempotencyKey, log },
      () => confirmSecondBrainEmailAction({
        token: body.token,
        reasonCode: body.reasonCode,
        notes: body.notes,
        reviewerUid: user.uid,
        reviewerEmail: user.email || null,
        correlationId,
        idempotencyKey,
      })
    );
    log.info("second_brain.email_action.confirmed", {
      uid: user.uid,
      candidateId: result.data.candidateId,
      decision: result.data.decision,
      replayed: result.replayed,
    });
    return NextResponse.json({ ok: true, review: result.data, replayed: result.replayed, correlationId });
  },
  { route: "agents.second-brain.email-action.confirm" }
);
