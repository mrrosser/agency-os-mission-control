import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GoogleAccountTokenResolution } from "@/lib/google/account-token-store";

const mocks = vi.hoisted(() => ({
  resolveGoogleAccountTokens: vi.fn(),
  getAccessTokenForUser: vi.fn(),
  fetchGoogleAccountIdentity: vi.fn(),
  setGoogleDefaultProfileId: vi.fn(),
  persistGoogleAccountTokens: vi.fn(),
}));

vi.mock("@/lib/google/account-token-store", () => ({
  resolveGoogleAccountTokens: mocks.resolveGoogleAccountTokens,
  setGoogleDefaultProfileId: mocks.setGoogleDefaultProfileId,
  persistGoogleAccountTokens: mocks.persistGoogleAccountTokens,
}));
vi.mock("@/lib/google/oauth", () => ({
  getAccessTokenForUser: mocks.getAccessTokenForUser,
  fetchGoogleAccountIdentity: mocks.fetchGoogleAccountIdentity,
}));

import {
  checkSelectedCalendarAvailability,
  getSelectedCalendarEvent,
  insertReviewedCalendarEvent,
  listCalendarChoices,
  listSelectedCalendarEvents,
  requireCalendarChoice,
  resolveCalendarContext,
} from "@/lib/calendar/google-calendar-context";

const UID = "calendar-user";
const PROFILE = "rt_solutions_work";
const ACCOUNT_ID = "0123456789abcdef0123456789abcdef01234567";
const EMAIL = "calendar-owner@example.com";
const SUBJECT = "google-subject-123";
const TOKEN = "mock-calendar-access-token";
const READ_SCOPE = "https://www.googleapis.com/auth/calendar.readonly";
const WRITE_SCOPE = "https://www.googleapis.com/auth/calendar.events";
const FULL_SCOPE = "https://www.googleapis.com/auth/calendar";
const CALENDAR_ID = "team+sales/2026@example.com";
const START = "2030-01-01T15:00:00.000Z";
const END = "2030-01-01T15:30:00.000Z";
const EVENT_ID = "0123456789abcdefghijklmnopqrstuv0123";
const fetchMock = vi.fn<typeof fetch>();

function binding(
  tokens: Partial<NonNullable<NonNullable<GoogleAccountTokenResolution["record"]>["tokens"]>> = {},
): GoogleAccountTokenResolution {
  return {
    registryFound: true,
    profileMapped: true,
    record: {
      accountId: ACCOUNT_ID,
      profileId: PROFILE,
      tokens: {
        accessToken: TOKEN,
        refreshToken: "mock-existing-refresh-token",
        scope: `${READ_SCOPE} ${WRITE_SCOPE}`,
        accountEmail: EMAIL,
        accountSubject: SUBJECT,
        ...tokens,
      },
    },
  };
}

