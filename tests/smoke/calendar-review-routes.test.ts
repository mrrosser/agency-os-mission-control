import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET as calendars } from "@/app/api/calendar/calendars/route";
import { POST as prepare } from "@/app/api/calendar/requests/route";
import { GET as get } from "@/app/api/calendar/requests/[requestId]/route";
import { POST as approve } from "@/app/api/calendar/requests/[requestId]/approve/route";
import { POST as execute } from "@/app/api/calendar/requests/[requestId]/execute/route";
import { POST as reconcile } from "@/app/api/calendar/requests/[requestId]/reconcile/route";

const mocks = vi.hoisted(() => ({
  verify: vi.fn(), owner: vi.fn(), prepare: vi.fn(), get: vi.fn(), approve: vi.fn(),
  execute: vi.fn(), reconcile: vi.fn(), resolve: vi.fn(), choices: vi.fn(),
}));
vi.mock("@/lib/firebase-admin", () => ({ getAdminAuth: () => ({ verifyIdToken: mocks.verify }) }));
vi.mock("@/lib/crm/portfolio-registry", () => ({ assertPortfolioRegistryAccess: mocks.owner }));
vi.mock("@/lib/calendar/event-requests", () => ({
  prepareCalendarEventRequest: mocks.prepare, getCalendarEventRequest: mocks.get,
  approveCalendarEventRequest: mocks.approve, executeCalendarEventRequest: mocks.execute,
  reconcileCalendarEventRequest: mocks.reconcile,
}));
vi.mock("@/lib/calendar/google-calendar-context", () => ({ resolveCalendarContext: mocks.resolve, listCalendarChoices: mocks.choices }));
vi.mock("@/lib/telemetry/store", () => ({ storeTelemetryErrorEvent: vi.fn() }));

