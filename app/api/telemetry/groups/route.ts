import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler, ApiError } from "@/lib/api/handler";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { getAdminDb } from "@/lib/firebase-admin";

const querySchema = z.object({
  runId: z.string().min(1).max(128).optional(),
  limit: z.coerce.number().int().min(1).max(25).optional(),
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

export const GET = withApiHandler(
  async ({ request, log }) => {
    const user = await requireFirebaseAuth(request, log);
    const requestUrl =
      "nextUrl" in request && request.nextUrl ? request.nextUrl : new URL(request.url);
    const parsed = querySchema.safeParse({
      runId: requestUrl.searchParams.get("runId") || undefined,
      limit: requestUrl.searchParams.get("limit") || undefined,
    });
    if (!parsed.success) {
      throw new ApiError(400, "Invalid query parameters", { issues: parsed.error.issues });
    }

    const runId = parsed.data.runId;
    const limit = parsed.data.limit || 10;

    let eventsQuery = getAdminDb().collection("telemetry_error_events").where("uid", "==", user.uid);
    if (runId) {
      eventsQuery = eventsQuery.where("correlationId", "==", runId);
    }

    const eventsSnap = await eventsQuery.limit(Math.max(limit * 5, 25)).get();
    const fingerprints = Array.from(
      new Set(
        eventsSnap.docs
          .map((doc) => String(doc.data()?.fingerprint || ""))
          .filter((value) => value.length > 0)
      )
    ).slice(0, 40);

    if (fingerprints.length === 0) {
      return NextResponse.json({ groups: [] });
    }

    const groups = await Promise.all(
      fingerprints.map(async (fingerprint) => {
        const snap = await getAdminDb().collection("telemetry_error_groups").doc(fingerprint).get();
        if (!snap.exists) return null;
        const data = snap.data() || {};
        return {
          fingerprint,
          kind: data.kind || "unknown",
          count: Number(data.count || 0),
          firstSeenAt: toIso(data.firstSeenAt),
          lastSeenAt: toIso(data.lastSeenAt),
          sample: {
            message: data.sample?.message || "",
            route: data.sample?.route || "",
            correlationId: data.sample?.correlationId || "",
            eventId: data.sample?.eventId || "",
          },
          triage: {
            status: data.triage?.status || "new",
            issueNumber: data.triage?.issueNumber || null,
            issueUrl: data.triage?.issueUrl || null,
            updatedAt: toIso(data.triage?.updatedAt),
          },
        };
      })
    );

    const filtered = groups
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
      .sort((a, b) => {
        if (b.count !== a.count) return b.count - a.count;
        return String(b.lastSeenAt || "").localeCompare(String(a.lastSeenAt || ""));
      })
      .slice(0, limit);

    return NextResponse.json({ groups: filtered });
  },
  { route: "telemetry.groups.get" }
);
