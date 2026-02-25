import { NextResponse } from "next/server";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { withApiHandler } from "@/lib/api/handler";
import { getPosWorkerStatus } from "@/lib/revenue/pos-worker";

export const GET = withApiHandler(
  async ({ request, log, correlationId }) => {
    const user = await requireFirebaseAuth(request, log);
    const snapshot = await getPosWorkerStatus({
      uid: user.uid,
      log,
    });

    return NextResponse.json({
      ok: true,
      snapshot,
      correlationId,
    });
  },
  { route: "revenue.pos.status.get" }
);
