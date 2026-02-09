import "server-only";

import { FieldValue } from "firebase-admin/firestore";
import { createHash } from "crypto";
import { getAdminDb } from "@/lib/firebase-admin";
import type { Logger } from "@/lib/logging";

export type TelemetryErrorKind = "client" | "react" | "server";

export interface TelemetryErrorEvent {
  eventId: string;
  kind: TelemetryErrorKind;
  message: string;
  name?: string;
  stack?: string;
  url?: string;
  route?: string;
  userAgent?: string;
  occurredAt?: string;
  correlationId?: string;
  meta?: Record<string, unknown>;
}

function hashIp(ip: string): string {
  return createHash("sha256").update(ip).digest("hex");
}

function stripUndefined(value: unknown): unknown {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (Array.isArray(value)) {
    return value
      .map((item) => stripUndefined(item))
      .filter((item) => item !== undefined);
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      const cleaned = stripUndefined(val);
      if (cleaned === undefined) continue;
      out[key] = cleaned;
    }
    return out;
  }
  return value;
}

export async function storeTelemetryErrorEvent(
  args: {
    fingerprint: string;
    event: TelemetryErrorEvent;
    uid?: string | null;
    ip?: string | null;
  },
  log?: Logger
): Promise<{ replayed: boolean }> {
  const { fingerprint, event, uid, ip } = args;
  const db = getAdminDb();

  const groups = db.collection("telemetry_error_groups").doc(fingerprint);
  const events = db.collection("telemetry_error_events").doc(event.eventId);

  const ipHash = ip ? hashIp(ip) : null;

  return db.runTransaction(async (tx) => {
    const existing = await tx.get(events);
    if (existing.exists) {
      log?.info("telemetry.store.replayed", { fingerprint, eventId: event.eventId });
      return { replayed: true };
    }

    const eventDoc = stripUndefined({
      fingerprint,
      ...event,
      uid: uid || null,
      ipHash,
      createdAt: FieldValue.serverTimestamp(),
    }) as Record<string, unknown>;

    tx.set(
      events,
      eventDoc,
      { merge: false }
    );

    const groupSnap = await tx.get(groups);
    const now = FieldValue.serverTimestamp();

    if (!groupSnap.exists) {
      tx.set(
        groups,
        {
          fingerprint,
          kind: event.kind,
          count: 1,
          firstSeenAt: now,
          lastSeenAt: now,
          sample: {
            message: event.message,
            name: event.name || null,
            stack: event.stack || null,
            url: event.url || null,
            route: event.route || null,
            userAgent: event.userAgent || null,
            occurredAt: event.occurredAt || null,
            correlationId: event.correlationId || null,
            eventId: event.eventId,
          },
          last: {
            uid: uid || null,
            correlationId: event.correlationId || null,
            eventId: event.eventId,
          },
          triage: {
            status: "new",
            updatedAt: now,
          },
        },
        { merge: false }
      );
    } else {
      tx.set(
        groups,
        {
          kind: event.kind,
          count: FieldValue.increment(1),
          lastSeenAt: now,
          last: {
            uid: uid || null,
            correlationId: event.correlationId || null,
            eventId: event.eventId,
          },
        },
        { merge: true }
      );
    }

    log?.info("telemetry.store.completed", { fingerprint, eventId: event.eventId, uid: uid || null });
    return { replayed: false };
  });
}
