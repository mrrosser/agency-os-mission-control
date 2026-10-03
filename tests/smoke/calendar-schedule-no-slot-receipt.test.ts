import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST as schedule } from "@/app/api/calendar/schedule/route";
import { POST as createEvent } from "@/app/api/calendar/create-event/route";
import { ApiError } from "@/lib/api/handler";

const mocks = vi.hoisted(() => ({
  verifyIdToken: vi.fn(), registry: vi.fn(), oauth: vi.fn(), listBusy: vi.fn(),
  createMeeting: vi.fn(), receipt: vi.fn(), idempotencyKey: vi.fn(), idempotency: vi.fn(),
  resolveContext: vi.fn(), insertReviewed: vi.fn(), availability: vi.fn(),
}));
vi.mock("@/lib/firebase-admin", () => ({ getAdminAuth: () => ({ verifyIdToken: mocks.verifyIdToken }) }));
vi.mock("@/lib/crm/portfolio-registry", () => ({ assertPortfolioRegistryAccess: mocks.registry }));
vi.mock("@/lib/google/oauth", () => ({ getAccessTokenForUser: mocks.oauth }));
vi.mock("@/lib/google/calendar", () => ({ listBusyIntervals: mocks.listBusy, createMeetingWithAvailabilityCheck: mocks.createMeeting }));
vi.mock("@/lib/lead-runs/receipts", () => ({ recordLeadActionReceipt: mocks.receipt }));
vi.mock("@/lib/api/idempotency", () => ({ getIdempotencyKey: mocks.idempotencyKey, withIdempotency: mocks.idempotency }));
vi.mock("@/lib/calendar/google-calendar-context", () => ({
  resolveCalendarContext: mocks.resolveContext, insertReviewedCalendarEvent: mocks.insertReviewed,
  checkSelectedCalendarAvailability: mocks.availability,
}));
vi.mock("@/lib/telemetry/store", () => ({ storeTelemetryErrorEvent: vi.fn() }));

const booking = {
  profileId: "rt_solutions_work", calendarId: "work@example.test", runId: "run-1", leadDocId: "lead-1",
  receiptActionId: "calendar.booking", idempotencyKey: "old-booking-key", durationMinutes: 30,
  candidateStarts: ["2026-10-05T14:00:00Z"],
  event: { summary: "Discovery Call", start: { dateTime: "2026-10-05T14:00:00Z" }, end: { dateTime: "2026-10-05T14:30:00Z" } },
};
function request(path: string, init: NonNullable<ConstructorParameters<typeof NextRequest>[1]> = {}) {
  return new NextRequest(`http://localhost/api/calendar/${path}`, {
    method: "POST", headers: { Authorization: "Bearer owner-token", "Content-Type": "application/json", "Idempotency-Key": "old-booking-key" },
    body: JSON.stringify(booking), ...init,
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("Unexpected network call"); }));
  mocks.verifyIdToken.mockResolvedValue({ uid: "workspace-owner" });
  mocks.registry.mockResolvedValue({ workspaceId: "workspace_default_workspace-owner", role: "owner" });
});
afterEach(() => {
  for (const forbidden of [mocks.oauth, mocks.listBusy, mocks.createMeeting, mocks.receipt,
    mocks.idempotencyKey, mocks.idempotency, mocks.resolveContext, mocks.insertReviewed, mocks.availability, vi.mocked(fetch)]) {
    expect(forbidden).not.toHaveBeenCalled();
  }
  vi.unstubAllGlobals();
});

describe.each([
  { path: "schedule", route: schedule },
  { path: "create-event", route: createEvent },
])("retired calendar $path route", ({ path, route }) => {
  async function invoke(req: NextRequest) {
    const response = await route(req, { params: Promise.resolve({}) });
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(req.bodyUsed).toBe(false);
    return response;
  }
  it.each([false, true])("requires event review even with dryRun=%s and receipt/idempotency inputs", async (dryRun) => {
    const response = await invoke(request(path, { body: JSON.stringify({ ...booking, dryRun }) }));
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error).toContain("/dashboard/calendar");
    expect(body).not.toHaveProperty("success");
    expect(body).not.toHaveProperty("event");
    expect(mocks.verifyIdToken).toHaveBeenCalledWith("owner-token", true);
    expect(mocks.registry).toHaveBeenCalledWith("workspace-owner");
  });
  it.each([
    ["malformed", "{broken"], ["empty", ""], ["oversized", "a".repeat(64 * 1024)],
  ])("returns retirement guidance without parsing an authenticated %s body", async (_label, body) => {
    const response = await invoke(request(path, { body }));
    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain("/dashboard/calendar");
  });
  it("does not require JSON to reject this retired operation", async () => {
    const response = await invoke(request(path, { headers: { Authorization: "Bearer owner-token", "Content-Type": "text/plain" }, body: "legacy form" }));
    expect(response.status).toBe(409);
  });
  it("rejects missing authentication before returning operation guidance", async () => {
    const response = await invoke(request(path, { headers: {}, body: "{broken" }));
    expect(response.status).toBe(401);
    expect(mocks.verifyIdToken).not.toHaveBeenCalled();
    expect(mocks.registry).not.toHaveBeenCalled();
  });
  it("rejects a revoked owner token", async () => {
    mocks.verifyIdToken.mockRejectedValue(new Error("revoked token"));
    const response = await invoke(request(path));
    expect(response.status).toBe(401);
    expect(mocks.verifyIdToken).toHaveBeenCalledWith("owner-token", true);
    expect(mocks.registry).not.toHaveBeenCalled();
  });
  it("rejects an administrator rather than bypassing owner access", async () => {
    mocks.registry.mockResolvedValue({ workspaceId: "workspace_default_workspace-owner", role: "admin" });
    expect((await invoke(request(path))).status).toBe(403);
  });
  it("propagates inactive workspace access denial", async () => {
    mocks.registry.mockRejectedValue(new ApiError(403, "Inactive workspace."));
    expect((await invoke(request(path))).status).toBe(403);
  });
});