function choice(overrides: Record<string, unknown> = {}) {
  return {
    id: CALENDAR_ID,
    summary: "Sales calendar",
    timeZone: "America/New_York",
    accessRole: "owner",
    ...overrides,
  };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function fetchUrl(index: number) {
  const input = fetchMock.mock.calls[index]?.[0];
  return new URL(input instanceof Request ? input.url : String(input));
}

function fetchBody(index: number) {
  return JSON.parse(String(fetchMock.mock.calls[index]?.[1]?.body));
}

function queueChoice(overrides: Record<string, unknown> = {}) {
  fetchMock.mockResolvedValueOnce(json(choice(overrides)));
}

async function context(scope = `${READ_SCOPE} ${WRITE_SCOPE}`) {
  mocks.resolveGoogleAccountTokens.mockResolvedValue(binding({ scope }));
  return resolveCalendarContext(UID, PROFILE);
}

function eventPayload() {
  return {
    id: EVENT_ID,
    summary: "Reviewed discovery call",
    start: { dateTime: START, timeZone: "America/New_York" },
    end: { dateTime: END, timeZone: "America/New_York" },
    attendees: [{ email: "reviewed-guest@example.com" }],
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.resolveGoogleAccountTokens.mockResolvedValue(binding());
  mocks.getAccessTokenForUser.mockResolvedValue(TOKEN);
  mocks.fetchGoogleAccountIdentity.mockResolvedValue({ email: EMAIL, subject: SUBJECT });
  fetchMock.mockRejectedValue(new Error("Unexpected mocked Calendar request"));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  expect(mocks.setGoogleDefaultProfileId).not.toHaveBeenCalled();
  expect(mocks.persistGoogleAccountTokens).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

describe("explicit existing Calendar account context", () => {
  it("binds the exact selected profile around fresh verified identity without changing defaults", async () => {
    await resolveCalendarContext(UID, PROFILE);

    expect(mocks.resolveGoogleAccountTokens.mock.calls).toEqual([[UID, PROFILE], [UID, PROFILE]]);
    expect(mocks.getAccessTokenForUser).toHaveBeenCalledExactlyOnceWith(
      UID, undefined, { profileId: PROFILE },
    );
    expect(mocks.fetchGoogleAccountIdentity).toHaveBeenCalledExactlyOnceWith(TOKEN, undefined);
    const before = mocks.resolveGoogleAccountTokens.mock.invocationCallOrder[0]!;
    const token = mocks.getAccessTokenForUser.mock.invocationCallOrder[0]!;
    const identity = mocks.fetchGoogleAccountIdentity.mock.invocationCallOrder[0]!;
    const after = mocks.resolveGoogleAccountTokens.mock.invocationCallOrder[1]!;
    expect(before).toBeLessThan(token);
    expect(token).toBeLessThan(identity);
    expect(identity).toBeLessThan(after);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([undefined, null, "", "primary", "rt_solutions_send", "rosser_gallery_send", "unknown"])(
    "rejects non-work profile %s before credential lookup", async (profileId) => {
      await expect(resolveCalendarContext(UID, profileId as never)).rejects.toThrow();
      expect(mocks.resolveGoogleAccountTokens).not.toHaveBeenCalled();
      expect(mocks.getAccessTokenForUser).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it.each([
    { registryFound: false, profileMapped: false, record: null },
    { registryFound: true, profileMapped: false, record: null },
    { ...binding(), record: { ...binding().record!, profileId: "rosser_gallery_work" } },
    { ...binding(), record: { ...binding().record!, tokens: null } },
  ])("rejects absent or mismatched binding without borrowing credentials: %#", async (resolution) => {
    mocks.resolveGoogleAccountTokens.mockResolvedValue(resolution);
    await expect(resolveCalendarContext(UID, PROFILE)).rejects.toThrow();
    expect(mocks.getAccessTokenForUser).not.toHaveBeenCalled();
    expect(mocks.fetchGoogleAccountIdentity).not.toHaveBeenCalled();
  });

  it("accepts a legacy 40-hex binding with missing stored identity only after fresh verification", async () => {
    mocks.resolveGoogleAccountTokens.mockResolvedValue(binding({ accountEmail: null, accountSubject: null }));
    await expect(resolveCalendarContext(UID, PROFILE)).resolves.toBeDefined();
    expect(mocks.fetchGoogleAccountIdentity).toHaveBeenCalledOnce();
  });

  it.each([
    { email: "different@example.com", subject: SUBJECT },
    { email: EMAIL, subject: "different-subject" },
  ])("rejects verified identity drift: %#", async (identity) => {
    mocks.fetchGoogleAccountIdentity.mockResolvedValue(identity);
    await expect(resolveCalendarContext(UID, PROFILE)).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails closed when fresh identity verification fails", async () => {
    mocks.fetchGoogleAccountIdentity.mockRejectedValue(new Error("identity unavailable"));
    await expect(resolveCalendarContext(UID, PROFILE)).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    { ...binding(), record: { ...binding().record!, accountId: "abcdef0123456789abcdef0123456789abcdef0123" } },
    { registryFound: true, profileMapped: false, record: null },
    binding({ accountEmail: "different@example.com" }),
    binding({ accountSubject: "different-subject" }),
    binding({ scope: "https://www.googleapis.com/auth/gmail.send" }),
  ])("rejects binding or identity changes during token resolution: %#", async (changed) => {
    mocks.resolveGoogleAccountTokens.mockResolvedValueOnce(binding()).mockResolvedValueOnce(changed);
    await expect(resolveCalendarContext(UID, PROFILE)).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([WRITE_SCOPE, "https://www.googleapis.com/auth/gmail.send", "", null])(
    "rejects missing Calendar read scope: %s", async (scope) => {
      mocks.resolveGoogleAccountTokens.mockResolvedValue(binding({ scope }));
      await expect(resolveCalendarContext(UID, PROFILE)).rejects.toThrow();
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("accepts an existing broad Calendar grant", async () => {
    await expect(context(FULL_SCOPE)).resolves.toBeDefined();
  });

  it("keeps the binding fingerprint stable across token-cache refresh and scope ordering", async () => {
    const original = await resolveCalendarContext(UID, PROFILE);
    mocks.resolveGoogleAccountTokens.mockResolvedValue(binding({
      accessToken: "refreshed-access-token", refreshToken: "rotated-refresh-token", expiryDate: 9999999999999,
      scope: `${WRITE_SCOPE} ${READ_SCOPE}`,
    }));
    mocks.getAccessTokenForUser.mockResolvedValue("refreshed-access-token");
    const refreshed = await resolveCalendarContext(UID, PROFILE);
    expect(refreshed.bindingFingerprint).toBe(original.bindingFingerprint);
    expect(original.bindingFingerprint).toMatch(/^sha256:[a-f0-9]{64}$/);
  });
});

describe("verified Calendar choices", () => {
  it("paginates CalendarList, preserving exact IDs and verified timezone/role", async () => {
    const selected = await context();
    fetchMock.mockResolvedValueOnce(json({ items: [choice()], nextPageToken: "page +/2" }));
    fetchMock.mockResolvedValueOnce(json({ items: [choice({ id: "second@example.com", accessRole: "reader" })] }));

    const choices = await listCalendarChoices(selected);
    expect(choices).toHaveLength(2);
    expect(choices[0]).toMatchObject({ id: CALENDAR_ID, timeZone: "America/New_York", accessRole: "owner" });
    expect(fetchUrl(0).pathname).toBe("/calendar/v3/users/me/calendarList");
    expect(fetchUrl(1).searchParams.get("pageToken")).toBe("page +/2");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([
    { items: [choice(), choice()] },
    { items: [choice({ accessRole: "admin" })] },
    { items: [choice({ timeZone: "Mars/Olympus_Mons" })] },
    { items: [choice({ timeZone: "" })] },
    { items: [choice({ id: "" })] },
    { items: "not-an-array" },
  ])("rejects malformed choices or duplicate IDs: %#", async (payload) => {
    const selected = await context();
    fetchMock.mockResolvedValueOnce(json(payload));
    await expect(listCalendarChoices(selected)).rejects.toThrow();
  });

  it("rejects duplicate IDs across pages", async () => {
    const selected = await context();
    fetchMock.mockResolvedValueOnce(json({ items: [choice()], nextPageToken: "next" }));
    fetchMock.mockResolvedValueOnce(json({ items: [choice()] }));
    await expect(listCalendarChoices(selected)).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rejects repeated page tokens without retrying indefinitely", async () => {
    const selected = await context();
    fetchMock.mockResolvedValueOnce(json({ items: [choice()], nextPageToken: "repeat" }));
    fetchMock.mockResolvedValueOnce(json({ items: [choice({ id: "second@example.com" })], nextPageToken: "repeat" }));
    await expect(listCalendarChoices(selected)).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("stops at ten pages rather than presenting a partial verified list", async () => {
    const selected = await context();
    for (let index = 0; index < 10; index++) {
      fetchMock.mockResolvedValueOnce(json({
        items: [choice({ id: `calendar-${index}@example.com` })], nextPageToken: `page-${index + 1}`,
      }));
    }
    await expect(listCalendarChoices(selected)).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(10);
  });

  it("rejects an oversized list rather than truncating verified choices", async () => {
    const selected = await context();
    fetchMock.mockResolvedValueOnce(json({
      items: Array.from({ length: 2501 }, (_, index) => choice({ id: `calendar-${index}@example.com` })),
    }));
    await expect(listCalendarChoices(selected)).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("verifies the exact encoded calendar ID for a selected choice", async () => {
    const selected = await context();
    queueChoice();
    await expect(requireCalendarChoice(selected, CALENDAR_ID, { write: true })).resolves.toMatchObject({ id: CALENDAR_ID });
    expect(fetchUrl(0).pathname).toBe(`/calendar/v3/users/me/calendarList/${encodeURIComponent(CALENDAR_ID)}`);
  });

  it("rejects a different calendar returned for the requested ID", async () => {
    const selected = await context();
    queueChoice({ id: "other@example.com" });
    await expect(requireCalendarChoice(selected, CALENDAR_ID, { write: false })).rejects.toThrow();
  });

  it.each(["reader", "freeBusyReader"])("blocks writes for role %s", async (accessRole) => {
    const selected = await context();
    queueChoice({ accessRole });
    await expect(requireCalendarChoice(selected, CALENDAR_ID, { write: true })).rejects.toThrow();
  });

  it.each(["owner", "writer", "writerWithoutPrivateAccess"])("allows verified role %s with write scope", async (accessRole) => {
    const selected = await context();
    queueChoice({ accessRole });
    await expect(requireCalendarChoice(selected, CALENDAR_ID, { write: true })).resolves.toMatchObject({
      id: CALENDAR_ID, accessRole, canCreateEvents: true,
    });
  });

  it("blocks writes with a read-only scope even when CalendarList says owner", async () => {
    const selected = await context(READ_SCOPE);
    queueChoice();
    await expect(requireCalendarChoice(selected, CALENDAR_ID, { write: true })).rejects.toThrow();
  });
});

describe("selected Calendar operations", () => {
  it("lists a legitimate untitled event with an empty title while retaining its dates and ID", async () => {
    const selected = await context();
    queueChoice();
    const event = { id: EVENT_ID, start: { dateTime: START }, end: { dateTime: END } };
    fetchMock.mockResolvedValueOnce(json({ items: [event] }));
    await expect(listSelectedCalendarEvents(selected, CALENDAR_ID, { timeMin: START }))
      .resolves.toEqual({ events: [{ ...event, summary: "" }] });
  });

  it.each([null, 42, {}])("rejects a malformed list title rather than normalizing it: %#", async (summary) => {
    const selected = await context();
    queueChoice();
    fetchMock.mockResolvedValueOnce(json({ items: [{ ...eventPayload(), summary }] }));
    await expect(listSelectedCalendarEvents(selected, CALENDAR_ID, { timeMin: START }))
      .rejects.toMatchObject({ status: 502 });
  });

  it("keeps exact-title validation for event reconciliation", async () => {
    const selected = await context();
    queueChoice();
    fetchMock.mockResolvedValueOnce(json({ id: EVENT_ID, start: { dateTime: START }, end: { dateTime: END } }));
    await expect(getSelectedCalendarEvent(selected, CALENDAR_ID, EVENT_ID))
      .rejects.toMatchObject({ status: 502 });
  });

  it("lists events only after revalidating the choice and preserves pagination", async () => {
    const selected = await context();
    queueChoice();
    const event = eventPayload();
    fetchMock.mockResolvedValueOnce(json({ items: [event], nextPageToken: "next-events" }));
    await expect(listSelectedCalendarEvents(selected, CALENDAR_ID, { timeMin: START, timeMax: END, maxResults: 20 }))
      .resolves.toEqual({ events: [event], nextPageToken: "next-events" });
    expect(fetchUrl(0).pathname).toContain("/users/me/calendarList/");
    expect(fetchUrl(1).pathname).toBe(`/calendar/v3/calendars/${encodeURIComponent(CALENDAR_ID)}/events`);
    expect(fetchUrl(1).searchParams.get("timeMin")).toBe(START);
    expect(fetchUrl(1).searchParams.get("timeMax")).toBe(END);
    expect(fetchUrl(1).searchParams.get("maxResults")).toBe("20");
  });

  it("checks free/busy against the exact selected calendar after verifying access", async () => {
    const selected = await context();
    queueChoice();
    fetchMock.mockResolvedValueOnce(json({ calendars: { [CALENDAR_ID]: { busy: [] } } }));
    await expect(checkSelectedCalendarAvailability(selected, CALENDAR_ID, START, END)).resolves.toBe(true);
    expect(fetchUrl(1).pathname).toBe("/calendar/v3/freeBusy");
    expect(fetchBody(1)).toMatchObject({ timeMin: START, timeMax: END, items: [{ id: CALENDAR_ID }] });
  });

  it("returns unavailable for a verified occupied interval", async () => {
    const selected = await context();
    queueChoice();
    fetchMock.mockResolvedValueOnce(json({ calendars: { [CALENDAR_ID]: { busy: [{ start: START, end: END }] } } }));
    await expect(checkSelectedCalendarAvailability(selected, CALENDAR_ID, START, END)).resolves.toBe(false);
  });

  it.each([
    {},
    { calendars: {} },
    { calendars: { [CALENDAR_ID]: { busy: [], errors: [{ reason: "notFound" }] } } },
    { calendars: { [CALENDAR_ID]: {} } },
    { calendars: { [CALENDAR_ID]: { busy: "invalid" } } },
    { calendars: { [CALENDAR_ID]: { busy: [{ start: "invalid", end: END }] } } },
    { calendars: { [CALENDAR_ID]: { busy: [{ start: END, end: START }] } } },
  ])("fails closed on missing, errored, or malformed free/busy data: %#", async (payload) => {
    const selected = await context();
    queueChoice();
    fetchMock.mockResolvedValueOnce(json(payload));
    await expect(checkSelectedCalendarAvailability(selected, CALENDAR_ID, START, END)).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("encodes the event ID and treats only its actual 404 as absent", async () => {
    const selected = await context();
    queueChoice();
    fetchMock.mockResolvedValueOnce(json({ error: { code: 404 } }, 404));
    await expect(getSelectedCalendarEvent(selected, CALENDAR_ID, "event/id+?")).resolves.toBeNull();
    expect(fetchUrl(1).pathname).toBe(`/calendar/v3/calendars/${encodeURIComponent(CALENDAR_ID)}/events/event%2Fid%2B%3F`);
  });

  it.each([401, 403, 409, 429, 500, 503])("does not mistake HTTP %i for event absence", async (status) => {
    const selected = await context();
    queueChoice();
    fetchMock.mockResolvedValueOnce(json({ error: { code: status, message: "mock-provider-detail" } }, status));
    await expect(getSelectedCalendarEvent(selected, CALENDAR_ID, EVENT_ID)).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not translate a calendar-access 404 into an absent event", async () => {
    const selected = await context();
    fetchMock.mockResolvedValueOnce(json({ error: { code: 404 } }, 404));
    await expect(getSelectedCalendarEvent(selected, CALENDAR_ID, EVENT_ID)).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it.each(["all", "none"] as const)("inserts the exact reviewed payload with sendUpdates=%s", async (sendUpdates) => {
    const selected = await context();
    queueChoice({ accessRole: "writer" });
    const event = eventPayload();
    if (sendUpdates === "none") event.attendees = [];
    fetchMock.mockResolvedValueOnce(json(event));
    await expect(insertReviewedCalendarEvent(selected, CALENDAR_ID, event, sendUpdates)).resolves.toMatchObject({ id: EVENT_ID });
    expect(fetchUrl(0).pathname).toContain("/users/me/calendarList/");
    expect(fetchUrl(1).pathname).toBe(`/calendar/v3/calendars/${encodeURIComponent(CALENDAR_ID)}/events`);
    expect(fetchUrl(1).searchParams.get("sendUpdates")).toBe(sendUpdates);
    expect(fetchUrl(1).searchParams.has("conferenceDataVersion")).toBe(false);
    expect(fetchMock.mock.calls[1]?.[1]?.method).toBe("POST");
    expect(fetchBody(1)).toEqual(event);
    expect(new Headers(fetchMock.mock.calls[1]?.[1]?.headers).get("authorization")).toBe(`Bearer ${TOKEN}`);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each(["reader", "freeBusyReader"])("never inserts when verified role is %s", async (accessRole) => {
    const selected = await context();
    queueChoice({ accessRole });
    await expect(insertReviewedCalendarEvent(selected, CALENDAR_ID, eventPayload(), "all")).rejects.toThrow();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  });

  it("never inserts under read-only credentials", async () => {
    const selected = await context(READ_SCOPE);
    queueChoice();
    await expect(insertReviewedCalendarEvent(selected, CALENDAR_ID, eventPayload(), "all")).rejects.toThrow();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  });

  it("rejects legacy conference creation absent from the reviewed contract before any provider call", async () => {
    const selected = await context();
    const unexpectedLegacyPayload = { ...eventPayload(), conferenceData: { createRequest: { requestId: "not-reviewed" } } };
    await expect(insertReviewedCalendarEvent(selected, CALENDAR_ID, unexpectedLegacyPayload, "all"))
      .rejects.toMatchObject({ status: 400 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    { id: "" },
    { id: "unsafe/id" },
    { id: "wxyz-not-base32hex" },
    { start: { dateTime: START } },
    { start: { dateTime: START, timeZone: "Mars/Olympus_Mons" } },
    { end: { dateTime: START, timeZone: "America/New_York" } },
    { end: { dateTime: "invalid", timeZone: "America/New_York" } },
  ])("rejects malformed reviewed event data without an insert: %#", async (overrides) => {
    const selected = await context();
    queueChoice();
    await expect(insertReviewedCalendarEvent(selected, CALENDAR_ID, { ...eventPayload(), ...overrides }, "all"))
      .rejects.toThrow();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  });

  it.each([undefined, "externalOnly", "invalid"])("rejects unreviewed notification mode %s", async (sendUpdates) => {
    const selected = await context();
    queueChoice();
    await expect(insertReviewedCalendarEvent(selected, CALENDAR_ID, eventPayload(), sendUpdates as never)).rejects.toThrow();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  });

  it("does not retry an uncertain insertion after a transport failure", async () => {
    const selected = await context();
    queueChoice();
    fetchMock.mockRejectedValueOnce(new TypeError("mock connection lost after request"));
    await expect(insertReviewedCalendarEvent(selected, CALENDAR_ID, eventPayload(), "all")).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
