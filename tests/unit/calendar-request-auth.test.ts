import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { z } from "zod";
import { assertCalendarApprovalOrigin, parseCalendarJson, requireCalendarOwner } from "@/lib/calendar/request-auth";

const mocks = vi.hoisted(() => ({ verify: vi.fn(), access: vi.fn() }));
vi.mock("@/lib/firebase-admin", () => ({ getAdminAuth: () => ({ verifyIdToken: mocks.verify }) }));
vi.mock("@/lib/crm/portfolio-registry", () => ({ assertPortfolioRegistryAccess: mocks.access }));

describe("calendar authenticated owner boundary", () => {
  beforeEach(() => {
    vi.resetAllMocks(); vi.unstubAllEnvs();
    mocks.verify.mockResolvedValue({ uid: "synthetic-owner", auth_time: 1, firebase: { sign_in_provider: "google.com" } });
    mocks.access.mockResolvedValue({ role: "owner", workspaceId: "workspace_default_synthetic-owner" });
  });
  it("verifies revoked tokens and exact active owner access", async () => {
    const user = await requireCalendarOwner(new NextRequest("https://leadflow-review.web.app/api/calendar/calendars", { headers: { Authorization: "Bearer synthetic-token" } }));
    expect(mocks.verify).toHaveBeenCalledWith("synthetic-token", true);
    expect(mocks.access).toHaveBeenCalledWith("synthetic-owner");
    expect(user.uid).toBe("synthetic-owner");
  });
  it("rejects service headers and missing bearer tokens", async () => {
    await expect(requireCalendarOwner(new NextRequest("https://leadflow-review.web.app/api/calendar/requests", { headers: { "x-second-brain-token": "synthetic" } }))).rejects.toMatchObject({ status: 401 });
    expect(mocks.verify).not.toHaveBeenCalled();
  });
  it("rejects revoked credentials and non-owner memberships", async () => {
    const request = new NextRequest("https://leadflow-review.web.app/api/calendar/requests", { headers: { Authorization: "Bearer synthetic-token" } });
    mocks.verify.mockRejectedValueOnce(new Error("revoked"));
    await expect(requireCalendarOwner(request)).rejects.toMatchObject({ status: 401 });
    mocks.access.mockResolvedValueOnce({ role: "admin" });
    await expect(requireCalendarOwner(request)).rejects.toMatchObject({ status: 403 });
  });
  it("accepts exact app Origin and rejects absent/cross-site/lookalike origins", () => {
    const make = (origin?: string, site?: string) => new Request("https://backend.invalid/api/calendar/requests/id/approve", { headers: { ...(origin ? { Origin: origin } : {}), ...(site ? { "Sec-Fetch-Site": site } : {}) } });
    expect(() => assertCalendarApprovalOrigin(make("https://leadflow-review.web.app", "same-origin"))).not.toThrow();
    for (const value of [undefined, "https://leadflow-review.web.app.attacker.test", "null", "https://attacker.test"]) expect(() => assertCalendarApprovalOrigin(make(value))).toThrow();
    expect(() => assertCalendarApprovalOrigin(make("https://leadflow-review.web.app", "cross-site"))).toThrow();
  });
  it("fails closed on malformed configured production origin", () => {
    vi.stubEnv("MISSION_CONTROL_PUBLIC_ORIGIN", "http://untrusted.example");
    expect(() => assertCalendarApprovalOrigin(new Request("https://leadflow-review.web.app/", { headers: { Origin: "https://leadflow-review.web.app" } }))).toThrow(/not configured correctly/);
  });
  it("validates content type, bounded bytes and strict schema", async () => {
    const schema = z.object({ fingerprint: z.string() }).strict();
    const request = (body: string, contentType = "application/json") => new Request("https://leadflow-review.web.app/", { method: "POST", headers: { "Content-Type": contentType }, body });
    await expect(parseCalendarJson(request('{"fingerprint":"x"}'), schema)).resolves.toEqual({ fingerprint: "x" });
    await expect(parseCalendarJson(request('{}', "text/plain"), schema)).rejects.toMatchObject({ status: 415 });
    await expect(parseCalendarJson(request('{"fingerprint":"x","approved":true}'), schema)).rejects.toMatchObject({ status: 400 });
    await expect(parseCalendarJson(request("x".repeat(1025)), schema, 1024)).rejects.toMatchObject({ status: 413 });
  });
});
