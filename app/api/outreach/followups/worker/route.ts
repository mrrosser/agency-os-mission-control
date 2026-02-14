import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler, ApiError } from "@/lib/api/handler";
import { parseJson } from "@/lib/api/validation";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { resolveLeadRunOrgId } from "@/lib/lead-runs/quotas";
import { processDueFollowupDraftTasks } from "@/lib/outreach/followups";

const bodySchema = z.object({
  runId: z.string().trim().min(1).max(120),
  maxTasks: z.coerce.number().int().min(1).max(25).optional(),
  dryRun: z.boolean().optional(),
});

export const POST = withApiHandler(
  async ({ request, log }) => {
    const body = await parseJson(request, bodySchema);
    const user = await requireFirebaseAuth(request, log);
    const orgId = await resolveLeadRunOrgId(user.uid, log);

    if (!orgId) throw new ApiError(400, "Missing orgId");

    const result = await processDueFollowupDraftTasks({
      runId: body.runId,
      orgId,
      uid: user.uid,
      maxTasks: body.maxTasks ?? 5,
      dryRun: body.dryRun ?? false,
      log,
    });

    return NextResponse.json({ orgId, ...result });
  },
  { route: "outreach.followups.worker" }
);

