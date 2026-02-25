import { NextResponse } from "next/server";
import { z } from "zod";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { getIdempotencyKey, withIdempotency } from "@/lib/api/idempotency";
import { withApiHandler } from "@/lib/api/handler";
import { parseJson } from "@/lib/api/validation";
import { setPosWorkerApproval } from "@/lib/revenue/pos-worker";

const ACTION_KINDS = [
  "payment.lifecycle.track",
  "invoice.lifecycle.track",
  "invoice.followup.queue",
  "refund.lifecycle.track",
  "refund.review.queue",
  "order.lifecycle.track",
] as const;

const bodySchema = z.object({
  eventId: z.string().trim().min(1).max(200),
  actionKind: z.enum(ACTION_KINDS),
  approved: z.boolean(),
  note: z.string().trim().max(500).optional(),
  idempotencyKey: z.string().trim().min(1).max(200).optional(),
});

export const POST = withApiHandler(
  async ({ request, log, correlationId }) => {
    const user = await requireFirebaseAuth(request, log);
    const body = await parseJson(request, bodySchema);
    const idempotencyKey = getIdempotencyKey(request, body);

    const result = await withIdempotency(
      {
        uid: user.uid,
        route: "revenue.pos.approvals.post",
        key: idempotencyKey,
        log,
      },
      async () => {
        await setPosWorkerApproval({
          uid: user.uid,
          eventId: body.eventId,
          actionKind: body.actionKind,
          approved: body.approved,
          note: body.note,
          actorUid: user.uid,
          correlationId,
        });

        return {
          ok: true,
          eventId: body.eventId,
          actionKind: body.actionKind,
          approved: body.approved,
        };
      }
    );

    return NextResponse.json({
      ...result.data,
      replayed: result.replayed,
      correlationId,
    });
  },
  { route: "revenue.pos.approvals.post" }
);
