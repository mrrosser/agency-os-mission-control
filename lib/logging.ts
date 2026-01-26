import { randomUUID } from "crypto";
import type { NextRequest } from "next/server";

export interface LogContext {
  correlationId: string;
  route?: string;
  service?: string;
}

export interface Logger {
  info: (message: string, meta?: Record<string, unknown>) => void;
  warn: (message: string, meta?: Record<string, unknown>) => void;
  error: (message: string, meta?: Record<string, unknown>) => void;
}

function writeLog(level: "info" | "warn" | "error", message: string, context: LogContext, meta?: Record<string, unknown>) {
  const payload = {
    level,
    message,
    timestamp: new Date().toISOString(),
    ...context,
    ...(meta || {}),
  };

  const line = JSON.stringify(payload);
  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export function createLogger(context: LogContext): Logger {
  return {
    info: (message, meta) => writeLog("info", message, context, meta),
    warn: (message, meta) => writeLog("warn", message, context, meta),
    error: (message, meta) => writeLog("error", message, context, meta),
  };
}

export function getCorrelationId(request: NextRequest): string {
  return request.headers.get("x-correlation-id") || randomUUID();
}

export function sanitizeError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  return { message: "Unknown error", detail: String(error) };
}
