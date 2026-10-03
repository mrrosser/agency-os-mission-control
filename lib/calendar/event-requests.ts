import "server-only";

import { createHash, randomUUID } from "crypto";
import { ApiError } from "@/lib/api/handler";
import { assertPortfolioRegistryAccess } from "@/lib/crm/portfolio-registry";
import type { CalendarEvent } from "@/lib/google/calendar";
import type { Logger } from "@/lib/logging";
import {
  CalendarApprovalSchema,
  CalendarFingerprintSchema,
  CalendarRequestIdSchema,
  normalizeCalendarEventDraft,
  type CalendarChoice,
  type CalendarEventDraft,
  type CalendarEventReview,
  type NormalizedCalendarEvent,
} from "./event-contract";
import {
  checkSelectedCalendarAvailability,
  getSelectedCalendarEvent,
  insertReviewedCalendarEvent,
  requireCalendarChoice,
  resolveCalendarContext,
  type CalendarContext,
  type ReviewedCalendarEventPayload,
} from "./google-calendar-context";
import {
  createFirestoreCalendarEventRequestStore,
  type CalendarEventRequestStore,
} from "./event-request-repository";

const REVIEW_LIFETIME_MS = 15 * 60_000;
const APPROVAL_AUTH_AGE_SECONDS = 5 * 60;
const APPROVAL_PROVIDERS = new Set(["google.com", "password", "apple.com", "phone"]);

type CalendarBinding = Pick<
  CalendarContext,
  "profileId" | "accountId" | "accountEmail" | "accountSubject" | "bindingFingerprint"
>;

export interface StoredCalendarEventRequest {
  schemaVersion: 1;
  requestId: string;
  fingerprint: string;
  reviewNonce: string;
  ownerUid: string;
  workspaceId: string;
  binding: CalendarBinding;
  calendar: CalendarChoice;
  event: NormalizedCalendarEvent;
  status: CalendarEventReview["status"];
  createdAt: string;
  expiresAt: string;
  updatedAt: string;
  availability: CalendarEventReview["availability"];
  approvedAt: string | null;
  approvedByUid: string | null;
  approvalAuthTime: number | null;
  approvalProvider: string | null;
  providerEventId: string;
  providerAttemptStartedAt: string | null;
  receipt: CalendarEventReview["receipt"];
  error: string | null;
}

export interface CalendarApprovalAuth {
  authTime: number;
  provider: string;
}

