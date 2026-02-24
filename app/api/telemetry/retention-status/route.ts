import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler, ApiError } from "@/lib/api/handler";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { getAdminDb } from "@/lib/firebase-admin";

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(10).optional(),
});

function toIso(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const maybeTimestamp = value as { toDate?: () => Date };
  if (typeof maybeTimestamp.toDate === "function") {
    try {
      return maybeTimestamp.toDate().toISOString();
    } catch {
      return null;
    }
  }
  if (typeof value === "string") return value;
  return null;
}

function toNumber(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return numeric;
}

function toBoolean(value: unknown): boolean {
  return Boolean(value);
}

function mapRunRecord(value: Record<string, unknown> | null) {
  if (!value) return null;
  const events = (value.events || {}) as Record<string, unknown>;
  const groups = (value.groups || {}) as Record<string, unknown>;
  const github = (value.github || {}) as Record<string, unknown>;
  const error = (value.error || {}) as Record<string, unknown>;
  const status = String(value.status || "unknown");
  const eventsReachedCap = toBoolean(events.reachedDeleteCap);
  const groupsReachedCap = toBoolean(groups.reachedDeleteCap);
  const reachedAnyCap = eventsReachedCap || groupsReachedCap;
  const alert =
    status !== "success"
      ? {
          severity: "critical",
          code: "cleanup_failed",
          message: error.message ? String(error.message) : "Telemetry cleanup run failed.",
        }
      : reachedAnyCap
        ? {
            severity: "warning",
            code: "cleanup_cap_reached",
            message: "Telemetry cleanup reached delete cap; some stale records may remain.",
          }
        : null;

  return {
    status,
    correlationId: String(value.correlationId || ""),
    projectId: String(value.projectId || ""),
    startedAt: toIso(value.startedAt),
    finishedAt: toIso(value.finishedAt),
    updatedAt: toIso(value.updatedAt),
    dryRun: toBoolean(value.dryRun),
    eventRetentionDays: toNumber(value.eventRetentionDays),
    groupRetentionDays: toNumber(value.groupRetentionDays),
    batchSize: toNumber(value.batchSize),
    maxDeletesPerCollection: toNumber(value.maxDeletesPerCollection),
    eventCutoff: toIso(value.eventCutoff),
    groupCutoff: toIso(value.groupCutoff),
    events: {
      deleted: toNumber(events.deleted),
      batches: toNumber(events.batches),
      reachedDeleteCap: eventsReachedCap,
    },
    groups: {
      deleted: toNumber(groups.deleted),
      batches: toNumber(groups.batches),
      reachedDeleteCap: groupsReachedCap,
    },
    github: {
      runId: github.runId ? String(github.runId) : null,
      runNumber: github.runNumber ? String(github.runNumber) : null,
      repository: github.repository ? String(github.repository) : null,
      workflow: github.workflow ? String(github.workflow) : null,
      actor: github.actor ? String(github.actor) : null,
      sha: github.sha ? String(github.sha) : null,
      runUrl: github.runUrl ? String(github.runUrl) : null,
    },
    error: {
      message: error.message ? String(error.message) : null,
      stack: error.stack ? String(error.stack) : null,
    },
    alert,
  };
}

export const GET = withApiHandler(
  async ({ request, log }) => {
    await requireFirebaseAuth(request, log);
    const requestUrl =
      "nextUrl" in request && request.nextUrl ? request.nextUrl : new URL(request.url);
    const parsed = querySchema.safeParse({
      limit: requestUrl.searchParams.get("limit") || undefined,
    });
    if (!parsed.success) {
      throw new ApiError(400, "Invalid query parameters", { issues: parsed.error.issues });
    }

    const limit = parsed.data.limit || 5;
    const db = getAdminDb();
    const latestSnap = await db.collection("telemetry_maintenance").doc("retention_cleanup").get();

    const latest = latestSnap.exists
      ? mapRunRecord((latestSnap.data() || {}) as Record<string, unknown>)
      : null;

    const runsSnap = await db
      .collection("telemetry_maintenance_runs")
      .orderBy("finishedAt", "desc")
      .limit(limit)
      .get();

    const runs = runsSnap.docs
      .map((doc) => mapRunRecord((doc.data() || {}) as Record<string, unknown>))
      .filter((item): item is NonNullable<typeof item> => Boolean(item));

    return NextResponse.json({
      latest,
      runs,
    });
  },
  { route: "telemetry.retention_status.get" }
);
