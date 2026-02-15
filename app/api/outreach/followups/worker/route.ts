import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler, ApiError } from "@/lib/api/handler";
import { parseJson } from "@/lib/api/validation";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { resolveLeadRunOrgId } from "@/lib/lead-runs/quotas";
import { processDueFollowupDraftTasks } from "@/lib/outreach/followups";
import { findNextPendingFollowupDueAtMs, getOrCreateFollowupsWorkerToken, triggerFollowupsWorker } from "@/lib/outreach/followups-jobs";
import { getFollowupsOrgSettings } from "@/lib/outreach/followups-settings";

const bodySchema = z.object({
  runId: z.string().trim().min(1).max(120),
  maxTasks: z.coerce.number().int().min(1).max(25).optional(),
  dryRun: z.boolean().optional(),
});

export const POST = withApiHandler(
  async ({ request, log, correlationId }) => {
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

    const settings = await getFollowupsOrgSettings(orgId, log);
    let scheduledNextAtMs: number | null = null;

    if (settings.autoEnabled) {
      const workerToken = await getOrCreateFollowupsWorkerToken({ runId: body.runId, uid: user.uid, log });
      const nextDueAtMs = await findNextPendingFollowupDueAtMs({ runId: body.runId, uid: user.uid, lookahead: 100, log });
      if (nextDueAtMs) {
        const nowMs = Date.now();
        const drainDelayMs = Math.max(0, settings.drainDelaySeconds) * 1000;
        scheduledNextAtMs = nextDueAtMs <= nowMs ? nowMs + drainDelayMs : nextDueAtMs;

        const origin = request.nextUrl?.origin || new URL(request.url).origin;
        void triggerFollowupsWorker({
          origin,
          runId: body.runId,
          workerToken,
          correlationId,
          scheduleAtMs: scheduledNextAtMs,
          log,
        });
      }
    }

    return NextResponse.json({ orgId, ...result, autoEnabled: settings.autoEnabled, scheduledNextAtMs });
  },
  { route: "outreach.followups.worker" }
);
