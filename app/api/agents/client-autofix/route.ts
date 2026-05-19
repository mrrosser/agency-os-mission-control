import { NextResponse } from "next/server";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { ApiError, withApiHandler } from "@/lib/api/handler";
import { withIdempotency } from "@/lib/api/idempotency";
import {
  listClientAutofixRuns,
  queueClientAutofixRun,
} from "@/lib/client-autofix";

export const runtime = "nodejs";

export const GET = withApiHandler(
  async ({ request, log }) => {
    const user = await requireFirebaseAuth(request, log);
    const requestUrl = new URL(request.url);
    const limitParam = requestUrl.searchParams.get("limit");
    const limit = limitParam ? Number.parseInt(limitParam, 10) : 25;
    const runs = await listClientAutofixRuns(Number.isFinite(limit) ? limit : 25);

    log.info("agents.client_autofix.history", {
      uid: user.uid,
      runCount: runs.length,
    });

    return NextResponse.json({
      status: "ok",
      runs,
    });
  },
  { route: "agents.client-autofix.get" }
);

export const POST = withApiHandler(
  async ({ request, correlationId, log }) => {
    const user = await requireFirebaseAuth(request, log);
    const payload = await request.json().catch(() => {
      throw new ApiError(400, "Invalid JSON body");
    });
    const idempotencyKey =
      request.headers.get("x-idempotency-key") ||
      (typeof payload === "object" && payload !== null
        ? String((payload as Record<string, unknown>).idempotency_key || "")
        : "") ||
      null;
    const result = await withIdempotency(
      {
        uid: user.uid,
        route: "agents.client-autofix.post",
        key: idempotencyKey,
        log,
      },
      async () =>
        queueClientAutofixRun({
          payload,
          correlationId,
          requestedByUid: user.uid,
          log,
        })
    );
    const run = result.data;

    return NextResponse.json({
      status: run.status,
      run,
      replayed: result.replayed,
      correlationId,
    });
  },
  { route: "agents.client-autofix.post" }
);
