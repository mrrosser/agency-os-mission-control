import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/api/handler";
import { parseJson } from "@/lib/api/validation";
import { runWeeklyKpiRollup } from "@/lib/revenue/weekly-kpi";
import {
  authorizeRevenueAutomationWorker,
  resolveRevenueAutomationWorkerUid,
} from "@/lib/revenue/worker-auth";

const bodySchema = z.object({
  uid: z.string().trim().min(1).max(128).optional(),
  timeZone: z.string().trim().min(1).max(80).optional(),
  weekStartDate: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

export const POST = withApiHandler(
  async ({ request, log, correlationId }) => {
    const auth = await authorizeRevenueAutomationWorker({ request, correlationId, log });
    const body = await parseJson(request, bodySchema);
    const uid = resolveRevenueAutomationWorkerUid(body.uid);

    const report = await runWeeklyKpiRollup({
      uid,
      timeZone: body.timeZone,
      weekStartDate: body.weekStartDate,
      log,
    });

    return NextResponse.json({
      ok: true,
      report,
      authMode: auth.mode,
      correlationId,
    });
  },
  { route: "revenue.kpi.weekly.worker-task.post" }
);
