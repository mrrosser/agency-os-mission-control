import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { readBoundedRequestBody } from "@/lib/api/bounded-body";
import { globallyUnsubscribeWarmReconnectCapability } from "@/lib/crm/warm-reconnect-preferences";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const GENERIC_PAYLOAD = {
  ok: true,
  message: "If this unsubscribe link is available, your request has been processed.",
};

function secureJson(payload: unknown, correlationId = randomUUID()) {
  const response = NextResponse.json(payload);
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
  return secureJson(GENERIC_PAYLOAD);
}

export async function POST(request: NextRequest) {
  const correlationId = randomUUID();
  try {
    if (new URL(request.url).search) return secureJson(GENERIC_PAYLOAD, correlationId);
    const contentType = request.headers.get("content-type")?.toLowerCase() || "";
    if (!contentType.startsWith("application/json")) {
      return secureJson(GENERIC_PAYLOAD, correlationId);
    }
    const rawBody = await readBoundedRequestBody(request, 1_024);
    const body = JSON.parse(rawBody) as Record<string, unknown>;
    if (
      !body ||
      typeof body.token !== "string" ||
      Object.keys(body).length !== 1
    ) {
      return secureJson(GENERIC_PAYLOAD, correlationId);
    }
    const result = await globallyUnsubscribeWarmReconnectCapability(body.token);
    console.info(
      JSON.stringify({
        event: "crm.warm_reconnect.unsubscribe_processed",
        correlationId,
        available: result.available,
      })
    );
    return secureJson(GENERIC_PAYLOAD, correlationId);
  } catch {
    console.error(
      JSON.stringify({ event: "crm.warm_reconnect.unsubscribe_failed", correlationId })
    );
    return secureJson(GENERIC_PAYLOAD, correlationId);
  }
}