export interface CalendarEventRequestDependencies {
  store: CalendarEventRequestStore<StoredCalendarEventRequest>;
  assertOwner(uid: string): Promise<{ workspaceId: string }>;
  resolveContext: typeof resolveCalendarContext;
  requireChoice: typeof requireCalendarChoice;
  checkAvailability: typeof checkSelectedCalendarAvailability;
  getEvent: typeof getSelectedCalendarEvent;
  insertEvent: typeof insertReviewedCalendarEvent;
  now?: () => number;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function digest(value: unknown): string {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

function identity(context: CalendarContext): CalendarBinding {
  // Never persist or return a spread of the provider context: it contains an access token.
  return {
    profileId: context.profileId,
    accountId: context.accountId,
    accountEmail: context.accountEmail,
    accountSubject: context.accountSubject,
    bindingFingerprint: context.bindingFingerprint,
  };
}

function actionFingerprint(input: {
  ownerUid: string;
  workspaceId: string;
  binding: CalendarBinding;
  calendar: CalendarChoice;
  event: NormalizedCalendarEvent;
  reviewNonce: string;
}): string {
  return digest({ contract: "calendar-event-action.v1", ...input });
}

function requestIdFor(uid: string, subject: string, event: NormalizedCalendarEvent): string {
  // A profile alias, calendar label, ACL or grant change must never create a second
  // provider attempt for the same logical event, including an uncertain attempt.
  return digest({
    contract: "calendar-event-request.v1", uid, accountSubject: subject, calendarId: event.calendarId,
    event: {
      summary: event.summary, description: event.description, location: event.location,
      startDateTime: event.startDateTime, endDateTime: event.endDateTime, timeZone: event.timeZone,
      attendees: event.attendees, sendUpdates: event.sendUpdates,
    },
  });
}

function assertId(id: string): void {
  if (!CalendarRequestIdSchema.safeParse(id).success) throw new ApiError(400, "Invalid calendar request ID.");
}

function assertFingerprint(record: StoredCalendarEventRequest, fingerprint: string): void {
  if (!CalendarFingerprintSchema.safeParse(fingerprint).success || fingerprint !== record.fingerprint) {
    throw new ApiError(409, "The event review changed. Review the exact event again.");
  }
}

function assertOwned(
  record: StoredCalendarEventRequest | null,
  uid: string,
  workspaceId: string,
  id: string
): StoredCalendarEventRequest {
  if (!record || record.ownerUid !== uid || record.workspaceId !== workspaceId) {
    throw new ApiError(404, "Calendar request not found.");
  }
  if (record.schemaVersion !== 1 || record.requestId !== id ||
      record.providerEventId !== `aos${id}` ||
      typeof record.reviewNonce !== "string" || !record.reviewNonce ||
      requestIdFor(uid, record.binding.accountSubject, record.event) !== id ||
      actionFingerprint({ ownerUid: record.ownerUid, workspaceId: record.workspaceId, binding: record.binding, calendar: record.calendar, event: record.event, reviewNonce: record.reviewNonce }) !== record.fingerprint) {
    throw new ApiError(409, "The stored calendar request could not be reconciled.");
  }
  return record;
}

function publicReview(record: StoredCalendarEventRequest): CalendarEventReview {
  return {
    requestId: record.requestId,
    fingerprint: record.fingerprint,
    status: record.status,
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
    accountEmail: record.binding.accountEmail,
    calendar: { ...record.calendar },
    event: { ...record.event, attendees: [...record.event.attendees] },
    availability: { ...record.availability },
    approvedAt: record.approvedAt,
    receipt: record.receipt ? { ...record.receipt } : null,
    error: record.error,
  };
}

function assertUnexpired(record: StoredCalendarEventRequest, now: number): void {
  const expiresAt = Date.parse(record.expiresAt);
  if (!Number.isFinite(expiresAt) || now >= expiresAt || now >= Date.parse(record.event.startDateTime)) {
    throw new ApiError(409, "This event review has expired. Prepare and review a new event.");
  }
}

function canRenewReview(record: StoredCalendarEventRequest, now: number): boolean {
  return !record.providerAttemptStartedAt && (record.status === "blocked" ||
    (["awaiting_approval", "approved"].includes(record.status) && now >= Date.parse(record.expiresAt)));
}

function assertFreshApproval(record: StoredCalendarEventRequest, auth: CalendarApprovalAuth, now: number): void {
  const earliestAuthTime = Math.ceil(Date.parse(record.createdAt) / 1000);
  const nowSeconds = now / 1000;
  if (!APPROVAL_PROVIDERS.has(auth.provider) || !Number.isInteger(auth.authTime) ||
      auth.authTime < earliestAuthTime || auth.authTime < nowSeconds - APPROVAL_AUTH_AGE_SECONDS ||
      auth.authTime > nowSeconds + 30) {
    throw new ApiError(403, "Reauthenticate your app account after preparing this event, then explicitly approve it. If preparation and reauthentication happened in the same second, reauthenticate again.");
  }
}

function payloadFor(record: StoredCalendarEventRequest): ReviewedCalendarEventPayload {
  return {
    id: record.providerEventId,
    summary: record.event.summary,
    description: record.event.description,
    location: record.event.location,
    start: { dateTime: record.event.startDateTime, timeZone: record.event.timeZone },
    end: { dateTime: record.event.endDateTime, timeZone: record.event.timeZone },
    attendees: record.event.attendees.map((email) => ({ email })),
    extendedProperties: { private: { agencyosRequestId: record.requestId, agencyosFingerprint: record.fingerprint } },
  };
}

/** Check the saved action marker AND the provider's current event contents. */
export function calendarEventMatchesRequest(record: StoredCalendarEventRequest, event: CalendarEvent): boolean {
  const extra = event as CalendarEvent & {
    status?: string;
    recurrence?: unknown;
    extendedProperties?: { private?: Record<string, unknown> };
  };
  const properties = extra.extendedProperties?.private;
  const attendees = event.attendees?.map((attendee) => attendee.email.toLowerCase()).sort() || [];
  return event.id === record.providerEventId && extra.status !== "cancelled" && !extra.recurrence &&
    properties?.agencyosRequestId === record.requestId && properties?.agencyosFingerprint === record.fingerprint &&
    event.summary === record.event.summary && (event.description || "") === record.event.description &&
    (event.location || "") === record.event.location &&
    typeof event.start?.dateTime === "string" && typeof event.end?.dateTime === "string" &&
    !event.start.date && !event.end.date &&
    Date.parse(event.start.dateTime) === Date.parse(record.event.startDateTime) &&
    Date.parse(event.end.dateTime) === Date.parse(record.event.endDateTime) &&
    event.start.timeZone === record.event.timeZone && event.end.timeZone === record.event.timeZone &&
    canonical(attendees) === canonical(record.event.attendees) && !event.conferenceData;
}

function calendarLink(value: string | undefined): string | null {
  try {
    const url = new URL(value || "");
    return url.protocol === "https:" && ["www.google.com", "calendar.google.com"].includes(url.hostname) ? url.href : null;
  } catch {
    return null;
  }
}

export function createCalendarEventRequestEngine(dependencies: CalendarEventRequestDependencies) {
  const now = dependencies.now || Date.now;
  const store = dependencies.store;

  async function load(uid: string, id: string) {
    assertId(id);
    const { workspaceId } = await dependencies.assertOwner(uid);
    return assertOwned(await store.read(id), uid, workspaceId, id);
  }

  async function checkedContext(record: StoredCalendarEventRequest, write: boolean, log?: Logger) {
    const context = await dependencies.resolveContext(record.ownerUid, record.event.profileId, log);
    if (canonical(identity(context)) !== canonical(record.binding) || (write && !context.canWriteEvents)) {
      throw new ApiError(409, "The connected calendar account or its permissions changed. Prepare a new review.");
    }
    const choice = await dependencies.requireChoice(context, record.calendar.id, { write }, log);
    if (canonical(choice) !== canonical(record.calendar)) {
      throw new ApiError(409, "The selected calendar or its permissions changed. Prepare a new review.");
    }
    return context;
  }

  async function block(record: StoredCalendarEventRequest, error: string) {
    return store.transact(record.requestId, (stored) => {
      const current = assertOwned(stored, record.ownerUid, record.workspaceId, record.requestId);
      assertFingerprint(current, record.fingerprint);
      if (current.status !== "approved" || current.providerAttemptStartedAt) return { result: current };
      const next: StoredCalendarEventRequest = { ...current, status: "blocked", updatedAt: new Date(now()).toISOString(), error };
      return { record: next, result: next };
    });
  }

  async function unknown(record: StoredCalendarEventRequest, error: string) {
    return store.transact(record.requestId, (stored) => {
      const current = assertOwned(stored, record.ownerUid, record.workspaceId, record.requestId);
      assertFingerprint(current, record.fingerprint);
      if (current.status === "completed") return { result: current };
      if (!current.providerAttemptStartedAt || !["executing", "unknown"].includes(current.status)) {
        throw new ApiError(409, "The calendar execution state changed.");
      }
      const next: StoredCalendarEventRequest = { ...current, status: "unknown", updatedAt: new Date(now()).toISOString(), error };
      return { record: next, result: next };
    });
  }

  async function complete(record: StoredCalendarEventRequest, event: CalendarEvent, reconciled: boolean) {
    if (!calendarEventMatchesRequest(record, event)) throw new ApiError(409, "The provider event does not match the approved event.");
    return store.transact(record.requestId, (stored) => {
      const current = assertOwned(stored, record.ownerUid, record.workspaceId, record.requestId);
      assertFingerprint(current, record.fingerprint);
      if (current.status === "completed") return { result: current };
      if (!current.approvedAt || !["approved", "executing", "unknown"].includes(current.status)) {
        throw new ApiError(409, "The calendar execution state changed.");
      }
      const timestamp = new Date(now()).toISOString();
      const next: StoredCalendarEventRequest = {
        ...current, status: "completed", updatedAt: timestamp, error: null,
        receipt: { eventId: event.id, htmlLink: calendarLink(event.htmlLink), createdAt: timestamp, reconciled, sendUpdates: current.event.sendUpdates },
      };
      return { record: next, result: next };
    });
  }

  return {
    async prepare(uid: string, input: CalendarEventDraft, log?: Logger): Promise<CalendarEventReview> {
      const { workspaceId } = await dependencies.assertOwner(uid);
      let event: NormalizedCalendarEvent;
      try {
        event = normalizeCalendarEventDraft(input, now());
      } catch (error) {
        throw new ApiError(400, error instanceof Error ? error.message : "Invalid calendar event.");
      }
      const context = await dependencies.resolveContext(uid, event.profileId, log);
      if (!context.canWriteEvents) throw new ApiError(403, "The selected account does not have calendar event write permission.");
      const calendar = await dependencies.requireChoice(context, event.calendarId, { write: true }, log);
      const binding = identity(context);
      const requestId = requestIdFor(uid, binding.accountSubject, event);
      // Replays must not reset approval/expiry/outcomes or collide with their own created event.
      const existing = await store.read(requestId);
      if (existing) {
        const current = assertOwned(existing, uid, workspaceId, requestId);
        if (!canRenewReview(current, now())) return publicReview(current);
      }
      const available = await dependencies.checkAvailability(context, calendar.id, event.startDateTime, event.endDateTime, log);
      if (!available) throw new ApiError(409, "The selected calendar is not available at this time.");
      const createdAt = now();
      const timestamp = new Date(createdAt).toISOString();
      const reviewNonce = randomUUID();
      const fingerprint = actionFingerprint({ ownerUid: uid, workspaceId, binding, calendar, event, reviewNonce });
      const record: StoredCalendarEventRequest = {
        schemaVersion: 1, requestId, fingerprint, reviewNonce, ownerUid: uid, workspaceId, binding, calendar, event,
        status: "awaiting_approval", createdAt: timestamp, expiresAt: new Date(createdAt + REVIEW_LIFETIME_MS).toISOString(),
        updatedAt: timestamp, availability: { available: true, checkedAt: timestamp },
        approvedAt: null, approvedByUid: null, approvalAuthTime: null, approvalProvider: null,
        providerEventId: `aos${requestId}`, providerAttemptStartedAt: null, receipt: null, error: null,
      };
      return publicReview(await store.transact(requestId, (stored) => {
        if (stored) {
          const current = assertOwned(stored, uid, workspaceId, requestId);
          if (!canRenewReview(current, now())) return { result: current };
        }
        return { record, result: record };
      }));
    },

    async get(uid: string, id: string): Promise<CalendarEventReview> {
      return publicReview(await load(uid, id));
    },

    async approve(uid: string, id: string, input: { fingerprint: string; approved: true }, auth: CalendarApprovalAuth): Promise<CalendarEventReview> {
      if (!CalendarApprovalSchema.safeParse(input).success) throw new ApiError(400, "Explicit approval of the exact event fingerprint is required.");
      const loaded = await load(uid, id);
      return publicReview(await store.transact(id, (stored) => {
        const current = assertOwned(stored, uid, loaded.workspaceId, id);
        assertFingerprint(current, input.fingerprint);
        assertUnexpired(current, now());
        assertFreshApproval(current, auth, now());
        if (current.status === "approved") return { result: current };
        if (current.status !== "awaiting_approval" || current.providerAttemptStartedAt) throw new ApiError(409, "This event request cannot be approved in its current state.");
        const timestamp = new Date(now()).toISOString();
        const next: StoredCalendarEventRequest = {
          ...current, status: "approved", approvedAt: timestamp, approvedByUid: uid,
          approvalAuthTime: auth.authTime, approvalProvider: auth.provider, updatedAt: timestamp, error: null,
        };
        return { record: next, result: next };
      }));
    },

    async execute(uid: string, id: string, fingerprint: string, log?: Logger): Promise<CalendarEventReview> {
      const record = await load(uid, id);
      assertFingerprint(record, fingerprint);
      if (["completed", "executing", "unknown", "blocked"].includes(record.status)) return publicReview(record);
      if (record.status !== "approved" || !record.approvedAt || record.approvedByUid !== uid || record.providerAttemptStartedAt) {
        throw new ApiError(409, "Explicit owner approval is required before creating this event.");
      }
      let context: CalendarContext;
      try {
        assertUnexpired(record, now());
        context = await checkedContext(record, true, log);
        const existing = await dependencies.getEvent(context, record.calendar.id, record.providerEventId, log);
        if (existing) {
          if (!calendarEventMatchesRequest(record, existing)) {
            return publicReview(await block(record, "An event with this request ID exists but does not match the reviewed event. No event was inserted."));
          }
          return publicReview(await complete(record, existing, true));
        }
        const available = await dependencies.checkAvailability(context, record.calendar.id, record.event.startDateTime, record.event.endDateTime, log);
        if (!available) return publicReview(await block(record, "The selected calendar is no longer available. Prepare a new event review."));
      } catch {
        return publicReview(await block(record, "The event review expired or its account, calendar, permissions, or availability could not be revalidated. No event was inserted."));
      }
      const claimed = await store.transact(id, (stored) => {
        const current = assertOwned(stored, uid, record.workspaceId, id);
        assertFingerprint(current, fingerprint);
        if (current.status !== "approved" || current.providerAttemptStartedAt) return { result: { record: current, claimed: false } };
        assertUnexpired(current, now());
        if (!current.approvedAt || current.approvedByUid !== uid) throw new ApiError(409, "Owner approval could not be verified.");
        const timestamp = new Date(now()).toISOString();
        const next: StoredCalendarEventRequest = {
          ...current, status: "executing", providerAttemptStartedAt: timestamp, updatedAt: timestamp, error: null,
          availability: { available: true, checkedAt: timestamp },
        };
        return { record: next, result: { record: next, claimed: true } };
      });
      if (!claimed.claimed) return publicReview(claimed.record);
      try {
        const event = await dependencies.insertEvent(context, record.calendar.id, payloadFor(claimed.record), record.event.sendUpdates, log);
        return publicReview(await complete(claimed.record, event, false));
      } catch {
        const message = "Calendar creation may have succeeded. Use Check result to reconcile this exact event; it will not be inserted again.";
        try {
          return publicReview(await unknown(claimed.record, message));
        } catch {
          // A failed receipt write cannot turn an uncertain provider operation into a retry.
          log?.error("calendar.event_request.receipt_persistence_failed", { requestId: id });
          return publicReview({ ...claimed.record, status: "unknown", error: message });
        }
      }
    },

    async reconcile(uid: string, id: string, fingerprint: string, log?: Logger): Promise<CalendarEventReview> {
      const record = await load(uid, id);
      assertFingerprint(record, fingerprint);
      if (record.status === "completed") return publicReview(record);
      if (!record.providerAttemptStartedAt || !["executing", "unknown"].includes(record.status)) {
        throw new ApiError(409, "Only an attempted calendar creation can be reconciled.");
      }
      try {
        const context = await checkedContext(record, false, log);
        const event = await dependencies.getEvent(context, record.calendar.id, record.providerEventId, log);
        if (event && calendarEventMatchesRequest(record, event)) return publicReview(await complete(record, event, true));
        return publicReview(await unknown(record, event
          ? "The provider event differs from the approved event. Its outcome requires review; no event was inserted."
          : "The event is not visible yet. Its outcome remains unknown; no event was inserted."));
      } catch {
        return publicReview(await unknown(record, "The calendar result could not be verified. Its outcome remains unknown; no event was inserted."));
      }
    },
  };
}

function productionEngine() {
  return createCalendarEventRequestEngine({
    store: createFirestoreCalendarEventRequestStore<StoredCalendarEventRequest>(),
    async assertOwner(uid) {
      const access = await assertPortfolioRegistryAccess(uid);
      if (access.role !== "owner") throw new ApiError(403, "Only the workspace owner can review calendar events.");
      return access;
    },
    resolveContext: resolveCalendarContext,
    requireChoice: requireCalendarChoice,
    checkAvailability: checkSelectedCalendarAvailability,
    getEvent: getSelectedCalendarEvent,
    insertEvent: insertReviewedCalendarEvent,
  });
}

export function prepareCalendarEventRequest(uid: string, input: CalendarEventDraft, log?: Logger) {
  return productionEngine().prepare(uid, input, log);
}
export function getCalendarEventRequest(uid: string, id: string) {
  return productionEngine().get(uid, id);
}
export function approveCalendarEventRequest(uid: string, id: string, input: { fingerprint: string; approved: true }, auth: CalendarApprovalAuth, _log?: Logger) {
  return productionEngine().approve(uid, id, input, auth);
}
export function executeCalendarEventRequest(uid: string, id: string, fingerprint: string, log?: Logger) {
  return productionEngine().execute(uid, id, fingerprint, log);
}
export function reconcileCalendarEventRequest(uid: string, id: string, fingerprint: string, log?: Logger) {
  return productionEngine().reconcile(uid, id, fingerprint, log);
}
