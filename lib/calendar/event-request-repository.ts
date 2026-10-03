import "server-only";

import type { Firestore } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase-admin";

export const CALENDAR_EVENT_REQUEST_COLLECTION = "calendar_event_requests";

export interface CalendarEventRequestStore<T> {
  read(id: string): Promise<T | null>;
  transact<R>(
    id: string,
    transform: (current: T | null) => { record?: T; result: R }
  ): Promise<R>;
}

/** Transaction callbacks must contain only state transitions, never provider calls. */
export function createFirestoreCalendarEventRequestStore<T extends object>(
  db: Firestore = getAdminDb()
): CalendarEventRequestStore<T> {
  const ref = (id: string) => db.collection(CALENDAR_EVENT_REQUEST_COLLECTION).doc(id);
  return {
    async read(id) {
      const snapshot = await ref(id).get();
      return snapshot.exists ? (snapshot.data() as T) : null;
    },
    async transact(id, transform) {
      return db.runTransaction(async (transaction) => {
        const document = ref(id);
        const snapshot = await transaction.get(document);
        const current = snapshot.exists ? (snapshot.data() as T) : null;
        const next = transform(current);
        if (next.record) transaction.set(document, next.record);
        return next.result;
      });
    },
  };
}
