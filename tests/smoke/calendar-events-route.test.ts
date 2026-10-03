import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST as events } from "@/app/api/calendar/events/route";
import { POST as availability } from "@/app/api/calendar/availability/route";
import { ApiError } from "@/lib/api/handler";

const mocks = vi.hoisted(() => ({
  verifyIdToken: vi.fn(), registry: vi.fn(), resolveContext: vi.fn(), listSelected: vi.fn(),
  checkSelected: vi.fn(), insertReviewed: vi.fn(), oldOauth: vi.fn(), oldList: vi.fn(),
  oldCreate: vi.fn(), oldDelete: vi.fn(), oldAvailability: vi.fn(), receipt: vi.fn(),
}));
vi.mock("@/lib/firebase-admin", () => ({ getAdminAuth: () => ({ verifyIdToken: mocks.verifyIdToken }) }));
vi.mock("@/lib/crm/portfolio-registry", () => ({ assertPortfolioRegistryAccess: mocks.registry }));
vi.mock("@/lib/calendar/google-calendar-context", () => ({
  resolveCalendarContext: mocks.resolveContext, listSelectedCalendarEvents: mocks.listSelected,
  checkSelectedCalendarAvailability: mocks.checkSelected, insertReviewedCalendarEvent: mocks.insertReviewed,
}));
vi.mock("@/lib/google/oauth", () => ({ getAccessTokenForUser: mocks.oldOauth }));
vi.mock("@/lib/google/calendar", () => ({
  listEvents: mocks.oldList, createEvent: mocks.oldCreate, deleteEvent: mocks.oldDelete,
  checkAvailability: mocks.oldAvailability,
}));
vi.mock("@/lib/lead-runs/receipts", () => ({ recordLeadActionReceipt: mocks.receipt }));
vi.mock("@/lib/telemetry/store", () => ({ storeTelemetryErrorEvent: vi.fn() }));

const selection = { profileId: "rt_solutions_work", calendarId: "selected-work@example.test" };
const timeWindow = { startTime: "2026-10-05T10:00:00-04:00", endTime: "2026-10-05T11:00:00-04:00" };
const readOnlyContext = Object.freeze({
  accessToken: "server-only-test-token", ...selection, accountId: "work-account",
  accountEmail: "owner@example.test", accountSubject: "subject-owner", bindingFingerprint: "sha256:fixture",
  canWriteEvents: false,
});
const listed = [
  { id: "one", summary: "Discovery Call - Acme", start: { dateTime: timeWindow.startTime }, end: { dateTime: timeWindow.endTime } },
  { id: "two", summary: "Discovery Call - Beta", start: { dateTime: timeWindow.startTime }, end: { dateTime: timeWindow.endTime } },
  { id: "three", summary: "Team Sync", start: { dateTime: timeWindow.startTime }, end: { dateTime: timeWindow.endTime } },
];
const routeContext = () => ({ params: Promise.resolve({}) });
function request(path: string, body: unknown, init: NonNullable<ConstructorParameters<typeof NextRequest>[1]> = {}) {
  return new NextRequest(`http://localhost/api/calendar/${path}`, {
    method: "POST", headers: { Authorization: "Bearer owner-token", "Content-Type": "application/json" },
    body: JSON.stringify(body), ...init,
  });
}
async function invoke(route: typeof events, req: NextRequest) {
  const response = await route(req, routeContext());
  expect(response.headers.get("cache-control")).toContain("no-store");
  return response;
}
function expectNoContext() {
  expect(mocks.resolveContext).not.toHaveBeenCalled();
  expect(mocks.listSelected).not.toHaveBeenCalled();
  expect(mocks.checkSelected).not.toHaveBeenCalled();
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("Unexpected network call"); }));
  mocks.verifyIdToken.mockResolvedValue({ uid: "workspace-owner" });
  mocks.registry.mockResolvedValue({ workspaceId: "workspace_default_workspace-owner", role: "owner" });
  mocks.resolveContext.mockResolvedValue(readOnlyContext);
  mocks.listSelected.mockResolvedValue({ events: listed });
  mocks.checkSelected.mockResolvedValue(true);
});
afterEach(() => {
  for (const forbidden of [mocks.oldOauth, mocks.oldList, mocks.oldCreate, mocks.oldDelete,
    mocks.oldAvailability, mocks.insertReviewed, mocks.receipt, vi.mocked(fetch)]) {
    expect(forbidden).not.toHaveBeenCalled();
  }
  vi.unstubAllGlobals();
});

