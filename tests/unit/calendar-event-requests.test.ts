import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/firebase-admin", () => ({ getAdminDb: vi.fn(() => { throw new Error("Real Firestore is forbidden in these tests"); }) }));
vi.mock("@/lib/crm/portfolio-registry", () => ({ assertPortfolioRegistryAccess: vi.fn() }));
vi.mock("@/lib/api/handler", () => ({
  ApiError: class ApiError extends Error {
    constructor(public status: number, message: string) { super(message); }
  },
}));
vi.mock("@/lib/calendar/google-calendar-context", () => ({
  resolveCalendarContext: vi.fn(),
  requireCalendarChoice: vi.fn(),
  checkSelectedCalendarAvailability: vi.fn(),
  getSelectedCalendarEvent: vi.fn(),
  insertReviewedCalendarEvent: vi.fn(),
}));

import { createCalendarEventRequestEngine, type StoredCalendarEventRequest } from "@/lib/calendar/event-requests";
import type { CalendarEventRequestStore } from "@/lib/calendar/event-request-repository";
import type { CalendarChoice, CalendarEventDraft, CalendarEventReview } from "@/lib/calendar/event-contract";
import type { CalendarContext, ReviewedCalendarEventPayload } from "@/lib/calendar/google-calendar-context";
import type { CalendarEvent } from "@/lib/google/calendar";

const INITIAL_TIME = Date.parse("2030-10-03T12:00:00.250Z");
const copy = <T>(value: T): T => structuredClone(value);
type MutableCalendarContext = { -readonly [K in keyof CalendarContext]: CalendarContext[K] };

class MemoryStore implements CalendarEventRequestStore<StoredCalendarEventRequest> {
  records = new Map<string, StoredCalendarEventRequest>();
  private queue: Promise<unknown> = Promise.resolve();
  failWrites = new Set<string>();

  async read(id: string) {
    return copy(this.records.get(id) || null);
  }

  transact<R>(id: string, transform: (current: StoredCalendarEventRequest | null) => { record?: StoredCalendarEventRequest; result: R }): Promise<R> {
    const result = this.queue.then(() => {
      const next = transform(copy(this.records.get(id) || null));
      if (next.record) {
        if (this.failWrites.has(next.record.status)) throw new Error("Simulated durable storage failure");
        this.records.set(id, copy(next.record));
      }
      return copy(next.result);
    });
    this.queue = result.catch(() => undefined);
    return result;
  }
}

function fixture() {
  let time = INITIAL_TIME;
  const store = new MemoryStore();
  const context: MutableCalendarContext = {
    accessToken: "secret-access-token-never-store",
    profileId: "rt_solutions_work",
    accountId: "private-account-id",
    accountEmail: "organizer@example.com",
    accountSubject: "private-google-subject",
    bindingFingerprint: "stable-binding-fingerprint",
    canWriteEvents: true,
  };
  const calendar: CalendarChoice = {
    id: "calendar@example.com", summary: "Work", timeZone: "America/Chicago", accessRole: "owner", primary: true, canCreateEvents: true,
  };
  const draft: CalendarEventDraft = {
    profileId: "rt_solutions_work", calendarId: calendar.id, summary: "Review meeting", description: "Exact approved details", location: "Office",
    startLocal: "2030-10-07T10:00", endLocal: "2030-10-07T10:30", timeZone: "America/Chicago", attendees: ["guest@example.com"], sendUpdates: "all",
  };
  const assertOwner = vi.fn(async (uid: string) => ({ workspaceId: `workspace_${uid}` }));
  const resolveContext = vi.fn(async () => copy(context));
  const requireChoice = vi.fn(async () => copy(calendar));
  const checkAvailability = vi.fn(async () => true);
  const getEvent = vi.fn(async (): Promise<CalendarEvent | null> => null);
  let insertedEvent: CalendarEvent | null = null;
  const insertEvent = vi.fn(async (_context: CalendarContext, _calendarId: string, payload: ReviewedCalendarEventPayload) => {
    insertedEvent = copy({ ...payload, htmlLink: "https://calendar.google.com/calendar/event?eid=example" }) as CalendarEvent;
    return insertedEvent;
  });
  const engine = createCalendarEventRequestEngine({ store, assertOwner, resolveContext, requireChoice, checkAvailability, getEvent, insertEvent, now: () => time });
  const prepare = () => engine.prepare("owner", draft);
  async function approved() {
    const review = await prepare();
    time = INITIAL_TIME + 2_000;
    return engine.approve("owner", review.requestId, { fingerprint: review.fingerprint, approved: true }, { authTime: Math.floor(time / 1000), provider: "google.com" });
  }
  return {
    engine, store, context, calendar, draft, prepare, approved, assertOwner, resolveContext, requireChoice, checkAvailability, getEvent, insertEvent,
    setTime(value: number) { time = value; },
    getInsertedEvent() { return copy(insertedEvent); },
    readRecord(review: CalendarEventReview) { return copy(store.records.get(review.requestId)!); },
  };
}

