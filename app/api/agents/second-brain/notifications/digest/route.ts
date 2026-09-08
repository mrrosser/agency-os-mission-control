import { createHash } from "crypto";
import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api/handler";
import { withIdempotency } from "@/lib/api/idempotency";
import { parseJson } from "@/lib/api/validation";
import { assertSecondBrainOperatorUid, authorizeSecondBrainService } from "@/lib/second-brain-auth";
import { SecondBrainDigestRequestSchema } from "@/lib/second-brain-contract";
import { dispatchSecondBrainDigest } from "@/lib/second-brain-email";

export const runtime = "nodejs";

export const POST = withApiHandler(
  async ({ request, log, correlationId }) => {
    await authorizeSecondBrainService({ request, log, route: "agents.second-brain.notifications.digest" });
    const body = await parseJson(request, SecondBrainDigestRequestSchema);
    const operatorUid = assertSecondBrainOperatorUid(body.uid);
    const digestDate = body.digestDate || new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(new Date());
    const stableKey = createHash("sha256").update(`${operatorUid}:${digestDate}:${(body.candidateIds || []).join(":")}`).digest("hex");
    const idempotencyKey = stableKey;
    const result = await withIdempotency(
      { uid: operatorUid, route: "agents.second-brain.notifications.digest", key: idempotencyKey, log },
      () => dispatchSecondBrainDigest({ request: { ...body, uid: operatorUid, digestDate }, correlationId, idempotencyKey, log })
    );
    return NextResponse.json({ ok: true, ...result.data, replayed: result.replayed, correlationId });
  },
  { route: "agents.second-brain.notifications.digest" }
);
