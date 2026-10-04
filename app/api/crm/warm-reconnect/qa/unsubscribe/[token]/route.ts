import type { NextRequest } from "next/server";
import { readBoundedRequestBody } from "@/lib/api/bounded-body";
import { unsubscribeWarmReconnectQaToken } from "@/lib/crm/warm-reconnect-qa";
import { secureWarmReconnectQaJson } from "@/lib/crm/warm-reconnect-qa-route";

export const dynamic = "force-dynamic";
export const revalidate = 0;
const result = { ok: true, testMode: true, message: "Your test unsubscribe request has been received. Real subscriptions are unchanged." };
export async function GET() { return secureWarmReconnectQaJson(result); }
export async function HEAD() { return new Response(null, { headers: { "Cache-Control": "private, no-store, max-age=0", "Referrer-Policy": "no-referrer" } }); }

export async function POST(request: NextRequest, context: { params: Promise<{ token: string }> }) {
  try {
    if (new URL(request.url).search || !request.headers.get("content-type")?.toLowerCase().startsWith("application/x-www-form-urlencoded")) return GET();
    if (await readBoundedRequestBody(request, 1024) !== "List-Unsubscribe=One-Click") return GET();
    const { token } = await context.params;
    await unsubscribeWarmReconnectQaToken(token);
  } catch { /* Intentionally omit dynamic URL and token from logging. */ }
  return GET();
}
