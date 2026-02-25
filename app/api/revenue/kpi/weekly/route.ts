import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/api/handler";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { parseJson } from "@/lib/api/validation";
import { runWeeklyKpiRollup } from "@/lib/revenue/weekly-kpi";

const bodySchema = z.object({
  timeZone: z.string().trim().min(1).max(80).optional(),
  weekStartDate: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

export const POST = withApiHandler(
  async ({ request, log, correlationId }) => {
    const user = await requireFirebaseAuth(request, log);
    const body = await parseJson(request, bodySchema);

    const report = await runWeeklyKpiRollup({
      uid: user.uid,
      timeZone: body.timeZone,
      weekStartDate: body.weekStartDate,
      log,
    });

    return NextResponse.json({
      ok: true,
      report,
      correlationId,
    });
  },
  { route: "revenue.kpi.weekly.post" }
);
