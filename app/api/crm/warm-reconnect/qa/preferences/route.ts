import type { NextRequest } from "next/server";
import { z } from "zod";
import { readBoundedRequestBody } from "@/lib/api/bounded-body";
import { processWarmReconnectQaPreference } from "@/lib/crm/warm-reconnect-qa";
import { secureWarmReconnectQaJson, WARM_RECONNECT_QA_UNAVAILABLE } from "@/lib/crm/warm-reconnect-qa-route";

export const dynamic = "force-dynamic";
export const revalidate = 0;
const token = z.string().regex(/^[A-Za-z0-9_-]{43,128}$/);
const confirmation = { token, requestId: z.string().regex(/^[A-Za-z0-9_.:-]{1,160}$/), confirmationNonce: z.string().regex(/^[a-f0-9]{64}$/) };
const mutation = z.discriminatedUnion("action", [
  z.object({ action: z.literal("inspect"), token }).strict(),
  z.object({ action: z.literal("unsubscribe"), ...confirmation }).strict(),
  z.object({ action: z.literal("save_preferences"), ...confirmation,
    topics: z.object({ rosser_gallery: z.boolean(), rt_solutions: z.boolean() }).strict().refine((value) => value.rosser_gallery || value.rt_solutions),
  }).strict(),
]);

export async function GET() { return secureWarmReconnectQaJson(WARM_RECONNECT_QA_UNAVAILABLE); }
export async function HEAD() { return new Response(null, { headers: GET_HEADERS }); }
const GET_HEADERS = { "Cache-Control": "private, no-store, max-age=0", "Referrer-Policy": "no-referrer" };

export async function POST(request: NextRequest) {
  try {
    if (new URL(request.url).search || !request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return GET();
    const parsed = mutation.safeParse(JSON.parse(await readBoundedRequestBody(request, 4096)));
    if (!parsed.success) return GET();
    return secureWarmReconnectQaJson(await processWarmReconnectQaPreference(parsed.data));
  } catch {
    // Do not log raw capabilities, request payloads, or provider/Firestore exceptions.
    return GET();
  }
}
