import { NextResponse } from "next/server";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { z } from "zod";
import { withApiHandler } from "@/lib/api/handler";
import { parseJson } from "@/lib/api/validation";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { getAccessTokenForUser } from "@/lib/google/oauth";
import { listMetadataSince } from "@/lib/google/drive";
import { getAdminDb } from "@/lib/firebase-admin";
import { getIdempotencyKey, withIdempotency } from "@/lib/api/idempotency";

const SCAN_DOC_ID = "default";
const DEFAULT_MAX_FILES = 200;
const DEFAULT_LOOKBACK_DAYS = 7;

const bodySchema = z.object({
  folderIds: z.array(z.string().trim().min(1).max(180)).max(20).optional(),
  maxFiles: z.number().int().min(1).max(500).optional(),
  dryRun: z.boolean().optional(),
  idempotencyKey: z.string().optional(),
});

function scanDocRef(uid: string) {
  return getAdminDb()
    .collection("identities")
    .doc(uid)
    .collection("drive_delta_scan")
    .doc(SCAN_DOC_ID);
}

function parseDateLike(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.valueOf()) ? null : parsed;
  }
  const candidate = value as { toDate?: () => Date };
  if (typeof candidate.toDate === "function") {
    try {
      return candidate.toDate();
    } catch {
      return null;
    }
  }
  return null;
}

function checkpointFromSnapshot(data: Record<string, unknown> | undefined): string {
  const existing = parseDateLike(data?.lastCheckpoint);
  if (existing) return existing.toISOString();
  return new Date(Date.now() - DEFAULT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

function staleDays(lastRunAtIso: string | null): number | null {
  if (!lastRunAtIso) return null;
  const ts = Date.parse(lastRunAtIso);
  if (!Number.isFinite(ts)) return null;
  return Math.max(0, Math.floor((Date.now() - ts) / (24 * 60 * 60 * 1000)));
}

function summaryFromDoc(doc: Record<string, unknown> | undefined) {
  const lastCheckpoint = parseDateLike(doc?.lastCheckpoint)?.toISOString() || null;
  const lastRunAt = parseDateLike(doc?.lastRunAt)?.toISOString() || null;
  const lastResultCount = Number(doc?.lastResultCount || 0);
  const folderIds = Array.isArray(doc?.folderIds)
    ? doc!.folderIds.filter((id): id is string => typeof id === "string")
    : [];
  const maxFiles = Number(doc?.maxFiles || DEFAULT_MAX_FILES);
  return {
    lastCheckpoint,
    lastRunAt,
    lastResultCount,
    staleDays: staleDays(lastRunAt),
    folderIds,
    maxFiles,
  };
}

export const GET = withApiHandler(
  async ({ request, log }) => {
    const user = await requireFirebaseAuth(request, log);
    const snap = await scanDocRef(user.uid).get();
    const data = snap.exists ? (snap.data() as Record<string, unknown>) : undefined;
    return NextResponse.json({ summary: summaryFromDoc(data) });
  },
  { route: "drive.delta-scan.status" }
);

export const POST = withApiHandler(
  async ({ request, log }) => {
    const body = await parseJson(request, bodySchema);
    const user = await requireFirebaseAuth(request, log);
    const accessToken = await getAccessTokenForUser(user.uid, log);
    const idempotencyKey = getIdempotencyKey(request, body);

    const result = await withIdempotency(
      { uid: user.uid, route: "drive.delta-scan.run", key: idempotencyKey, log },
      async () => {
        const ref = scanDocRef(user.uid);
        const snap = await ref.get();
        const existing = snap.exists ? (snap.data() as Record<string, unknown>) : undefined;

        const folderIds = Array.isArray(body.folderIds) && body.folderIds.length > 0
          ? body.folderIds
          : (Array.isArray(existing?.folderIds) ? (existing?.folderIds as string[]) : []);
        const maxFiles = body.maxFiles || Number(existing?.maxFiles || DEFAULT_MAX_FILES);
        const checkpointIso = checkpointFromSnapshot(existing);

        const files = await listMetadataSince(
          accessToken,
          checkpointIso,
          { folderIds, maxFiles },
          log
        );

        const newestModifiedIso = files.reduce<string | null>((acc, file) => {
          const ts = Date.parse(file.modifiedTime || "");
          if (!Number.isFinite(ts)) return acc;
          const candidate = new Date(ts).toISOString();
          if (!acc) return candidate;
          return Date.parse(candidate) > Date.parse(acc) ? candidate : acc;
        }, null);
        const lastCheckpoint = newestModifiedIso || checkpointIso;

        if (!body.dryRun) {
          await ref.set(
            {
              lastCheckpoint: Timestamp.fromDate(new Date(lastCheckpoint)),
              lastRunAt: FieldValue.serverTimestamp(),
              lastResultCount: files.length,
              folderIds,
              maxFiles,
              updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true }
          );
        }

        log.info("drive.delta-scan.completed", {
          uid: user.uid,
          scannedCount: files.length,
          maxFiles,
          folderCount: folderIds.length,
          checkpointIso,
          lastCheckpoint,
          dryRun: Boolean(body.dryRun),
        });

        const summary = summaryFromDoc({
          ...(existing || {}),
          lastCheckpoint,
          lastRunAt: body.dryRun ? existing?.lastRunAt : new Date().toISOString(),
          lastResultCount: files.length,
          folderIds,
          maxFiles,
        });

        return {
          scannedCount: files.length,
          summary,
          sample: files.slice(0, 25),
        };
      }
    );

    return NextResponse.json({
      success: true,
      replayed: result.replayed,
      ...result.data,
    });
  },
  { route: "drive.delta-scan.run" }
);
