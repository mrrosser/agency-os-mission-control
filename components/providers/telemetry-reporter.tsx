"use client";

import { useEffect, useMemo, useRef } from "react";
import { useAuth } from "@/components/providers/auth-provider";
import { buildAuthHeaders } from "@/lib/api/client";

type TelemetryKind = "client" | "react";

export type TelemetryReportInput = {
  kind: TelemetryKind;
  message: string;
  name?: string;
  stack?: string;
  route?: string;
  correlationId?: string;
  meta?: Record<string, unknown>;
};

declare global {
  interface Window {
    __mcReportTelemetryError?: (input: TelemetryReportInput) => void;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function safeString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function coerceError(err: unknown): { name?: string; message: string; stack?: string } {
  if (err instanceof Error) {
    return { name: err.name, message: err.message, stack: err.stack };
  }
  if (typeof err === "string") return { message: err };
  if (typeof err === "object" && err !== null) {
    const anyErr = err as Record<string, unknown>;
    const message = safeString(anyErr.message) || safeString(anyErr.reason) || "Unknown error";
    return {
      name: safeString(anyErr.name),
      message,
      stack: safeString(anyErr.stack),
    };
  }
  return { message: String(err) };
}

function shouldIgnore(message: string): boolean {
  const m = message.toLowerCase();
  if (m.includes("/api/telemetry/error")) return true;
  if (m.includes("telemetry origin not allowed")) return true;
  // Common noisy browser errors that aren't actionable.
  if (m.includes("resizeobserver loop limit exceeded")) return true;
  return false;
}

function signature(input: TelemetryReportInput): string {
  const head = `${input.kind}|${input.name || ""}|${input.message}`;
  const stack = input.stack ? input.stack.split("\n").slice(0, 3).join("\n") : "";
  return `${head}|${stack}`.slice(0, 800);
}

export function TelemetryReporter() {
  const { user } = useAuth();
  const sessionId = useMemo(() => {
    try {
      const key = "mission_control_session_id";
      const existing = localStorage.getItem(key);
      if (existing) return existing;
      const created = crypto.randomUUID();
      localStorage.setItem(key, created);
      return created;
    } catch {
      return "unknown";
    }
  }, []);

  const recent = useRef(new Map<string, number>());

  async function report(input: TelemetryReportInput) {
    if (!input?.message) return;
    if (shouldIgnore(input.message)) return;

    const sig = signature(input);
    const now = Date.now();
    const last = recent.current.get(sig) || 0;
    if (now - last < 10_000) return; // de-dupe bursts
    recent.current.set(sig, now);

    const eventId = crypto.randomUUID();

    const payload = {
      eventId,
      kind: input.kind,
      name: input.name,
      message: input.message,
      stack: input.stack,
      url: typeof window !== "undefined" ? window.location.href : undefined,
      route: input.route,
      userAgent: typeof navigator !== "undefined" ? navigator.userAgent : undefined,
      occurredAt: nowIso(),
      correlationId: input.correlationId,
      meta: {
        sessionId,
        ...input.meta,
      },
    };

    try {
      const headers = await buildAuthHeaders(user, {
        correlationId: payload.correlationId,
      });
      await fetch("/api/telemetry/error", {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        keepalive: true,
      });
    } catch {
      // Never throw from telemetry.
    }
  }

  useEffect(() => {
    window.__mcReportTelemetryError = (input) => void report(input);
    return () => {
      delete window.__mcReportTelemetryError;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, sessionId]);

  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      const err = event.error ?? event.message;
      const coerced = coerceError(err);
      void report({
        kind: "client",
        name: coerced.name,
        message: coerced.message || event.message || "Unknown error",
        stack: coerced.stack,
        route: window.location.pathname,
        meta: {
          filename: event.filename || null,
          lineno: event.lineno || null,
          colno: event.colno || null,
          source: "window.onerror",
        },
      });
    };

    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      const coerced = coerceError(event.reason);
      void report({
        kind: "client",
        name: coerced.name,
        message: coerced.message,
        stack: coerced.stack,
        route: window.location.pathname,
        meta: { source: "unhandledrejection" },
      });
    };

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onUnhandledRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, sessionId]);

  return null;
}

