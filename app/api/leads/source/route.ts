import { NextResponse } from "next/server";
import { z } from "zod";
import { FieldValue } from "firebase-admin/firestore";
import { withApiHandler, ApiError } from "@/lib/api/handler";
import { parseJson } from "@/lib/api/validation";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { getAdminDb } from "@/lib/firebase-admin";
import { resolveSecret } from "@/lib/api/secrets";
import { sanitizeLogPayload } from "@/lib/api/guardrails";
import { sourceLeads } from "@/lib/leads/sourcing";
import type { LeadSourceRequest } from "@/lib/leads/types";
import { stripUndefined } from "@/lib/firestore/strip-undefined";
import { buildLeadDocId } from "@/lib/lead-runs/ids";

const bodySchema = z.object({
  // Allow longer natural-language descriptions; downstream providers may further truncate.
  query: z.string().min(1).max(500).optional(),
  industry: z.string().min(1).max(80).optional(),
  location: z.string().min(1).max(120).optional(),
  limit: z.number().int().min(1).max(25).optional(),
  minScore: z.number().int().min(0).max(100).optional(),
  sources: z.array(z.enum(["googlePlaces", "firestore"])).optional(),
  includeEnrichment: z.boolean().optional(),
});

interface LeadSourceDiagnostics {
  requestedLimit: number;
  fetchedTotal: number;
  dedupedTotal: number;
  duplicatesRemoved: number;
  domainClusters: number;
  maxDomainClusterSize: number;
  scoredTotal: number;
  filteredByScore: number;
  withEmail: number;
  withoutEmail: number;
}

export const POST = withApiHandler(
  async ({ request, log, correlationId }) => {
    const body = await parseJson(request, bodySchema);
    const user = await requireFirebaseAuth(request, log);

    const idempotencyKey = request.headers.get("x-idempotency-key") || "";
    const runId = idempotencyKey || crypto.randomUUID();
    const runRef = getAdminDb().collection("lead_runs").doc(runId);

    if (idempotencyKey) {
      const existing = await runRef.get();
      if (existing.exists && existing.data()?.userId === user.uid) {
        const leadsSnap = await runRef.collection("leads").get();
        const cached = leadsSnap.docs.map((doc) => doc.data());
        return NextResponse.json({
          runId,
          leads: cached,
          sourcesUsed: existing.data()?.sourcesUsed || [],
          warnings: existing.data()?.warnings || [],
          cached: true,
        });
      }
    }

    const requestPayload: LeadSourceRequest = {
      query: body.query,
      industry: body.industry,
      location: body.location,
      limit: body.limit || 10,
      minScore: body.minScore,
      sources: body.sources,
      includeEnrichment: body.includeEnrichment ?? true,
    };

    if (!requestPayload.query && !requestPayload.industry && !(requestPayload.sources || []).includes("firestore")) {
      throw new ApiError(400, "Provide a query or industry to source leads.");
    }

    log.info("lead.source.request", sanitizeLogPayload({
      ...requestPayload,
      correlationId,
      idempotency: Boolean(idempotencyKey),
    }));

    const googlePlacesKey = await resolveSecret(
      user.uid,
      "googlePlacesKey",
      "GOOGLE_PLACES_API_KEY"
    );

    const firecrawlKey = await resolveSecret(
      user.uid,
      "firecrawlKey",
      "FIRECRAWL_API_KEY"
    );

    const { leads, sourcesUsed, warnings, diagnostics } = await sourceLeads(requestPayload, {
      uid: user.uid,
      googlePlacesKey,
      firecrawlKey,
      log,
    });

    const rawTotal = diagnostics?.rawCount ?? leads.length;
    const dedupedTotal = diagnostics?.dedupedCount ?? leads.length;
    const duplicatesRemoved = diagnostics?.duplicatesRemoved ?? Math.max(0, rawTotal - dedupedTotal);
    const domainClusters = diagnostics?.domainClusters ?? 0;
    const maxDomainClusterSize = diagnostics?.maxDomainClusterSize ?? 0;

    const scored = leads
      .filter((lead) => (requestPayload.minScore ? (lead.score || 0) >= requestPayload.minScore : true))
      .sort((a, b) => (b.score || 0) - (a.score || 0));
    const filteredOut = Math.max(0, dedupedTotal - scored.length);
    const withEmail = scored.filter((lead) => Boolean(lead.email && lead.email.trim())).length;
    const sourceDiagnostics: LeadSourceDiagnostics = {
      requestedLimit: requestPayload.limit || 10,
      fetchedTotal: rawTotal,
      dedupedTotal,
      duplicatesRemoved,
      domainClusters,
      maxDomainClusterSize,
      scoredTotal: scored.length,
      filteredByScore: filteredOut,
      withEmail,
      withoutEmail: Math.max(0, scored.length - withEmail),
    };

    const batch = getAdminDb().batch();
    const leadsRef = runRef.collection("leads");
    scored.forEach((lead) => {
      const docId = buildLeadDocId({ source: lead.source, id: lead.id });
      batch.set(
        leadsRef.doc(docId),
        stripUndefined({
          ...lead,
          userId: user.uid,
          runId,
          createdAt: FieldValue.serverTimestamp(),
        }) as Record<string, unknown>,
        { merge: true }
      );
    });

    batch.set(
      runRef,
      stripUndefined({
        userId: user.uid,
        request: requestPayload,
        sourcesUsed,
        warnings,
        candidateTotal: rawTotal,
        filteredOut,
        sourceDiagnostics,
        total: scored.length,
        createdAt: FieldValue.serverTimestamp(),
      }) as Record<string, unknown>,
      { merge: true }
    );

    await batch.commit();

    log.info("lead.source.completed", {
      runId,
      sourcesUsed,
      total: scored.length,
    });

    return NextResponse.json({
      runId,
      leads: scored,
      sourcesUsed,
      warnings,
      candidateTotal: rawTotal,
      filteredOut,
      sourceDiagnostics,
    });
  },
  { route: "leads.source" }
);
