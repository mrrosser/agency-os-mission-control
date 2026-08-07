import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/api/handler";
import { parseJson } from "@/lib/api/validation";
import { runPosOutboxCycle, runPosWorkerCycle } from "@/lib/revenue/pos-worker";
import {
  authorizeRevenueAutomationWorker,
  resolveRevenueAutomationWorkerUid,
} from "@/lib/revenue/worker-auth";

const bodySchema = z.object({
  uid: z.string().trim().min(1).max(128).optional(),
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

export const POST = withApiHandler(
  async ({ request, log, correlationId }) => {
    const auth = await authorizeRevenueAutomationWorker({ request, correlationId, log });
    const body = await parseJson(request, bodySchema);
    const uid = resolveRevenueAutomationWorkerUid(body.uid);

    const cycle = await runPosWorkerCycle({
      uid,
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
          uid,
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
      authMode: auth.mode,
      correlationId,
    });
  },
  { route: "revenue.pos.worker-task.post" }
);
