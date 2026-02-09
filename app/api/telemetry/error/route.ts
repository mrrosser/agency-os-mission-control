import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/handler";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { telemetryErrorSchema, type TelemetryErrorInput } from "@/lib/telemetry/schema";
import { sanitizeTelemetryMeta, sanitizeTelemetryString } from "@/lib/telemetry/sanitize";
import { computeTelemetryFingerprint } from "@/lib/telemetry/fingerprint";
import { storeTelemetryErrorEvent, type TelemetryErrorEvent } from "@/lib/telemetry/store";

const MAX_BODY_BYTES = 64 * 1024;
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 60;

const rateBuckets = new Map<string, { count: number; resetAt: number }>();

function pickClientIp(headers: Headers): string | null {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  const realIp = headers.get("x-real-ip")?.trim();
  return realIp || null;
}

function checkRateLimit(ip: string | null) {
  if (!ip) return;
  const now = Date.now();
  const existing = rateBuckets.get(ip);
  if (!existing || existing.resetAt <= now) {
    rateBuckets.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return;
  }
  existing.count += 1;
  if (existing.count > RATE_LIMIT) {
    throw new ApiError(429, "Too many telemetry reports; try again later.");
  }
}

function allowedOrigins(): string[] {
  const configured = process.env.TELEMETRY_ALLOWED_ORIGINS;
  if (configured) {
    return configured
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);
  }
  return [
    "http://localhost:3000",
    "http://localhost:5000",
    "http://localhost:8080",
    "https://leadflow-review.web.app",
    "https://leadflow-review.firebaseapp.com",
  ];
}

function enforceOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return;
  if (allowedOrigins().includes(origin)) return;
  throw new ApiError(403, "Telemetry origin not allowed");
}

async function parseLimitedJson<T>(request: Request): Promise<T> {
  const contentLength = request.headers.get("content-length");
  if (contentLength && Number(contentLength) > MAX_BODY_BYTES) {
    throw new ApiError(413, "Telemetry payload too large");
  }

  const raw = await request.text();
  if (!raw) throw new ApiError(400, "Missing JSON body");
  if (raw.length > MAX_BODY_BYTES) {
    throw new ApiError(413, "Telemetry payload too large");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ApiError(400, "Invalid JSON body");
  }

  const validated = telemetryErrorSchema.safeParse(parsed);
  if (!validated.success) {
    throw new ApiError(400, "Invalid telemetry payload", { issues: validated.error.issues });
  }

  return validated.data as T;
}

function sanitizeInput(input: TelemetryErrorInput): TelemetryErrorEvent {
  return {
    eventId: input.eventId,
    kind: input.kind,
    message: sanitizeTelemetryString(input.message, 4000) || "Unknown error",
    name: sanitizeTelemetryString(input.name, 200),
    stack: sanitizeTelemetryString(input.stack, 20000),
    url: sanitizeTelemetryString(input.url, 2000),
    route: sanitizeTelemetryString(input.route, 300),
    userAgent: sanitizeTelemetryString(input.userAgent, 500),
    occurredAt: sanitizeTelemetryString(input.occurredAt, 64),
    correlationId: sanitizeTelemetryString(input.correlationId, 200),
    meta: sanitizeTelemetryMeta(input.meta),
  };
}

export const POST = withApiHandler(
  async ({ request, log, correlationId }) => {
    if (process.env.TELEMETRY_ENABLED === "false") {
      return NextResponse.json({ ok: false, disabled: true }, { status: 200 });
    }

    enforceOrigin(request);

    const ip = pickClientIp(request.headers);
    checkRateLimit(ip);

    const body = await parseLimitedJson<TelemetryErrorInput>(request);
    const event = sanitizeInput(body);
    const fingerprint = computeTelemetryFingerprint({
      kind: event.kind,
      name: event.name,
      message: event.message,
      stack: event.stack,
      route: event.route,
      url: event.url,
    });

    // Prefer a client-provided correlation ID (e.g. from a failing API call),
    // but fall back to the request correlation ID.
    event.correlationId = event.correlationId || correlationId;

    let uid: string | null = null;
    const authHeader = request.headers.get("authorization");
    if (authHeader?.startsWith("Bearer ")) {
      try {
        const decoded = await requireFirebaseAuth(request, log);
        uid = decoded.uid;
      } catch (error) {
        // Telemetry should not fail hard if auth fails; capture anonymously.
        log.warn("telemetry.auth_failed", { reason: error instanceof Error ? error.message : String(error) });
      }
    }

    const stored = await storeTelemetryErrorEvent(
      {
        fingerprint,
        event,
        uid,
        ip,
      },
      log
    );

    log.info("telemetry.ingest.completed", {
      fingerprint,
      eventId: event.eventId,
      replayed: stored.replayed,
      uid: uid || null,
    });

    return NextResponse.json({
      ok: true,
      fingerprint,
      eventId: event.eventId,
      replayed: stored.replayed,
    });
  },
  { route: "telemetry.error" }
);

