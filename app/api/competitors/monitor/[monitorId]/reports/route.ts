import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler, ApiError } from "@/lib/api/handler";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { getAdminDb } from "@/lib/firebase-admin";

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(25).optional(),
  includeContent: z.coerce.boolean().optional(),
});

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
  async ({ request, params, log }) => {
    const user = await requireFirebaseAuth(request, log);
    const monitorId = params?.monitorId;
    if (!monitorId) throw new ApiError(400, "Missing monitorId");

    const url = new URL(request.url);
    const parsed = querySchema.safeParse({
      limit: url.searchParams.get("limit") || undefined,
      includeContent: url.searchParams.get("includeContent") || undefined,
    });
    if (!parsed.success) {
      throw new ApiError(400, "Invalid query parameters");
    }

    const limit = parsed.data.limit || 10;
    const includeContent = Boolean(parsed.data.includeContent);
    const monitorRef = getAdminDb()
      .collection("identities")
      .doc(user.uid)
      .collection("competitor_monitors")
      .doc(monitorId);

    const monitorSnap = await monitorRef.get();
    if (!monitorSnap.exists) throw new ApiError(404, "Competitor monitor not found");

    const reportsSnap = await monitorRef
      .collection("reports")
      .orderBy("createdAt", "desc")
      .limit(limit)
      .get();

    const reports = reportsSnap.docs.map((doc) => {
      const data = doc.data() as Record<string, unknown>;
      return {
        reportId: doc.id,
        monitorId,
        generatedAt: (data.generatedAt as string | undefined) || null,
        createdAt: toIso(data.createdAt),
        competitorCount: Number(data.competitorCount || 0),
        summary: (data.summary as Record<string, unknown> | undefined) || {},
        markdown: includeContent ? String(data.markdown || "") : undefined,
        html: includeContent ? String(data.html || "") : undefined,
      };
    });

    return NextResponse.json({ monitorId, reports });
  },
  { route: "competitors.monitor.reports.list" }
);