describe.each([
  { label: "event list", route: events, path: "events?action=list", body: selection },
  { label: "availability", route: availability, path: "availability", body: { ...selection, ...timeWindow } },
])("$label owner and request boundary", ({ route, path, body }) => {
  it.each([undefined, "", "Basic owner-token", "Bearer "])("rejects missing or malformed credentials (%s) before reading the body", async (authorization) => {
    const req = request(path, body, { headers: { "Content-Type": "application/json", ...(authorization === undefined ? {} : { Authorization: authorization }) }, body: "{broken" });
    expect((await invoke(route, req)).status).toBe(401);
    expect(req.bodyUsed).toBe(false);
    expect(mocks.verifyIdToken).not.toHaveBeenCalled();
    expect(mocks.registry).not.toHaveBeenCalled();
    expectNoContext();
  });
  it("rejects revoked tokens with Firebase revocation checking enabled", async () => {
    mocks.verifyIdToken.mockRejectedValue(new Error("revoked"));
    const req = request(path, body, { body: "{broken" });
    expect((await invoke(route, req)).status).toBe(401);
    expect(mocks.verifyIdToken).toHaveBeenCalledWith("owner-token", true);
    expect(mocks.registry).not.toHaveBeenCalled();
    expect(req.bodyUsed).toBe(false);
    expectNoContext();
  });
  it("rejects administrators who are not the owner", async () => {
    mocks.registry.mockResolvedValue({ workspaceId: "workspace_default_workspace-owner", role: "admin" });
    expect((await invoke(route, request(path, body))).status).toBe(403);
    expect(mocks.registry).toHaveBeenCalledWith("workspace-owner");
    expectNoContext();
  });
  it("stops when active workspace membership cannot be established", async () => {
    mocks.registry.mockRejectedValue(new ApiError(403, "Workspace or membership is inactive."));
    expect((await invoke(route, request(path, body))).status).toBe(403);
    expectNoContext();
  });
  it.each([
    ["missing profile", { profileId: undefined }], ["personal profile", { profileId: "personal" }],
    ["send-only profile", { profileId: "rosser_gallery_send" }], ["missing calendar", { calendarId: undefined }],
    ["implicit primary", { calendarId: "primary" }], ["case-variant primary", { calendarId: "PRIMARY" }],
    ["empty calendar", { calendarId: "" }], ["whitespace calendar", { calendarId: "unverified calendar" }],
    ["overlong calendar", { calendarId: "a".repeat(1025) }],
  ])("rejects %s before resolving a connection", async (_label, changed) => {
    expect((await invoke(route, request(path, { ...body, ...changed }))).status).toBe(400);
    expectNoContext();
  });
  it.each([
    ["malformed JSON", "{broken", "application/json", 400],
    ["empty JSON", "", "application/json", 400],
    ["JSON array", "[]", "application/json", 400],
    ["wrong content type", JSON.stringify(body), "text/plain", 415],
    ["oversized actual body", JSON.stringify({ ...body, padding: "a".repeat(33 * 1024) }), "application/json", 413],
  ])("rejects %s within the body boundary", async (_label, raw, contentType, status) => {
    const response = await invoke(route, request(path, body, { body: raw, headers: { Authorization: "Bearer owner-token", "Content-Type": contentType } }));
    expect(response.status).toBe(status);
    expectNoContext();
  });
  it.each([409, 403, 503])("preserves selected connection failure (%s) without provider fallback", async (status) => {
    mocks.resolveContext.mockRejectedValue(new ApiError(status, "Selected connection unavailable."));
    expect((await invoke(route, request(path, body))).status).toBe(status);
    expect(mocks.listSelected).not.toHaveBeenCalled();
    expect(mocks.checkSelected).not.toHaveBeenCalled();
  });
});

describe("explicit calendar event reads", () => {
  it.each(["rt_solutions_work", "rosser_gallery_work"])("lists the selected %s calendar using a verified read-only context", async (profileId) => {
    const response = await invoke(events, request("events?action=list", { ...selection, profileId, maxResults: 1, timeMin: timeWindow.startTime }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ events: listed });
    expect(mocks.verifyIdToken).toHaveBeenCalledWith("owner-token", true);
    expect(mocks.registry).toHaveBeenCalledWith("workspace-owner");
    expect(mocks.resolveContext).toHaveBeenCalledWith("workspace-owner", profileId, expect.anything());
    expect(mocks.listSelected).toHaveBeenCalledWith(readOnlyContext, selection.calendarId,
      expect.objectContaining({ maxResults: 1, timeMin: timeWindow.startTime }), expect.anything());
  });
  it("preserves pagination without exposing a context or access token", async () => {
    mocks.listSelected.mockResolvedValue({ events: [], nextPageToken: "next-page" });
    const response = await invoke(events, request("events?action=list", { ...selection, maxResults: 100 }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ events: [], nextPageToken: "next-page" });
  });
  it.each([0, 101, -1, 1.5, "10", null])("rejects invalid maxResults %s", async (maxResults) => {
    expect((await invoke(events, request("events?action=list", { ...selection, maxResults }))).status).toBe(400);
    expectNoContext();
  });
  it.each(["not-a-date", "2026-10-05T10:00:00", "2026-02-30T10:00:00Z"])("rejects invalid or offset-free timeMin %s", async (timeMin) => {
    expect((await invoke(events, request("events?action=list", { ...selection, timeMin }))).status).toBe(400);
    expectNoContext();
  });
  it("preserves provider failures instead of returning an empty calendar", async () => {
    mocks.listSelected.mockRejectedValue(new ApiError(502, "Incomplete calendar response."));
    const response = await invoke(events, request("events?action=list", selection));
    expect(response.status).toBe(502);
    expect(await response.json()).not.toHaveProperty("events");
  });
  it("rejects unknown actions without a connection or provider read", async () => {
    expect((await invoke(events, request("events?action=delete", selection))).status).toBe(400);
    expectNoContext();
  });
});

