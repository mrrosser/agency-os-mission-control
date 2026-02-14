import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { z } from "zod";
import { withApiHandler, ApiError } from "@/lib/api/handler";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { parseJson } from "@/lib/api/validation";
import { getAdminDb } from "@/lib/firebase-admin";
import { assertLeadRunOwner } from "@/lib/lead-runs/receipts";
import {
  defaultLeadRunDiagnostics,
  LEAD_RUN_JOB_DOC_ID,
  leadRunJobRef,
  triggerLeadRunWorker,
  type LeadRunJobConfig,
  type LeadRunJobDoc,
} from "@/lib/lead-runs/jobs";
import {
  acquireLeadRunConcurrencySlot,
  claimLeadRunQuota,
  releaseLeadRunConcurrencySlot,
  resolveLeadRunOrgId,
} from "@/lib/lead-runs/quotas";

const startBodySchema = z.object({
  action: z.literal("start"),
  config: z.object({
    dryRun: z.boolean().optional(),
    draftFirst: z.boolean().optional(),
    timeZone: z.string().min(1).max(80).optional(),
    businessKey: z.enum(["aicf", "rng", "rts", "rt"]).optional(),
    useSMS: z.boolean().optional(),
    useAvatar: z.boolean().optional(),
    useOutboundCall: z.boolean().optional(),
  }).optional(),
});

const controlBodySchema = z.object({
  action: z.enum(["pause", "resume"]),
});

const bodySchema = z.union([startBodySchema, controlBodySchema]);

function serializeJob(job: LeadRunJobDoc) {
  const createdAt = toIso(job.createdAt);
  const updatedAt = toIso(job.updatedAt);
  const leaseUntil = job.leaseUntil || null;
  const queueLagSeconds =
    job.status === "queued" ? ageSeconds(updatedAt || createdAt) : null;

  return {
    runId: job.runId,
    userId: job.userId,
    orgId: job.orgId || null,
    status: job.status,
    config: {
      dryRun: Boolean(job.config?.dryRun),
      draftFirst: Boolean(job.config?.draftFirst),
      timeZone: job.config?.timeZone || "UTC",
      businessKey: job.config?.businessKey || null,
      useSMS: Boolean(job.config?.useSMS),
      useAvatar: Boolean(job.config?.useAvatar),
      useOutboundCall: Boolean(job.config?.useOutboundCall),
    },
    leadDocIds: job.leadDocIds || [],
    nextIndex: job.nextIndex || 0,
    totalLeads: job.totalLeads || 0,
    diagnostics: job.diagnostics || defaultLeadRunDiagnostics(),
    attemptsByLead: job.attemptsByLead || {},
    lastError: job.lastError || null,
    correlationId: job.correlationId || null,
    createdAt,
    updatedAt,
    leaseUntil,
    queueLagSeconds,
  };
}

function toIso(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  const candidate = value as { toDate?: () => Date };
  if (typeof candidate.toDate === "function") {
    try {
      return candidate.toDate().toISOString();
    } catch {
      return null;
    }
  }
  return null;
}

function ageSeconds(iso: string | null): number | null {
  if (!iso) return null;
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.floor((Date.now() - parsed) / 1000));
}

export const GET = withApiHandler(
  async ({ request, params, log }) => {
    const user = await requireFirebaseAuth(request, log);
    const runId = params?.runId;
    if (!runId) throw new ApiError(400, "Missing runId");

    await assertLeadRunOwner(runId, user.uid, log);

    const snap = await leadRunJobRef(runId).get();
    if (!snap.exists) {
      return NextResponse.json({ job: null, runId });
    }

    const job = snap.data() as LeadRunJobDoc;
    return NextResponse.json({ job: serializeJob(job), runId });
  },
  { route: "lead-runs.jobs.get" }
);