const id = "a".repeat(64);
const fingerprint = "b".repeat(64);
const ownerUid = "synthetic-owner";
const review = { requestId: id, fingerprint, status: "awaiting_approval" };
const draft = {
  profileId: "rt_solutions_work", calendarId: "selected@example.test", summary: "Synthetic meeting",
  description: "", location: "", startLocal: "2030-01-10T14:00", endLocal: "2030-01-10T15:00",
  timeZone: "America/Chicago", attendees: ["guest@example.test"], sendUpdates: "all",
};
function request(path: string, body?: unknown, extraHeaders: Record<string, string> = {}) {
  return new NextRequest(`https://leadflow-review.web.app/api/calendar/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { Authorization: "Bearer synthetic-owner-token", Origin: "https://leadflow-review.web.app", "Content-Type": "application/json", ...extraHeaders },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
async function invoke(route: typeof get, req: NextRequest, requestId = id) {
  const response = await route(req, { params: Promise.resolve({ requestId }) });
  expect(response.headers.get("cache-control")).toContain("no-store");
  return response;
}
function expectNoEngineCalls() {
  for (const name of ["prepare", "get", "approve", "execute", "reconcile", "resolve", "choices"] as const) expect(mocks[name]).not.toHaveBeenCalled();
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.unstubAllEnvs();
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("Unexpected external request"); }));
  mocks.verify.mockResolvedValue({ uid: ownerUid, auth_time: 1_893_456_001, firebase: { sign_in_provider: "password" } });
  mocks.owner.mockResolvedValue({ workspaceId: "workspace_default_synthetic-owner", role: "owner" });
  for (const name of ["prepare", "get", "approve", "execute", "reconcile"] as const) mocks[name].mockResolvedValue(review);
  mocks.resolve.mockResolvedValue({ profileId: draft.profileId, accountEmail: "owner@example.test", accountSubject: "private-subject", accessToken: "private-access-token", accountId: "private-account", bindingFingerprint: "private-binding", canWriteEvents: true });
  mocks.choices.mockResolvedValue([{ id: draft.calendarId, summary: "Work", timeZone: "America/Chicago", accessRole: "owner", primary: true, canCreateEvents: true }]);
});
afterEach(() => {
  expect(fetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe.each([
  { name: "calendar choices", route: calendars, path: "calendars?profileId=rt_solutions_work", body: undefined },
  { name: "prepare", route: prepare, path: "requests", body: draft },
  { name: "get", route: get, path: `requests/${id}`, body: undefined },
  { name: "approve", route: approve, path: `requests/${id}/approve`, body: { fingerprint, approved: true } },
  { name: "execute", route: execute, path: `requests/${id}/execute`, body: { fingerprint } },
  { name: "reconcile", route: reconcile, path: `requests/${id}/reconcile`, body: { fingerprint } },
])("$name owner boundary", ({ route, path, body }) => {
  it("requires a revocation-checked owner token", async () => {
    expect((await invoke(route, request(path, body, { Authorization: "" }))).status).toBe(401);
    expectNoEngineCalls();
    expect(mocks.verify).not.toHaveBeenCalled();
  });
  it("rejects revoked credentials", async () => {
    mocks.verify.mockRejectedValue(new Error("revoked"));
    expect((await invoke(route, request(path, body))).status).toBe(401);
    expect(mocks.verify).toHaveBeenCalledWith("synthetic-owner-token", true);
    expectNoEngineCalls();
  });
  it("rejects a non-owner workspace administrator", async () => {
    mocks.owner.mockResolvedValue({ workspaceId: "workspace_default_synthetic-owner", role: "admin" });
    expect((await invoke(route, request(path, body))).status).toBe(403);
    expectNoEngineCalls();
  });
});

describe("calendar review API boundaries", () => {
  it("lists only public verified connection metadata", async () => {
    const response = await invoke(calendars, request("calendars?profileId=rt_solutions_work"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ profileId: draft.profileId, accountEmail: "owner@example.test", identityVerified: true, canWriteEvents: true, calendars: await mocks.choices.mock.results[0].value });
    expect(JSON.stringify(body)).not.toContain("private-");
  });
  it.each(["", "?profileId=personal", "?profileId=rt_solutions_send", "?profileId=rt_solutions_work&profileId=rosser_gallery_work", "?profileId=rt_solutions_work&approved=true"])("rejects invalid selection query %s", async (query) => {
    expect((await invoke(calendars, request(`calendars${query}`))).status).toBe(400);
    expectNoEngineCalls();
  });
  it("prepares only the submitted draft and never approves or executes", async () => {
    expect((await invoke(prepare, request("requests", draft))).status).toBe(200);
    expect(mocks.prepare).toHaveBeenCalledWith(ownerUid, draft, expect.anything());
    expect(mocks.approve).not.toHaveBeenCalled();
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it.each([{ approved: true }, { fingerprint }, { receipt: { eventId: "fake" } }, { startDateTime: "2030-01-10T14:00:00Z" }])("rejects authority or derived fields in a draft: %j", async (extra) => {
    expect((await invoke(prepare, request("requests", { ...draft, ...extra }))).status).toBe(400);
    expectNoEngineCalls();
  });
  it("GET recovery only reads an existing request", async () => {
    expect((await invoke(get, request(`requests/${id}`))).status).toBe(200);
    expect(mocks.get).toHaveBeenCalledWith(ownerUid, id);
    expect(mocks.approve).not.toHaveBeenCalled();
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(mocks.reconcile).not.toHaveBeenCalled();
  });
  it("passes reauthentication claims from the verified token to approval", async () => {
    expect((await invoke(approve, request(`requests/${id}/approve`, { fingerprint, approved: true }))).status).toBe(200);
    expect(mocks.approve).toHaveBeenCalledWith(ownerUid, id, { fingerprint, approved: true }, { authTime: 1_893_456_001, provider: "password" }, expect.anything());
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it.each(["", "https://attacker.example", "https://leadflow-review.web.app.attacker.example"])("rejects approval origin %s before auth or engine", async (origin) => {
    expect((await invoke(approve, request(`requests/${id}/approve`, { fingerprint, approved: true }, { Origin: origin }))).status).toBe(403);
    expect(mocks.verify).not.toHaveBeenCalled();
    expectNoEngineCalls();
  });
  it.each([{ fingerprint, approved: false }, { fingerprint }, { fingerprint, approved: true, authTime: 1_893_456_001 }, { fingerprint, approved: true, provider: "password" }])("rejects missing approval or caller-supplied auth evidence: %j", async (body) => {
    expect((await invoke(approve, request(`requests/${id}/approve`, body))).status).toBe(400);
    expectNoEngineCalls();
  });
  it.each([
    { route: execute, path: "execute", target: "execute" as const },
    { route: reconcile, path: "reconcile", target: "reconcile" as const },
  ])("$path accepts only the exact reviewed fingerprint", async ({ route, path, target }) => {
    expect((await invoke(route, request(`requests/${id}/${path}`, { fingerprint, event: draft }))).status).toBe(400);
    expectNoEngineCalls();
    expect((await invoke(route, request(`requests/${id}/${path}`, { fingerprint }))).status).toBe(200);
    expect(mocks[target]).toHaveBeenCalledWith(ownerUid, id, fingerprint, expect.anything());
    expect(mocks.approve).not.toHaveBeenCalled();
  });
  it.each([get, approve, execute, reconcile])("rejects malformed path IDs before engine access", async (route) => {
    expect((await invoke(route, request("requests/not-an-id", route === get ? undefined : { fingerprint, approved: true }), "not-an-id")).status).toBe(400);
    expectNoEngineCalls();
  });
  it.each([prepare, get, approve, execute, reconcile])("rejects query parameters on review operations", async (route) => {
    expect((await invoke(route, request(`requests/${id}?execute=true`, route === get ? undefined : draft))).status).toBe(400);
    expectNoEngineCalls();
  });
  it("bounds actual approval bytes before parsing", async () => {
    expect((await invoke(approve, request(`requests/${id}/approve`, { fingerprint, approved: true, padding: "x".repeat(1100) }))).status).toBe(413);
    expectNoEngineCalls();
  });
});
