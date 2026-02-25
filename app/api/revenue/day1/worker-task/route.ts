import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, withApiHandler } from "@/lib/api/handler";
import { parseJson } from "@/lib/api/validation";
import { runDay1RevenueAutomation } from "@/lib/revenue/day1-automation";

const bodySchema = z.object({
  uid: z.string().trim().min(1).max(128),
  templateId: z.string().trim().min(1).max(120),
  dryRun: z.boolean().optional(),
  forceRun: z.boolean().optional(),
  dateKey: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  timeZone: z.string().trim().min(1).max(80).optional(),
  autoQueueFollowups: z.boolean().optional(),
  followupDelayHours: z.coerce.number().int().min(0).max(24 * 30).optional(),
  followupMaxLeads: z.coerce.number().int().min(1).max(25).optional(),
  followupSequence: z.coerce.number().int().min(1).max(10).optional(),
});

function readBearerToken(request: Request): string {
  const auth = request.headers.get("authorization") || "";
  if (!auth.toLowerCase().startsWith("bearer ")) return "";
  return auth.slice(7).trim();
}

function authorizeWorker(request: Request): void {
  const configured = String(process.env.REVENUE_DAY1_WORKER_TOKEN || "").trim();
  if (!configured) {
    throw new ApiError(503, "REVENUE_DAY1_WORKER_TOKEN is not configured");
  }
  const candidate =
    String(request.headers.get("x-revenue-day1-token") || "").trim() || readBearerToken(request);
  if (!candidate || candidate !== configured) {
    throw new ApiError(403, "Forbidden");
  }
}

export const POST = withApiHandler(
  async ({ request, correlationId, log }) => {
    authorizeWorker(request);
    const body = await parseJson(request, bodySchema);
    const origin = request.nextUrl?.origin || new URL(request.url).origin;

    const result = await runDay1RevenueAutomation({
      uid: body.uid,
      templateId: body.templateId,
      origin,
      correlationId,
      log,
      dryRun: body.dryRun,
      forceRun: body.forceRun,
      dateKey: body.dateKey,
      timeZone: body.timeZone,
      autoQueueFollowups: body.autoQueueFollowups,
      followupDelayHours: body.followupDelayHours,
      followupMaxLeads: body.followupMaxLeads,
      followupSequence: body.followupSequence,
    });

    return NextResponse.json({
      ok: true,
      ...result,
      correlationId,
    });
  },
  { route: "revenue.day1.worker_task.post" }
);
