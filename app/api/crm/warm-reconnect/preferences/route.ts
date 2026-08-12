import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { readBoundedRequestBody } from "@/lib/api/bounded-body";
import {
  processWarmReconnectPreferenceMutation,
  type WarmReconnectPreferenceMutation,
  type WarmReconnectTopics,
} from "@/lib/crm/warm-reconnect-preferences";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const CSP =
  "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";
const GENERIC_PAYLOAD = {
  ok: true,
  message: "If this preference link is available, your request has been processed.",
  available: false,
  expired: false,
  canUpdatePreferences: false,
  canUnsubscribe: false,
  globallyUnsubscribed: false,
  topics: {
    marcus_rosser_art: false,
    rosser_gallery: false,
    rt_solutions: false,
  },
};

function secureJson(payload: unknown, status = 200, correlationId = randomUUID()) {
  const response = NextResponse.json(payload, { status });
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("Pragma", "no-cache");
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("Content-Security-Policy", CSP);
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("x-correlation-id", correlationId);
  return response;
}

function isTopics(value: unknown): value is WarmReconnectTopics {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  const keys = Object.keys(candidate).sort();
  if (keys.join(",") !== "marcus_rosser_art,rosser_gallery,rt_solutions") return false;
  return keys.every((key) => typeof candidate[key] === "boolean");
}

function parseMutation(value: unknown): WarmReconnectPreferenceMutation | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (typeof body.token !== "string") return null;
  if (body.action === "inspect" && Object.keys(body).length === 2) {
    return { action: "inspect", token: body.token };
  }
  if (body.action === "unsubscribe" && Object.keys(body).length === 2) {
    return { action: "unsubscribe", token: body.token };
  }
  if (
    body.action === "save_preferences" &&
    typeof body.requestId === "string" &&
    isTopics(body.topics) &&
    Object.keys(body).length === 4
  ) {
    return {
      action: "save_preferences",
      token: body.token,
      requestId: body.requestId,
      topics: body.topics,
    };
  }
  return null;
}

export async function GET() {
  return secureJson(GENERIC_PAYLOAD);
}

export async function POST(request: NextRequest) {
  const correlationId = randomUUID();
  try {
    if (new URL(request.url).search) return secureJson(GENERIC_PAYLOAD, 200, correlationId);
    const contentType = request.headers.get("content-type")?.toLowerCase() || "";
    if (!contentType.startsWith("application/json")) {
      return secureJson(GENERIC_PAYLOAD, 200, correlationId);
    }
    const rawBody = await readBoundedRequestBody(request, 4_096);
    const mutation = parseMutation(JSON.parse(rawBody));
    if (!mutation) return secureJson(GENERIC_PAYLOAD, 200, correlationId);

    const result = await processWarmReconnectPreferenceMutation(mutation);
    console.info(
      JSON.stringify({
        event: "crm.warm_reconnect.preference_processed",
        correlationId,
        action: mutation.action,
        available: result.available,
        globallyUnsubscribed: result.globallyUnsubscribed,
      })
    );
    return secureJson(result, 200, correlationId);
  } catch {
    console.error(
      JSON.stringify({
        event: "crm.warm_reconnect.preference_failed",
        correlationId,
      })
    );
    return secureJson(GENERIC_PAYLOAD, 200, correlationId);
  }
}