export const POST = withApiHandler(
  async ({ request, params, log, correlationId }) => {
    const body = await parseJson(request, bodySchema);
    const user = await requireFirebaseAuth(request, log);
    const runId = params?.runId;
    if (!runId) throw new ApiError(400, "Missing runId");

    await assertLeadRunOwner(runId, user.uid, log);

    const runRef = getAdminDb().collection("lead_runs").doc(runId);
    const jobRef = runRef.collection("jobs").doc(LEAD_RUN_JOB_DOC_ID);

    if (body.action === "start") {
      const existingJobSnap = await jobRef.get();
      if (existingJobSnap.exists) {
        const existingJob = existingJobSnap.data() as LeadRunJobDoc;
        if (
          existingJob.status === "queued" ||
          existingJob.status === "running" ||
          existingJob.status === "paused"
        ) {
          return NextResponse.json({ ok: true, job: serializeJob(existingJob), reused: true });
        }
      }

      const runSnap = await runRef.get();
      if (!runSnap.exists) throw new ApiError(404, "Lead run not found");
      const runData = runSnap.data() || {};
      const sourceDiagnostics = (runData.sourceDiagnostics as Record<string, unknown> | undefined) || {};

      const leadsSnap = await runRef.collection("leads").get();
      const leadDocs = leadsSnap.docs
        .map((doc) => ({
          id: doc.id,
          score: Number(doc.data()?.score || 0),
        }))
        .sort((a, b) => b.score - a.score);
      if (leadDocs.length === 0) {
        throw new ApiError(400, "Lead run has no leads to process");
      }

      const config: LeadRunJobConfig = {
        dryRun: Boolean(body.config?.dryRun),
        draftFirst: Boolean(body.config?.draftFirst),
        timeZone: body.config?.timeZone || "UTC",
        businessKey: body.config?.businessKey,
        useSMS: Boolean(body.config?.useSMS),
        useAvatar: Boolean(body.config?.useAvatar),
        useOutboundCall: Boolean(body.config?.useOutboundCall),
      };

      const orgId = await resolveLeadRunOrgId(user.uid, log);
      await claimLeadRunQuota({
        orgId,
        uid: user.uid,
        requestedLeads: leadDocs.length,
        runId,
        correlationId,
        log,
      });
      await acquireLeadRunConcurrencySlot({ orgId, runId, correlationId, log });

      const workerToken = crypto.randomUUID();
      const job: LeadRunJobDoc = {
        runId,
        userId: user.uid,
        orgId,
        status: "queued",
        config,
        workerToken,
        leadDocIds: leadDocs.map((lead) => lead.id),
        nextIndex: 0,
        totalLeads: leadDocs.length,
        diagnostics: {
          ...defaultLeadRunDiagnostics(),
          sourceFetched: Number(sourceDiagnostics.fetchedTotal || runData.candidateTotal || leadDocs.length || 0),
          sourceScored: Number(sourceDiagnostics.scoredTotal || runData.total || leadDocs.length || 0),
          sourceFilteredByScore: Number(
            sourceDiagnostics.filteredByScore ||
              runData.filteredOut ||
              Math.max(0, Number(runData.candidateTotal || leadDocs.length) - leadDocs.length)
          ),
          sourceWithEmail: Number(sourceDiagnostics.withEmail || 0),
          sourceWithoutEmail: Number(sourceDiagnostics.withoutEmail || 0),
        },
        attemptsByLead: {},
        correlationId,
      };

      try {
        await jobRef.set(
          {
            ...job,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      } catch (error) {
        await releaseLeadRunConcurrencySlot({ orgId, runId, correlationId, log });
        throw error;
      }

      const origin = request.nextUrl?.origin || new URL(request.url).origin;
      void triggerLeadRunWorker(origin, runId, workerToken, correlationId, log);

      return NextResponse.json({ ok: true, job: serializeJob(job) });
    }

    const snap = await jobRef.get();
    if (!snap.exists) throw new ApiError(404, "Lead run job not found");
    const existing = snap.data() as LeadRunJobDoc;

    if (body.action === "pause") {
      if (existing.status === "queued" || existing.status === "running") {
        await releaseLeadRunConcurrencySlot({
          orgId: existing.orgId || existing.userId,
          runId,
          correlationId,
          log,
        });
      }
      await jobRef.set(
        {
          status: "paused",
          updatedAt: FieldValue.serverTimestamp(),
          correlationId,
        },
        { merge: true }
      );
      return NextResponse.json({
        ok: true,
        job: serializeJob({ ...existing, status: "paused", correlationId }),
      });
    }

    // resume
    const nextStatus = existing.nextIndex >= existing.totalLeads ? "completed" : "queued";
    if (nextStatus === "queued") {
      await acquireLeadRunConcurrencySlot({
        orgId: existing.orgId || existing.userId,
        runId,
        correlationId,
        log,
      });
    }
    await jobRef.set(
      {
        status: nextStatus,
        lastError: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
        correlationId,
      },
      { merge: true }
    );

    if (nextStatus === "queued") {
      const origin = request.nextUrl?.origin || new URL(request.url).origin;
      void triggerLeadRunWorker(origin, runId, existing.workerToken, correlationId, log);
    }

    return NextResponse.json({
      ok: true,
      job: serializeJob({ ...existing, status: nextStatus, correlationId }),
    });
  },
  { route: "lead-runs.jobs.control" }
);
