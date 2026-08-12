import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { readBoundedRequestBody } from "@/lib/api/bounded-body";
import { globallyUnsubscribeWarmReconnectCapability } from "@/lib/crm/warm-reconnect-preferences";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type RouteContext = { params: Promise<{ token: string }> };

const GENERIC_PAYLOAD = {
  ok: true,
  message: "Your unsubscribe request has been received.",
};

function secureJson(correlationId = randomUUID()) {
  const response = NextResponse.json(GENERIC_PAYLOAD);
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("Pragma", "no-cache");
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set(
    "Content-Security-Policy",
    "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
  );
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("x-correlation-id", correlationId);
  return response;
}

export async function GET() {
  return secureJson();
}

export async function POST(request: NextRequest, context: RouteContext) {
  const correlationId = randomUUID();
  try {
    if (new URL(request.url).search) return secureJson(correlationId);
    const contentType = request.headers.get("content-type")?.toLowerCase() || "";
    if (
      !contentType.startsWith("application/x-www-form-urlencoded")
    ) {
      return secureJson(correlationId);
    }
    const rawBody = await readBoundedRequestBody(request, 1_024);
    if (rawBody !== "List-Unsubscribe=One-Click") return secureJson(correlationId);
    const { token } = await context.params;
    const result = await globallyUnsubscribeWarmReconnectCapability(token, {
      requiredScope: "unsubscribe_only",
    });
    console.info(
      JSON.stringify({
        event: "crm.warm_reconnect.one_click_unsubscribe_processed",
        correlationId,
        available: result.available,
      })
    );
    return secureJson(correlationId);
  } catch {
    // Never include the dynamic path, raw capability, contact data, or caught error.
    console.error(
      JSON.stringify({
        event: "crm.warm_reconnect.one_click_unsubscribe_failed",
        correlationId,
      })
    );
    return secureJson(correlationId);
  }
}
