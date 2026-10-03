import { describe, expect, it } from "vitest";
import { CalendarEventDraftSchema, buildCalendarDraftReviewLink, normalizeCalendarEventDraft, parseCalendarDraftHandoff, resolveCalendarLocalTime, type CalendarEventDraft } from "@/lib/calendar/event-contract";

const now = Date.parse("2030-01-01T00:00:00Z");
const draft: CalendarEventDraft = {
  profileId: "rosser_gallery_work", calendarId: "synthetic@example.test", summary: " Synthetic review ", description: "line 1\r\nline 2", location: " Room A ",
  startLocal: "2030-01-10T14:00", endLocal: "2030-01-10T15:00", timeZone: "America/Chicago", attendees: [], sendUpdates: "none",
};

describe("calendar wall time and immutable draft contract", () => {
  it.each([
    ["2030-01-10T14:00", "America/Chicago", "2030-01-10T20:00:00.000Z"],
    ["2030-07-10T14:00", "America/Chicago", "2030-07-10T19:00:00.000Z"],
    ["2030-01-10T14:00", "Asia/Kathmandu", "2030-01-10T08:15:00.000Z"],
    ["2030-01-10T00:00", "UTC", "2030-01-10T00:00:00.000Z"],
  ])("resolves %s in %s independently of machine timezone", (local, zone, expected) => {
    expect(resolveCalendarLocalTime(local, zone)).toBe(expected);
  });
  it("rejects a daylight-saving gap and repeated fall hour", () => {
    expect(() => resolveCalendarLocalTime("2030-03-10T02:30", "America/Chicago")).toThrow(/does not exist/);
    expect(() => resolveCalendarLocalTime("2030-11-03T01:30", "America/Chicago")).toThrow(/occurs twice/);
  });
  it.each(["2030-02-30T10:00", "2030-01-10T25:00", "2030-01-10", "2030-01-10T10:00Z"])("rejects invalid wall time %s", (value) => {
    expect(() => resolveCalendarLocalTime(value, "UTC")).toThrow();
  });
  it("rejects an unknown timezone", () => {
    expect(() => resolveCalendarLocalTime(draft.startLocal, "Mars/Olympus")).toThrow(/IANA timezone/);
  });
  it("normalizes exact review values and deduplicates guests", () => {
    expect(normalizeCalendarEventDraft({ ...draft, attendees: ["Guest@example.test", "guest@example.test"], sendUpdates: "all" }, now)).toMatchObject({
      summary: "Synthetic review", location: "Room A", description: "line 1\nline 2", attendees: ["guest@example.test"], startDateTime: "2030-01-10T20:00:00.000Z",
    });
  });
  it("rejects past, reversed and overly long events", () => {
    expect(() => normalizeCalendarEventDraft(draft, Date.parse("2031-01-01Z"))).toThrow(/future/);
    expect(() => normalizeCalendarEventDraft({ ...draft, endLocal: "2030-01-10T13:00" }, now)).toThrow(/after the start/);
    expect(() => normalizeCalendarEventDraft({ ...draft, endLocal: "2030-01-20T15:00" }, now)).toThrow(/seven days/);
  });
  it.each([
    { profileId: "rosser_gallery_send" }, { calendarId: "primary" }, { summary: "" },
    { summary: "title\nsecond title" }, { attendees: ["bad"] },
    { attendees: ["guest@example.test"], sendUpdates: "none" }, { attendees: [], sendUpdates: "all" },
    { approved: true }, { startDateTime: "2030-01-10T01:00:00Z" },
  ])("rejects unsafe or ambiguous event input %j", (change) => {
    expect(CalendarEventDraftSchema.safeParse({ ...draft, ...change }).success).toBe(false);
  });
});

describe("untrusted OpenClaw draft handoff", () => {
  it("round-trips only draft fields in the fragment, never a server query", () => {
    const url = new URL(buildCalendarDraftReviewLink({ summary: "Synthetic & private", startLocal: draft.startLocal, timeZone: draft.timeZone }));
    expect(url.origin).toBe("https://leadflow-review.web.app");
    expect(url.pathname).toBe("/dashboard/calendar");
    expect(url.search).toBe("");
    expect(parseCalendarDraftHandoff(url.hash)).toEqual({ summary: "Synthetic & private", startLocal: draft.startLocal, timeZone: draft.timeZone });
  });
  it("does not interpret ordinary fragments as calendar drafts", () => {
    expect(parseCalendarDraftHandoff("#settings")).toBeNull();
  });
  it("rejects supplied approval/receipt authority and malformed encoding", () => {
    expect(() => parseCalendarDraftHandoff(`#draft=${encodeURIComponent(JSON.stringify({ approved: true, fingerprint: "a".repeat(64) }))}`)).toThrow(/invalid/);
    expect(() => parseCalendarDraftHandoff("#draft=%zz")).toThrow(/invalid/);
    expect(() => parseCalendarDraftHandoff("#draft=" + "x".repeat(49_201))).toThrow(/too large/);
  });
});