describe("durable calendar event requests", () => {
  it("stores a bound immutable review without tokens and returns only public identity fields", async () => {
    const f = fixture();
    const review = await f.prepare();
    expect(review.status).toBe("awaiting_approval");
    expect(Date.parse(review.expiresAt) - Date.parse(review.createdAt)).toBe(15 * 60_000);
    expect(review.event.startDateTime).toBe("2030-10-07T15:00:00.000Z");
    expect(JSON.stringify(f.readRecord(review))).not.toContain(f.context.accessToken);
    expect(JSON.stringify(review)).not.toContain(f.context.accountSubject);
    expect(JSON.stringify(review)).not.toContain(f.context.accountId);
    expect(f.insertEvent).not.toHaveBeenCalled();
  });

  it("rejects invalid drafts and unavailable calendars before persistence", async () => {
    const f = fixture();
    await expect(f.engine.prepare("owner", { ...f.draft, endLocal: f.draft.startLocal })).rejects.toMatchObject({ status: 400 });
    f.checkAvailability.mockResolvedValue(false);
    await expect(f.prepare()).rejects.toMatchObject({ status: 409 });
    expect(f.store.records.size).toBe(0);
    expect(f.insertEvent).not.toHaveBeenCalled();
  });

  it("does not treat availability errors as free time", async () => {
    const f = fixture();
    f.checkAvailability.mockRejectedValue(new Error("Provider lookup failed"));
    await expect(f.prepare()).rejects.toThrow("Provider lookup failed");
    expect(f.store.records.size).toBe(0);
  });

  it("checks owner/workspace on get, approve and execute", async () => {
    const f = fixture();
    const review = await f.prepare();
    await expect(f.engine.get("other", review.requestId)).rejects.toMatchObject({ status: 404 });
    await expect(f.engine.approve("other", review.requestId, { fingerprint: review.fingerprint, approved: true }, { authTime: INITIAL_TIME / 1000, provider: "google.com" })).rejects.toMatchObject({ status: 404 });
    await expect(f.engine.execute("other", review.requestId, review.fingerprint)).rejects.toMatchObject({ status: 404 });
    f.assertOwner.mockResolvedValue({ workspaceId: "changed-workspace" });
    await expect(f.engine.get("owner", review.requestId)).rejects.toMatchObject({ status: 404 });
    expect(f.insertEvent).not.toHaveBeenCalled();
  });

  it.each(["custom", "anonymous", "unknown-provider"])("rejects %s approval even with fresh credentials", async (provider) => {
    const f = fixture();
    const review = await f.prepare();
    f.setTime(INITIAL_TIME + 2_000);
    await expect(f.engine.approve("owner", review.requestId, { fingerprint: review.fingerprint, approved: true }, { authTime: Math.floor((INITIAL_TIME + 2_000) / 1000), provider })).rejects.toMatchObject({ status: 403 });
    expect(f.readRecord(review).status).toBe("awaiting_approval");
  });

  it.each(["google.com", "password", "apple.com", "phone"])("accepts explicit post-review reauthentication through %s", async (provider) => {
    const f = fixture();
    const review = await f.prepare();
    f.setTime(INITIAL_TIME + 2_000);
    const approved = await f.engine.approve("owner", review.requestId, { fingerprint: review.fingerprint, approved: true }, { authTime: Math.floor((INITIAL_TIME + 2_000) / 1000), provider });
    expect(approved.status).toBe("approved");
    expect(f.readRecord(review).approvedByUid).toBe("owner");
    expect(f.insertEvent).not.toHaveBeenCalled();
  });

  it("rejects pre-review, same-second, stale, future and non-integer authentication times", async () => {
    const f = fixture();
    const review = await f.prepare();
    const approve = (authTime: number) => f.engine.approve("owner", review.requestId, { fingerprint: review.fingerprint, approved: true }, { authTime, provider: "google.com" });
    await expect(approve(Math.floor(INITIAL_TIME / 1000))).rejects.toMatchObject({ status: 403 });
    await expect(approve(Math.floor(INITIAL_TIME / 1000) - 1)).rejects.toMatchObject({ status: 403 });
    await expect(approve(Math.ceil(INITIAL_TIME / 1000) + 31)).rejects.toMatchObject({ status: 403 });
    await expect(approve(INITIAL_TIME / 1000)).rejects.toMatchObject({ status: 403 });
    f.setTime(INITIAL_TIME + 6 * 60_000);
    await expect(approve(Math.ceil(INITIAL_TIME / 1000))).rejects.toMatchObject({ status: 403 });
  });

  it("rejects absent approval, fingerprint changes and expired reviews", async () => {
    const f = fixture();
    const review = await f.prepare();
    await expect(f.engine.execute("owner", review.requestId, review.fingerprint)).rejects.toMatchObject({ status: 409 });
    f.setTime(INITIAL_TIME + 2_000);
    await expect(f.engine.approve("owner", review.requestId, { fingerprint: "0".repeat(64), approved: true }, { authTime: Math.ceil(INITIAL_TIME / 1000), provider: "google.com" })).rejects.toMatchObject({ status: 409 });
    f.setTime(Date.parse(review.expiresAt));
    await expect(f.engine.approve("owner", review.requestId, { fingerprint: review.fingerprint, approved: true }, { authTime: Math.floor(Date.parse(review.expiresAt) / 1000), provider: "google.com" })).rejects.toMatchObject({ status: 409 });
    expect(f.insertEvent).not.toHaveBeenCalled();
  });

  it("deduplicates concurrent preparations and preserves approval and original expiry", async () => {
    const f = fixture();
    const reviews = await Promise.all([f.prepare(), f.prepare()]);
    expect(reviews[0].requestId).toBe(reviews[1].requestId);
    expect(f.store.records.size).toBe(1);
    const approved = await f.approved();
    f.setTime(INITIAL_TIME + 60_000);
    f.checkAvailability.mockResolvedValue(false);
    const replay = await f.prepare();
    expect(replay).toEqual(approved);
  });

  it("renews an expired unattempted review with a new nonce and clears the previous approval", async () => {
    const f = fixture();
    const old = await f.approved();
    const renewalTime = Date.parse(old.expiresAt) + 1_000;
    f.setTime(renewalTime);
    const renewed = await f.prepare();
    expect(renewed.requestId).toBe(old.requestId);
    expect(renewed.fingerprint).not.toBe(old.fingerprint);
    expect(renewed.status).toBe("awaiting_approval");
    expect(renewed.approvedAt).toBeNull();
    expect(Date.parse(renewed.createdAt)).toBe(renewalTime);
    expect(f.readRecord(renewed).approvedByUid).toBeNull();
    f.setTime(renewalTime + 2_000);
    const auth = { authTime: Math.floor((renewalTime + 2_000) / 1000), provider: "google.com" };
    await expect(f.engine.approve("owner", renewed.requestId, { fingerprint: old.fingerprint, approved: true }, auth)).rejects.toMatchObject({ status: 409 });
    const approved = await f.engine.approve("owner", renewed.requestId, { fingerprint: renewed.fingerprint, approved: true }, auth);
    expect((await f.engine.execute("owner", approved.requestId, approved.fingerprint)).status).toBe("completed");
    expect(f.store.records.size).toBe(1);
    expect(f.insertEvent).toHaveBeenCalledTimes(1);
  });

  it("does not renew expired reviews when fresh availability cannot be verified", async () => {
    const f = fixture();
    const old = await f.approved();
    f.setTime(Date.parse(old.expiresAt) + 1_000);
    f.checkAvailability.mockResolvedValue(false);
    await expect(f.prepare()).rejects.toMatchObject({ status: 409 });
    expect((await f.engine.get("owner", old.requestId)).fingerprint).toBe(old.fingerprint);
    expect(f.insertEvent).not.toHaveBeenCalled();
  });

  it.each(["completed", "unknown"])("keeps %s dedupe across profile aliases, calendar metadata and grant changes", async (outcome) => {
    const f = fixture();
    const review = await f.approved();
    if (outcome === "unknown") f.insertEvent.mockRejectedValue(new Error("Provider outcome unknown"));
    expect((await f.engine.execute("owner", review.requestId, review.fingerprint)).status).toBe(outcome);
    f.calendar.summary = "Renamed calendar";
    f.calendar.accessRole = "writer";
    f.context.bindingFingerprint = "changed-grants-fingerprint";
    f.context.profileId = "rosser_gallery_work";
    f.context.accountId = "another-registry-alias-for-the-same-subject";
    f.setTime(Date.parse(review.expiresAt) + 1_000);
    const replay = await f.engine.prepare("owner", { ...f.draft, profileId: "rosser_gallery_work" });
    expect(replay.requestId).toBe(review.requestId);
    expect(replay.fingerprint).toBe(review.fingerprint);
    expect(replay.status).toBe(outcome);
    expect(f.store.records.size).toBe(1);
    expect(f.insertEvent).toHaveBeenCalledTimes(1);
  });

  it("revalidates the exact account binding, calendar metadata, scope and availability before claiming", async () => {
    for (const failure of ["binding", "calendar", "scope", "availability", "read-error"] as const) {
      const f = fixture();
      const review = await f.approved();
      if (failure === "binding") f.context.accountId = "a-different-account";
      if (failure === "calendar") f.calendar.timeZone = "Europe/London";
      if (failure === "scope") f.context.canWriteEvents = false;
      if (failure === "availability") f.checkAvailability.mockResolvedValue(false);
      if (failure === "read-error") f.getEvent.mockRejectedValue(new Error("Not a verified 404"));
      const result = await f.engine.execute("owner", review.requestId, review.fingerprint);
      expect(result.status, failure).toBe("blocked");
      expect(f.readRecord(review).providerAttemptStartedAt, failure).toBeNull();
      expect(f.insertEvent, failure).not.toHaveBeenCalled();
    }
  });

  it("blocks expiry both before preflight and inside the transaction claim", async () => {
    const f = fixture();
    const review = await f.approved();
    f.setTime(Date.parse(review.expiresAt));
    expect((await f.engine.execute("owner", review.requestId, review.fingerprint)).status).toBe("blocked");
    expect(f.insertEvent).not.toHaveBeenCalled();

    const g = fixture();
    const second = await g.approved();
    g.checkAvailability.mockImplementation(async () => { g.setTime(Date.parse(second.expiresAt)); return true; });
    await expect(g.engine.execute("owner", second.requestId, second.fingerprint)).rejects.toMatchObject({ status: 409 });
    expect(g.insertEvent).not.toHaveBeenCalled();
  });

  it("claims durably before insertion and permits only one provider call across concurrent execution", async () => {
    const f = fixture();
    const review = await f.approved();
    let release!: () => void;
    let started!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const called = new Promise<void>((resolve) => { started = resolve; });
    f.insertEvent.mockImplementation(async (_context, _calendar, payload) => {
      expect(f.readRecord(review).status).toBe("executing");
      expect(f.readRecord(review).providerAttemptStartedAt).not.toBeNull();
      started();
      await pending;
      return copy(payload) as CalendarEvent;
    });
    const first = f.engine.execute("owner", review.requestId, review.fingerprint);
    const second = f.engine.execute("owner", review.requestId, review.fingerprint);
    await called;
    release();
    const results = await Promise.all([first, second]);
    expect(results.some((result) => result.status === "completed")).toBe(true);
    expect(f.insertEvent).toHaveBeenCalledTimes(1);
    expect(f.insertEvent.mock.calls[0][2].id).toBe(`aos${review.requestId}`);
    expect(f.readRecord(review).status).toBe("completed");
  });

  it("does not insert if the durable claim cannot be written", async () => {
    const f = fixture();
    const review = await f.approved();
    f.store.failWrites.add("executing");
    await expect(f.engine.execute("owner", review.requestId, review.fingerprint)).rejects.toThrow("storage failure");
    expect(f.insertEvent).not.toHaveBeenCalled();
    expect(f.readRecord(review).status).toBe("approved");
  });

  it("never retries uncertain writes, including when reconciliation returns 404", async () => {
    const f = fixture();
    const review = await f.approved();
    f.insertEvent.mockRejectedValue(new Error("Timeout after provider accepted the request"));
    expect((await f.engine.execute("owner", review.requestId, review.fingerprint)).status).toBe("unknown");
    expect((await f.engine.execute("owner", review.requestId, review.fingerprint)).status).toBe("unknown");
    expect((await f.engine.reconcile("owner", review.requestId, review.fingerprint)).status).toBe("unknown");
    expect((await f.prepare()).status).toBe("unknown");
    expect(f.insertEvent).toHaveBeenCalledTimes(1);
  });

  it("reconciles an exact provider event after receipt storage fails without reinserting", async () => {
    const f = fixture();
    const review = await f.approved();
    f.store.failWrites.add("completed");
    expect((await f.engine.execute("owner", review.requestId, review.fingerprint)).status).toBe("unknown");
    const event = f.getInsertedEvent()!;
    f.store.failWrites.clear();
    f.getEvent.mockResolvedValue(event);
    const reconciled = await f.engine.reconcile("owner", review.requestId, review.fingerprint);
    expect(reconciled.status).toBe("completed");
    expect(reconciled.receipt?.reconciled).toBe(true);
    expect((await f.engine.execute("owner", review.requestId, review.fingerprint)).receipt).toEqual(reconciled.receipt);
    expect(f.insertEvent).toHaveBeenCalledTimes(1);
  });

  it("retains the executing marker if both receipt writes fail and supports later read-only reconciliation", async () => {
    const f = fixture();
    const review = await f.approved();
    f.store.failWrites.add("completed");
    f.store.failWrites.add("unknown");
    expect((await f.engine.execute("owner", review.requestId, review.fingerprint)).status).toBe("unknown");
    expect(f.readRecord(review).status).toBe("executing");
    f.store.failWrites.clear();
    f.getEvent.mockResolvedValue(f.getInsertedEvent());
    expect((await f.engine.reconcile("owner", review.requestId, review.fingerprint)).status).toBe("completed");
    expect(f.insertEvent).toHaveBeenCalledTimes(1);
  });

  it("requires exact event contents as well as the fingerprint when reconciling", async () => {
    const f = fixture();
    const review = await f.approved();
    f.store.failWrites.add("completed");
    await f.engine.execute("owner", review.requestId, review.fingerprint);
    f.store.failWrites.clear();
    const original = f.getInsertedEvent()!;
    const mutations = [
      { ...original, summary: "Different title" },
      { ...original, attendees: [{ email: "other@example.com" }] },
      { ...original, start: { ...original.start, dateTime: "2030-10-07T16:00:00Z" } },
      { ...original, extendedProperties: { private: { agencyosRequestId: review.requestId, agencyosFingerprint: "0".repeat(64) } } },
    ];
    for (const event of mutations) {
      f.getEvent.mockResolvedValue(event);
      expect((await f.engine.reconcile("owner", review.requestId, review.fingerprint)).status).toBe("unknown");
    }
    f.getEvent.mockResolvedValue(original);
    expect((await f.engine.reconcile("owner", review.requestId, review.fingerprint)).status).toBe("completed");
    expect(f.insertEvent).toHaveBeenCalledTimes(1);
  });

  it("reconciles an exact deterministic event before insertion but blocks an unrelated collision", async () => {
    const f = fixture();
    const review = await f.approved();
    const record = f.readRecord(review);
    f.getEvent.mockResolvedValue({
      id: record.providerEventId, summary: record.event.summary, description: record.event.description, location: record.event.location,
      start: { dateTime: record.event.startDateTime, timeZone: record.event.timeZone }, end: { dateTime: record.event.endDateTime, timeZone: record.event.timeZone },
      attendees: record.event.attendees.map((email) => ({ email })),
      extendedProperties: { private: { agencyosRequestId: review.requestId, agencyosFingerprint: review.fingerprint } },
    } as CalendarEvent);
    expect((await f.engine.execute("owner", review.requestId, review.fingerprint)).status).toBe("completed");
    expect(f.insertEvent).not.toHaveBeenCalled();

    const g = fixture();
    const second = await g.approved();
    g.getEvent.mockResolvedValue({ id: `aos${second.requestId}`, summary: "Unrelated", start: {}, end: {} });
    expect((await g.engine.execute("owner", second.requestId, second.fingerprint)).status).toBe("blocked");
    expect(g.insertEvent).not.toHaveBeenCalled();
  });

  it("rejects corrupted immutable snapshots before any provider execution", async () => {
    const f = fixture();
    const review = await f.approved();
    const record = f.store.records.get(review.requestId)!;
    record.event.attendees = ["unapproved@example.com"];
    await expect(f.engine.execute("owner", review.requestId, review.fingerprint)).rejects.toMatchObject({ status: 409 });
    expect(f.insertEvent).not.toHaveBeenCalled();
  });
});
