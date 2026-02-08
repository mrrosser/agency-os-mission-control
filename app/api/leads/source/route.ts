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

const bodySchema = z.object({
  query: z.string().min(1).max(120).optional(),
  industry: z.string().min(1).max(80).optional(),
  location: z.string().min(1).max(120).optional(),
  limit: z.number().int().min(1).max(25).optional(),
  minScore: z.number().int().min(0).max(100).optional(),
  sources: z.array(z.enum(["googlePlaces", "firestore"])).optional(),
  includeEnrichment: z.boolean().optional(),
});

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

    const { leads, sourcesUsed, warnings } = await sourceLeads(requestPayload, {
      uid: user.uid,
      googlePlacesKey,
      firecrawlKey,
      log,
    });

    const scored = leads
      .filter((lead) => (requestPayload.minScore ? (lead.score || 0) >= requestPayload.minScore : true))
      .sort((a, b) => (b.score || 0) - (a.score || 0));

    const batch = getAdminDb().batch();
    const leadsRef = runRef.collection("leads");
    scored.forEach((lead) => {
      const docId = `${lead.source}-${lead.id}`.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 120);
      batch.set(
        leadsRef.doc(docId),
        {
          ...lead,
          userId: user.uid,
          runId,
          createdAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    });

    batch.set(
      runRef,
      {
        userId: user.uid,
        request: requestPayload,
        sourcesUsed,
        warnings,
        total: scored.length,
        createdAt: FieldValue.serverTimestamp(),
      },
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
    });
  },
  { route: "leads.source" }
);
