import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler, ApiError } from "@/lib/api/handler";
import { parseJson } from "@/lib/api/validation";
import { getAdminDb } from "@/lib/firebase-admin";
import { resolveLeadRunOrgId } from "@/lib/lead-runs/quotas";
import { processDueFollowupDraftTasks } from "@/lib/outreach/followups";
import { findNextPendingFollowupDueAtMs, triggerFollowupsWorker } from "@/lib/outreach/followups-jobs";
import { getFollowupsOrgSettings } from "@/lib/outreach/followups-settings";

const bodySchema = z.object({
  runId: z.string().trim().min(1).max(120),
  workerToken: z.string().trim().min(1).max(200),
  maxTasks: z.coerce.number().int().min(1).max(25).optional(),
  dryRun: z.boolean().optional(),
});

export const POST = withApiHandler(
  async ({ request, correlationId, log }) => {
    const body = await parseJson(request, bodySchema);

    const runRef = getAdminDb().collection("lead_runs").doc(body.runId);
    const runSnap = await runRef.get();
    if (!runSnap.exists) throw new ApiError(404, "Lead run not found");

    const runData = runSnap.data() || {};
    const expectedToken = String((runData as Record<string, unknown>).followupsWorkerToken || "").trim();
    if (!expectedToken) throw new ApiError(400, "Missing followupsWorkerToken for run");
    if (expectedToken !== body.workerToken) throw new ApiError(403, "Forbidden");

    const uid = String((runData as Record<string, unknown>).userId || "").trim();
    if (!uid) throw new ApiError(400, "Missing run userId");

    const orgId = await resolveLeadRunOrgId(uid, log);
    if (!orgId) throw new ApiError(400, "Missing orgId");

    const settings = await getFollowupsOrgSettings(orgId, log);
    if (!settings.autoEnabled) {
      log.info("outreach.followups.worker_task.disabled", { orgId, runId: body.runId });
      return NextResponse.json({
        ok: true,
        disabled: true,
        orgId,
        runId: body.runId,
      });
    }

    const maxTasks = body.maxTasks ?? settings.maxTasksPerInvocation;
    const dryRun = body.dryRun ?? false;

    const result = await processDueFollowupDraftTasks({
      runId: body.runId,
      orgId,
      uid,
      maxTasks,
      dryRun,
      log,
    });

    const nextDueAtMs = await findNextPendingFollowupDueAtMs({
      runId: body.runId,
      uid,
      lookahead: 100,
      log,
    });

    let scheduledNextAtMs: number | null = null;
    if (nextDueAtMs) {
      const nowMs = Date.now();
      const drainDelayMs = Math.max(0, settings.drainDelaySeconds) * 1000;
      scheduledNextAtMs = nextDueAtMs <= nowMs ? nowMs + drainDelayMs : nextDueAtMs;

      const origin = request.nextUrl?.origin || new URL(request.url).origin;
      void triggerFollowupsWorker({
        origin,
        runId: body.runId,
        workerToken: body.workerToken,
        correlationId,
        scheduleAtMs: scheduledNextAtMs,
        log,
      });
    }

    return NextResponse.json({
      ok: true,
      orgId,
      ...result,
      scheduledNextAtMs,
    });
  },
  { route: "outreach.followups.worker_task" }
);

