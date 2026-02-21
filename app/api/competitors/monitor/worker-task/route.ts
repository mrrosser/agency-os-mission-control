import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { z } from "zod";
import { withApiHandler, ApiError } from "@/lib/api/handler";
import { parseJson } from "@/lib/api/validation";
import { getAdminDb } from "@/lib/firebase-admin";
import { resolveSecret } from "@/lib/api/secrets";
import { firecrawlScrape } from "@/lib/firecrawl/client";
import {
  buildCompetitorHtmlReport,
  buildCompetitorMarkdownReport,
  extractEmails,
  extractPhones,
} from "@/lib/competitors/report";
import { triggerCompetitorMonitorWorker } from "@/lib/competitors/jobs";

const bodySchema = z.object({
  uid: z.string().trim().min(1).max(128),
  monitorId: z.string().trim().min(1).max(120),
  workerToken: z.string().trim().min(1).max(200),
  force: z.boolean().optional(),
});

type CompetitorMonitorDoc = {
  monitorId: string;
  name: string;
  competitors: Array<{ name: string; url: string }>;
  frequencyHours?: number;
  workerToken: string;
  nextRunAtMs?: number;
};

function monitorRef(uid: string, monitorId: string) {
  return getAdminDb()
    .collection("identities")
    .doc(uid)
    .collection("competitor_monitors")
    .doc(monitorId);
}

export const POST = withApiHandler(
  async ({ request, log, correlationId }) => {
    const body = await parseJson(request, bodySchema);

    const ref = monitorRef(body.uid, body.monitorId);
    const snap = await ref.get();
    if (!snap.exists) throw new ApiError(404, "Competitor monitor not found");

    const monitor = snap.data() as CompetitorMonitorDoc;
    if ((monitor.workerToken || "").trim() !== body.workerToken) {
      throw new ApiError(403, "Invalid worker token");
    }
    const competitors = Array.isArray(monitor.competitors) ? monitor.competitors : [];
    if (competitors.length === 0) throw new ApiError(400, "Competitor monitor has no competitors");

    const nowMs = Date.now();
    if (!body.force && typeof monitor.nextRunAtMs === "number" && monitor.nextRunAtMs > nowMs) {
      return NextResponse.json({
        ok: true,
        skipped: true,
        reason: "not_due",
        nextRunAtMs: monitor.nextRunAtMs,
      });
    }

    await ref.set(
      {
        status: "running",
        lastError: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    const firecrawlKey = await resolveSecret(body.uid, "firecrawlKey", "FIRECRAWL_API_KEY");
    if (!firecrawlKey) {
      await ref.set(
        {
          status: "error",
          lastError: "Firecrawl key missing",
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      throw new ApiError(400, "Firecrawl key missing");
    }

    const snapshots: Array<{
      name: string;
      url: string;
      title?: string;
      description?: string;
      keywords?: string;
      emails: string[];
      phones: string[];
      linkCount: number;
      markdownChars: number;
      warning?: string;
    }> = [];

    for (const competitor of competitors) {
      try {
        const scrape = await firecrawlScrape(
          competitor.url,
          firecrawlKey,
          { onlyMainContent: true, formats: ["markdown", "links"], timeoutMs: 25_000 },
          log
        );
        const markdown = scrape.markdown || "";
        snapshots.push({
          name: competitor.name,
          url: competitor.url,
          title: typeof scrape.metadata?.title === "string" ? scrape.metadata.title : undefined,
          description:
            typeof scrape.metadata?.description === "string"
              ? scrape.metadata.description
              : undefined,
          keywords:
            typeof scrape.metadata?.keywords === "string"
              ? scrape.metadata.keywords
              : undefined,
          emails: extractEmails(markdown),
          phones: extractPhones(markdown),
          linkCount: Array.isArray(scrape.links) ? scrape.links.length : 0,
          markdownChars: markdown.length,
          warning: scrape.warning,
        });
      } catch (error) {
        snapshots.push({
          name: competitor.name,
          url: competitor.url,
          emails: [],
          phones: [],
          linkCount: 0,
          markdownChars: 0,
          warning: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const generatedAtIso = new Date().toISOString();
    const markdown = buildCompetitorMarkdownReport({
      monitorName: monitor.name || "Competitor Monitor",
      generatedAtIso,
      snapshots,
    });
    const html = buildCompetitorHtmlReport({
      monitorName: monitor.name || "Competitor Monitor",
      generatedAtIso,
      snapshots,
    });

    const reportId = crypto.randomUUID();
    await ref.collection("reports").doc(reportId).set({
      reportId,
      monitorId: body.monitorId,
      uid: body.uid,
      generatedAt: generatedAtIso,
      createdAt: FieldValue.serverTimestamp(),
      competitorCount: snapshots.length,
      markdown,
      html,
      summary: {
        totalEmails: snapshots.reduce((sum, item) => sum + item.emails.length, 0),
        totalPhones: snapshots.reduce((sum, item) => sum + item.phones.length, 0),
      },
    });

    const frequencyHours = Math.min(Math.max(Number(monitor.frequencyHours || 24), 1), 168);
    const nextRunAtMs = Date.now() + frequencyHours * 60 * 60 * 1000;

    await ref.set(
      {
        status: "idle",
        lastRunAt: generatedAtIso,
        lastReportId: reportId,
        nextRunAtMs,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    const origin = request.nextUrl?.origin || new URL(request.url).origin;
    const dispatch = await triggerCompetitorMonitorWorker({
      origin,
      uid: body.uid,
      monitorId: body.monitorId,
      workerToken: body.workerToken,
      correlationId,
      scheduleAtMs: nextRunAtMs,
      log,
    });

    log.info("competitor.monitor.worker.completed", {
      uid: body.uid,
      monitorId: body.monitorId,
      reportId,
      competitorCount: snapshots.length,
      dispatch,
    });

    return NextResponse.json({
      ok: true,
      monitorId: body.monitorId,
      reportId,
      generatedAt: generatedAtIso,
      competitorCount: snapshots.length,
      nextRunAtMs,
      dispatch,
    });
  },
  { route: "competitors.monitor.worker-task" }
);
