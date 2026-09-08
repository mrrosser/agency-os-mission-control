import { createHash } from "crypto";
import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api/handler";
import { withIdempotency } from "@/lib/api/idempotency";
import { parseJson } from "@/lib/api/validation";
import { assertSecondBrainOperatorUid, authorizeSecondBrainService } from "@/lib/second-brain-auth";
import { SecondBrainUrgentRequestSchema } from "@/lib/second-brain-contract";
import { dispatchSecondBrainUrgent } from "@/lib/second-brain-email";

export const runtime = "nodejs";

export const POST = withApiHandler(
  async ({ request, log, correlationId }) => {
    await authorizeSecondBrainService({ request, log, route: "agents.second-brain.notifications.urgent" });
    const body = await parseJson(request, SecondBrainUrgentRequestSchema);
    const operatorUid = assertSecondBrainOperatorUid(body.uid);
    const stableKey = createHash("sha256").update(`${operatorUid}:${body.eventId}:${body.eventType}`).digest("hex");
    const idempotencyKey = stableKey;
    const result = await withIdempotency(
      { uid: operatorUid, route: "agents.second-brain.notifications.urgent", key: idempotencyKey, log },
      () => dispatchSecondBrainUrgent({ request: { ...body, uid: operatorUid }, correlationId, idempotencyKey, log })
    );
    return NextResponse.json({ ok: true, ...result.data, replayed: result.replayed, correlationId });
  },
  { route: "agents.second-brain.notifications.urgent" }
);
