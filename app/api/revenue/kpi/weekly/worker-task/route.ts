import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, withApiHandler } from "@/lib/api/handler";
import { parseJson } from "@/lib/api/validation";
import { runWeeklyKpiRollup } from "@/lib/revenue/weekly-kpi";

const bodySchema = z.object({
  uid: z.string().trim().min(1).max(128),
  timeZone: z.string().trim().min(1).max(80).optional(),
  weekStartDate: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

function readBearerToken(request: Request): string {
  const auth = request.headers.get("authorization") || "";
  if (!auth.toLowerCase().startsWith("bearer ")) return "";
  return auth.slice(7).trim();
}

function authorizeWorker(request: Request): void {
  const expected = String(process.env.REVENUE_WEEKLY_KPI_WORKER_TOKEN || "").trim();
  if (!expected) {
    throw new ApiError(503, "REVENUE_WEEKLY_KPI_WORKER_TOKEN is not configured");
  }

  const candidate =
    String(request.headers.get("x-revenue-weekly-kpi-token") || "").trim() || readBearerToken(request);
  if (!candidate || candidate !== expected) {
    throw new ApiError(403, "Forbidden");
  }
}

export const POST = withApiHandler(
  async ({ request, log, correlationId }) => {
    authorizeWorker(request);
    const body = await parseJson(request, bodySchema);

    const report = await runWeeklyKpiRollup({
      uid: body.uid,
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
  { route: "revenue.kpi.weekly.worker-task.post" }
);
