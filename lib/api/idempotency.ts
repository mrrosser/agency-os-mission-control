import { createHash } from "crypto";
import type { NextRequest } from "next/server";
import type { Logger } from "@/lib/logging";
import { getAdminDb } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";

export interface IdempotencyResult<T> {
  data: T;
  replayed: boolean;
}

export function getIdempotencyKey(
  request: NextRequest,
  body?: { idempotencyKey?: string }
): string | null {
  return (
    request.headers.get("x-idempotency-key") ||
    body?.idempotencyKey ||
    null
  );
}

export async function withIdempotency<T>(
  params: {
    uid: string;
    route: string;
    key: string | null;
    log?: Logger;
  },
  executor: () => Promise<T>
): Promise<IdempotencyResult<T>> {
  const { uid, route, key, log } = params;
  if (!key) {
    return { data: await executor(), replayed: false };
  }

  const id = createHash("sha256").update(`${uid}:${route}:${key}`).digest("hex");
  const docRef = getAdminDb().collection("idempotency").doc(id);
  const existing = await docRef.get();

  if (existing.exists) {
    log?.info("idempotency.replay", { route });
    return { data: existing.data()?.response as T, replayed: true };
  }

  const response = await executor();
  await docRef.set({
    uid,
    route,
    response,
    createdAt: FieldValue.serverTimestamp(),
  });
  log?.info("idempotency.recorded", { route });

  return { data: response, replayed: false };
}
