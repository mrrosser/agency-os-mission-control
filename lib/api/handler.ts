import { NextResponse, type NextRequest } from "next/server";
import { createLogger, getCorrelationId, sanitizeError, type Logger } from "@/lib/logging";

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

type RouteContext = { params: Promise<Record<string, string> | {}> };

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
      const params = context?.params ? await context.params : {};
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
      const apiError = error instanceof ApiError ? error : null;
      const status = apiError?.status || 500;
      const message = apiError?.message || "Internal server error";
      const response = NextResponse.json(
        {
          error: message,
          correlationId,
          details: apiError?.details,
        },
        { status }
      );
      response.headers.set("x-correlation-id", correlationId);
      log.error("request.failed", {
        status,
        path,
        error: sanitizeError(error),
      });
      return response;
    }
  };
}
