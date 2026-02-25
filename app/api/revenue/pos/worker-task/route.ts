import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, withApiHandler } from "@/lib/api/handler";
import { parseJson } from "@/lib/api/validation";
import { runPosOutboxCycle, runPosWorkerCycle } from "@/lib/revenue/pos-worker";

const bodySchema = z.object({
  uid: z.string().trim().min(1).max(128),
  workerId: z.string().trim().min(1).max(128).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  leaseSeconds: z.coerce.number().int().min(15).max(300).optional(),
  maxAttempts: z.coerce.number().int().min(1).max(20).optional(),
  executeOutbox: z.boolean().optional(),
  outboxLimit: z.coerce.number().int().min(1).max(100).optional(),
  outboxLeaseSeconds: z.coerce.number().int().min(15).max(300).optional(),
  outboxMaxAttempts: z.coerce.number().int().min(1).max(20).optional(),
});

function readBoolEnv(name: string, fallback: boolean): boolean {
  const normalized = String(process.env[name] || "").trim().toLowerCase();
  if (!normalized) return fallback;
  if (normalized === "true" || normalized === "1" || normalized === "yes") return true;
  if (normalized === "false" || normalized === "0" || normalized === "no") return false;
  return fallback;
}

function readBearerToken(request: Request): string {
  const auth = request.headers.get("authorization") || "";
  if (!auth.toLowerCase().startsWith("bearer ")) return "";
  return auth.slice(7).trim();
}

function authorizeWorker(request: Request): void {
  const expected = String(process.env.REVENUE_POS_WORKER_TOKEN || "").trim();
  if (!expected) {
    throw new ApiError(503, "REVENUE_POS_WORKER_TOKEN is not configured");
  }

  const candidate =
    String(request.headers.get("x-revenue-pos-token") || "").trim() || readBearerToken(request);
  if (!candidate || candidate !== expected) {
    throw new ApiError(403, "Forbidden");
  }
}

export const POST = withApiHandler(
  async ({ request, log, correlationId }) => {
    authorizeWorker(request);
    const body = await parseJson(request, bodySchema);

    const cycle = await runPosWorkerCycle({
      uid: body.uid,
      workerId: body.workerId,
      limit: body.limit,
      leaseSeconds: body.leaseSeconds,
      maxAttempts: body.maxAttempts,
      correlationId,
      log,
    });
    const executeOutbox = body.executeOutbox ?? readBoolEnv("POS_WORKER_EXECUTE_OUTBOX", false);
    const outboxCycle = executeOutbox
      ? await runPosOutboxCycle({
          uid: body.uid,
          workerId: body.workerId,
          limit: body.outboxLimit,
          leaseSeconds: body.outboxLeaseSeconds,
          maxAttempts: body.outboxMaxAttempts,
          correlationId,
          log,
        })
      : null;

    return NextResponse.json({
      ok: true,
      cycle,
      outboxCycle,
      correlationId,
    });
  },
  { route: "revenue.pos.worker-task.post" }
);
