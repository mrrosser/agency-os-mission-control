import { NextResponse, type NextRequest } from "next/server";
import { randomUUID } from "crypto";
import { createLogger, getCorrelationId, sanitizeError, type Logger } from "@/lib/logging";
import { computeTelemetryFingerprint } from "@/lib/telemetry/fingerprint";
import { storeTelemetryErrorEvent } from "@/lib/telemetry/store";

export class ApiError extends Error {
  status: number;
  details?: Record<string, unknown>;

  constructor(status: number, message: string, details?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export interface ApiHandlerContext {
  request: NextRequest;
  correlationId: string;
  log: Logger;
  params?: Record<string, string>;
}

type RouteContext = { params: Promise<Record<string, string>> };

function isApiErrorLike(error: unknown): error is { status: number; message: string; details?: Record<string, unknown> } {
  return (
    typeof error === "object" &&
    error !== null &&
    typeof (error as Record<string, unknown>).status === "number" &&
    typeof (error as Record<string, unknown>).message === "string"
  );
}

function pickClientIp(headers: Headers): string | null {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  const realIp = headers.get("x-real-ip")?.trim();
  return realIp || null;
}

export function withApiHandler(
  handler: (context: ApiHandlerContext) => Promise<NextResponse>,
  options?: { route: string }
) {
  // Next.js route handlers are typed to always receive a 2nd "context" argument.
  // Keep runtime defensive (optional chaining), but type the param as required
  // to satisfy Next's generated type checks.
  return async function (request: NextRequest, context: RouteContext) {
    const correlationId = getCorrelationId(request);
    const log = createLogger({ correlationId, route: options?.route });
    const path = request.nextUrl?.pathname || "unknown";

    log.info("request.received", { method: request.method, path });

    try {
      const params = await context.params;
      const response = await handler({
        request,
        correlationId,
        log,
        params,
      });
      response.headers.set("x-correlation-id", correlationId);
      log.info("request.completed", { status: response.status, path });
      return response;
    } catch (error) {
      const apiError = error instanceof ApiError ? error : isApiErrorLike(error) ? error : null;
      const status = apiError?.status || 500;
      const message = apiError?.message || "Internal server error";
      const response = NextResponse.json(
        {
          error: message,
          correlationId,
          details: apiError && "details" in apiError ? apiError.details : undefined,
        },
        { status }
      );
      response.headers.set("x-correlation-id", correlationId);

      // 4xx responses are expected (validation/auth), so log at warn to avoid noisy error logs.
      const meta = { status, path, error: sanitizeError(error) };
      if (status >= 500) {
        log.error("request.failed", meta);
      } else {
        log.warn("request.failed", meta);
      }

      // Optional: capture server-side 5xx for automated triage.
      // Guard against recursion for telemetry endpoints.
      if (
        status >= 500 &&
        process.env.TELEMETRY_ENABLED !== "false" &&
        process.env.TELEMETRY_SERVER_ERRORS === "true" &&
        !(path.startsWith("/api/telemetry/") || options?.route === "telemetry.error")
      ) {
        try {
          const sanitized = sanitizeError(error);
          const event = {
            eventId: randomUUID(),
            kind: "server" as const,
            name: sanitized.name,
            message: sanitized.message || message,
            stack: sanitized.stack,
            url: path,
            route: options?.route,
            userAgent: request.headers.get("user-agent") || undefined,
            occurredAt: new Date().toISOString(),
            correlationId,
            meta: {
              method: request.method,
              path,
              status,
            },
          };

          const fingerprint = computeTelemetryFingerprint({
            kind: event.kind,
            name: event.name || undefined,
            message: event.message,
            stack: event.stack || undefined,
            route: options?.route,
            url: path,
          });

          // Best-effort; never block response delivery.
          void storeTelemetryErrorEvent(
            {
              fingerprint,
              event,
              uid: null,
              ip: pickClientIp(request.headers),
            },
            log
          );
        } catch (_telemetryError) {
          // ignore
        }
      }
      return response;
    }
  };
}
