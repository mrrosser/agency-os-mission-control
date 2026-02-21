import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { z } from "zod";
import { withApiHandler } from "@/lib/api/handler";
import { parseJson } from "@/lib/api/validation";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { getAdminDb } from "@/lib/firebase-admin";
import { triggerCompetitorMonitorWorker } from "@/lib/competitors/jobs";

const competitorSchema = z.object({
  name: z.string().trim().min(1).max(120),
  url: z.string().trim().url().max(400),
});

const bodySchema = z.object({
  monitorId: z.string().trim().min(1).max(120).optional(),
  name: z.string().trim().min(1).max(120),
  competitors: z.array(competitorSchema).min(1).max(20),
  frequencyHours: z.number().int().min(1).max(168).optional(),
  runNow: z.boolean().optional().default(true),
});

function monitorsRef(uid: string) {
  return getAdminDb()
    .collection("identities")
    .doc(uid)
    .collection("competitor_monitors");
}

type MonitorDoc = {
  monitorId: string;
  name: string;
  competitors: Array<{ name: string; url: string }>;
  frequencyHours: number;
  workerToken: string;
  nextRunAtMs: number;
  lastRunAt?: string | null;
  lastReportId?: string | null;
  status?: "idle" | "running" | "error";
  lastError?: string | null;
  createdAt?: unknown;
  updatedAt?: unknown;
};

function toIso(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  const maybe = value as { toDate?: () => Date };
  if (typeof maybe.toDate === "function") {
    try {
      return maybe.toDate().toISOString();
    } catch {
      return null;
    }
  }
  return null;
}

export const GET = withApiHandler(
  async ({ request, log }) => {
    const user = await requireFirebaseAuth(request, log);
    const snap = await monitorsRef(user.uid).orderBy("updatedAt", "desc").limit(25).get();

    const monitors = snap.docs.map((doc) => {
      const data = doc.data() as MonitorDoc;
      return {
        monitorId: doc.id,
        name: data.name,
        competitors: data.competitors || [],
        frequencyHours: data.frequencyHours || 24,
        nextRunAtMs: data.nextRunAtMs || null,
        lastRunAt: data.lastRunAt || null,
        lastReportId: data.lastReportId || null,
        status: data.status || "idle",
        lastError: data.lastError || null,
        createdAt: toIso(data.createdAt),
        updatedAt: toIso(data.updatedAt),
      };
    });

    return NextResponse.json({ monitors });
  },
  { route: "competitors.monitor.list" }
);

export const POST = withApiHandler(
  async ({ request, log, correlationId }) => {
    const user = await requireFirebaseAuth(request, log);
    const body = await parseJson(request, bodySchema);

    const monitorId = body.monitorId || crypto.randomUUID();
    const frequencyHours = body.frequencyHours || 24;
    const nextRunAtMs = body.runNow
      ? Date.now()
      : Date.now() + frequencyHours * 60 * 60 * 1000;

    const monitorRef = monitorsRef(user.uid).doc(monitorId);
    const existing = await monitorRef.get();
    const workerToken =
      (existing.data()?.workerToken as string | undefined)?.trim() || crypto.randomUUID();

    await monitorRef.set(
      {
        monitorId,
        name: body.name,
        competitors: body.competitors,
        frequencyHours,
        workerToken,
        nextRunAtMs,
        status: "idle",
        updatedAt: FieldValue.serverTimestamp(),
        createdAt: existing.exists ? undefined : FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    let dispatch: "cloud_tasks" | "http" | "skipped" = "skipped";
    if (body.runNow) {
      const origin = request.nextUrl?.origin || new URL(request.url).origin;
      dispatch = await triggerCompetitorMonitorWorker({
        origin,
        uid: user.uid,
        monitorId,
        workerToken,
        correlationId,
        scheduleAtMs: Date.now(),
        log,
      });
    }

    return NextResponse.json({
      ok: true,
      monitor: {
        monitorId,
        name: body.name,
        competitors: body.competitors,
        frequencyHours,
        nextRunAtMs,
      },
      dispatch,
    });
  },
  { route: "competitors.monitor.upsert" }
);