describe("calendar cleanup preview and retired direct creation", () => {
  it("defaults cleanup to a bounded dry run and reports matches without deleting", async () => {
    const response = await invoke(events, request("events?action=cleanup", selection));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, dryRun: true, scanned: 3, matched: 2, deleted: 0, truncated: false });
    expect(mocks.listSelected).toHaveBeenCalledWith(readOnlyContext, selection.calendarId,
      expect.objectContaining({ maxResults: 100 }), expect.anything());
  });
  it("marks paginated cleanup as truncated and honors a summary prefix", async () => {
    mocks.listSelected.mockResolvedValue({ events: listed, nextPageToken: "unread-page" });
    const response = await invoke(events, request("events?action=cleanup", { ...selection, summaryPrefix: "Team", maxResults: 100, dryRun: true }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ dryRun: true, matched: 1, deleted: 0, truncated: true });
  });
  it("rejects destructive cleanup before resolving a Google connection", async () => {
    expect((await invoke(events, request("events?action=cleanup", { ...selection, dryRun: false }))).status).toBe(409);
    expectNoContext();
  });
  it.each([{}, { profileId: selection.profileId }, { ...selection, maxResults: 101 }, { ...selection, maxResults: 0 }])("rejects incomplete or unbounded cleanup input %#", async (input) => {
    expect((await invoke(events, request("events?action=cleanup", input))).status).toBe(400);
    expectNoContext();
  });
  it.each(["{broken", "", JSON.stringify({ summary: "Unapproved", dryRun: true })])("closes direct creation without consuming the body %#", async (body) => {
    const req = request("events?action=create", {}, { body });
    const response = await invoke(events, req);
    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain("/dashboard/calendar");
    expect(req.bodyUsed).toBe(false);
    expect(mocks.verifyIdToken).toHaveBeenCalledWith("owner-token", true);
    expectNoContext();
  });
  it("authenticates direct creation before returning retirement guidance", async () => {
    expect((await invoke(events, request("events?action=create", {}, { headers: {} }))).status).toBe(401);
    expectNoContext();
  });
});

describe("selected calendar availability", () => {
  it.each([true, false])("returns verified availability %s for an explicit read-only selection", async (available) => {
    mocks.checkSelected.mockResolvedValue(available);
    const response = await invoke(availability, request("availability", { ...selection, ...timeWindow }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ available });
    expect(mocks.resolveContext).toHaveBeenCalledWith("workspace-owner", selection.profileId, expect.anything());
    expect(mocks.checkSelected).toHaveBeenCalledWith(readOnlyContext, selection.calendarId, timeWindow.startTime, timeWindow.endTime, expect.anything());
    expect(mocks.listSelected).not.toHaveBeenCalled();
  });
  it("accepts the seven-day boundary", async () => {
    expect((await invoke(availability, request("availability", { ...selection, startTime: "2026-10-05T10:00:00Z", endTime: "2026-10-12T10:00:00Z" }))).status).toBe(200);
  });
  it.each([
    { startTime: undefined }, { endTime: undefined }, { startTime: "2026-10-05T10:00:00" },
    { endTime: "invalid" }, { startTime: "2026-02-30T10:00:00Z" },
    { endTime: timeWindow.startTime }, { endTime: "2026-10-05T09:00:00-04:00" },
    { startTime: "2026-10-05T10:00:00Z", endTime: "2026-10-12T10:00:01Z" },
  ])("rejects missing, invalid, reversed or excessive ranges %#", async (changed) => {
    expect((await invoke(availability, request("availability", { ...selection, ...timeWindow, ...changed }))).status).toBe(400);
    expectNoContext();
  });
  it.each([new ApiError(502, "Availability could not be verified."), new Error("Unexpected provider failure")])("fails closed when availability cannot be established %#", async (error) => {
    mocks.checkSelected.mockRejectedValue(error);
    const response = await invoke(availability, request("availability", { ...selection, ...timeWindow }));
    expect(response.status).toBe(error instanceof ApiError ? 502 : 500);
    expect(await response.json()).not.toHaveProperty("available");
  });
});
