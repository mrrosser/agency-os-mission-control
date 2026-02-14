import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, withApiHandler } from "@/lib/api/handler";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { resolveSecret } from "@/lib/api/secrets";

const querySchema = z.object({
  ref: z.string().min(1).max(400),
  maxWidth: z.coerce.number().int().min(120).max(1600).optional().default(720),
});

function getSearchParams(request: Request): URLSearchParams {
  const anyReq = request as unknown as { nextUrl?: { searchParams?: URLSearchParams } };
  const nextParams = anyReq.nextUrl?.searchParams;
  if (nextParams) return nextParams;
  try {
    return new URL(request.url).searchParams;
  } catch {
    return new URLSearchParams();
  }
}

function pickContentType(contentType: string | null): string {
  const normalized = (contentType || "").toLowerCase();
  if (normalized.startsWith("image/")) return contentType as string;
  return "image/jpeg";
}

export const GET = withApiHandler(
  async ({ request, log }) => {
    const user = await requireFirebaseAuth(request, log);

    const parsed = querySchema.safeParse(
      Object.fromEntries(getSearchParams(request).entries())
    );
    if (!parsed.success) {
      throw new ApiError(400, "Invalid request", {
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path,
          message: issue.message,
        })),
      });
    }

    const placesKey = await resolveSecret(user.uid, "googlePlacesKey", "GOOGLE_PLACES_API_KEY");
    if (!placesKey) {
      throw new ApiError(500, "Missing GOOGLE_PLACES_API_KEY");
    }

    const url = new URL("https://maps.googleapis.com/maps/api/place/photo");
    url.searchParams.set("maxwidth", String(parsed.data.maxWidth));
    url.searchParams.set("photo_reference", parsed.data.ref);
    url.searchParams.set("key", placesKey);

    log.info("google.places.photo.request", {
      maxWidth: parsed.data.maxWidth,
      refPrefix: parsed.data.ref.slice(0, 10),
    });

    const upstream = await fetch(url.toString(), { redirect: "follow" });
    if (!upstream.ok) {
      const contentType = upstream.headers.get("content-type") || "";
      const snippet = contentType.includes("application/json") ? await upstream.text() : "";
      throw new ApiError(502, `Places photo fetch failed (status ${upstream.status})`, {
        upstreamStatus: upstream.status,
        upstreamContentType: contentType,
        upstreamBody: snippet ? snippet.slice(0, 300) : undefined,
      });
    }

    const bytes = await upstream.arrayBuffer();
    const contentType = pickContentType(upstream.headers.get("content-type"));

    return new NextResponse(bytes, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        // Photo references are stable; keep browser caching strong but user-scoped.
        "Cache-Control": "private, max-age=86400",
        "Vary": "Authorization",
      },
    });
  },
  { route: "google.places.photo" }
);
