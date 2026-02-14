import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { withApiHandler, ApiError } from "@/lib/api/handler";
import { getAdminDb } from "@/lib/firebase-admin";

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

async function loadClip(clipId: string) {
  const clipRef = getAdminDb().collection("call_audio_clips").doc(clipId);
  const snap = await clipRef.get();
  if (!snap.exists) {
    throw new ApiError(404, "Audio clip not found");
  }

  const data = snap.data() || {};
  const expiresAt = parseDateLike(data.expiresAt);
  if (expiresAt && expiresAt.getTime() <= Date.now()) {
    throw new ApiError(410, "Audio clip expired");
  }

  const audioBase64 = String(data.audioBase64 || "");
  if (!audioBase64) {
    throw new ApiError(404, "Audio content missing");
  }

  const audioBuffer = Buffer.from(audioBase64, "base64");
  const mimeType = String(data.mimeType || "audio/mpeg");

  void clipRef.set(
    {
      servedCount: Number(data.servedCount || 0) + 1,
      lastServedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  return { audioBuffer, mimeType };
}

export const GET = withApiHandler(
  async ({ params }) => {
    const clipId = params?.clipId;
    if (!clipId) {
      throw new ApiError(400, "Missing clipId");
    }

    const clip = await loadClip(clipId);
    return new NextResponse(clip.audioBuffer, {
      status: 200,
      headers: {
        "Content-Type": clip.mimeType,
        "Cache-Control": "public, max-age=300",
      },
    });
  },
  { route: "public.call-audio.get" }
);

export const HEAD = withApiHandler(
  async ({ params }) => {
    const clipId = params?.clipId;
    if (!clipId) {
      throw new ApiError(400, "Missing clipId");
    }

    const clip = await loadClip(clipId);
    return new NextResponse(null, {
      status: 200,
      headers: {
        "Content-Type": clip.mimeType,
        "Cache-Control": "public, max-age=300",
      },
    });
  },
  { route: "public.call-audio.head" }
);
