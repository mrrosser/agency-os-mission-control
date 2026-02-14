import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler, ApiError } from "@/lib/api/handler";
import { parseJson } from "@/lib/api/validation";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { resolveLeadRunOrgId } from "@/lib/lead-runs/quotas";
import { listFollowupTasks, queueFollowupDraftTasksForRun } from "@/lib/outreach/followups";

const queueSchema = z.object({
  runId: z.string().trim().min(1).max(120),
  delayHours: z.coerce.number().int().min(0).max(24 * 30).optional(),
  maxLeads: z.coerce.number().int().min(1).max(25).optional(),
  sequence: z.coerce.number().int().min(1).max(10).optional(),
});

export const GET = withApiHandler(
  async ({ request, log }) => {
    const user = await requireFirebaseAuth(request, log);
    const url = new URL(request.url);
    const runId = (url.searchParams.get("runId") || "").trim();
    if (!runId) throw new ApiError(400, "Missing runId");

    const tasks = await listFollowupTasks({ runId, uid: user.uid, limit: 100 });
    return NextResponse.json({ runId, tasks });
  },
  { route: "outreach.followups.list" }
);

export const POST = withApiHandler(
  async ({ request, log }) => {
    const body = await parseJson(request, queueSchema);
    const user = await requireFirebaseAuth(request, log);
    const orgId = await resolveLeadRunOrgId(user.uid, log);

    const result = await queueFollowupDraftTasksForRun({
      runId: body.runId,
      uid: user.uid,
      delayHours: body.delayHours ?? 48,
      maxLeads: body.maxLeads ?? 25,
      sequence: body.sequence ?? 1,
      log,
    });

    return NextResponse.json({ orgId, ...result });
  },
  { route: "outreach.followups.queue" }
);

