import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/api/handler";
import { parseJson } from "@/lib/api/validation";
import { evaluateDailyOutcomesForRevenueWorker } from "@/lib/revenue/daily-outcome-worker";
import {
  authorizeRevenueAutomationWorker,
  resolveRevenueAutomationWorkerUid,
} from "@/lib/revenue/worker-auth";

const bodySchema = z.object({}).strict();

export const dynamic = "force-dynamic";

export const POST = withApiHandler(
  async ({ request, correlationId, log }) => {
    const auth = await authorizeRevenueAutomationWorker({ request, correlationId, log });
    await parseJson(request, bodySchema);
    const uid = resolveRevenueAutomationWorkerUid();
    const dashboard = await evaluateDailyOutcomesForRevenueWorker({
      uid,
      correlationId,
      log,
    });

    return NextResponse.json({
      ok: true,
      ...dashboard,
      authMode: auth.mode,
      correlationId,
    });
  },
  { route: "revenue.daily_outcomes.worker_task.post" }
);
