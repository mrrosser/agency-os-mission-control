import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const {
  stateSetMock,
  idempotencyGetMock,
  idempotencySetMock,
  getAdminDbMock,
  requireFirebaseAuthMock,
  getGoogleAuthUrlMock,
} = vi.hoisted(() => {
  const stateSetMock = vi.fn();
  const idempotencyGetMock = vi.fn();
  const idempotencySetMock = vi.fn();
  const stateDocMock = vi.fn(() => ({ set: stateSetMock }));
  const idempotencyDocMock = vi.fn(() => ({
    get: idempotencyGetMock,
    set: idempotencySetMock,
  }));
  const collectionMock = vi.fn((name: string) => ({
    doc: name === "idempotency" ? idempotencyDocMock : stateDocMock,
  }));
  const getAdminDbMock = vi.fn(() => ({ collection: collectionMock }));
  const requireFirebaseAuthMock = vi.fn();
  const getGoogleAuthUrlMock = vi.fn();
  return {
    stateSetMock,
    idempotencyGetMock,
    idempotencySetMock,
    getAdminDbMock,
    requireFirebaseAuthMock,
    getGoogleAuthUrlMock,
  };
});

vi.mock("@/lib/api/auth", () => ({
  requireFirebaseAuth: requireFirebaseAuthMock,
}));

vi.mock("@/lib/firebase-admin", () => ({
  getAdminDb: getAdminDbMock,
}));

vi.mock("@/lib/google/oauth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/google/oauth")>(
    "@/lib/google/oauth"
  );
  return {
    ...actual,
    getGoogleAuthUrl: getGoogleAuthUrlMock,
  };
});

import { POST } from "@/app/api/google/connect/route";

describe("google connect route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.MISSION_CONTROL_PUBLIC_ORIGIN = "https://leadflow-review.web.app";
    requireFirebaseAuthMock.mockResolvedValue({
      uid: "uid-123",
      email: "user@example.com",
    });
    getGoogleAuthUrlMock.mockReturnValue("https://accounts.google.com/o/oauth2/auth");
    stateSetMock.mockResolvedValue(undefined);
    idempotencyGetMock.mockResolvedValue({ exists: false });
    idempotencySetMock.mockResolvedValue(undefined);
  });

  it("stores canonical business and profile context in OAuth state", async () => {
    const request = new NextRequest("https://leadflow-review.web.app/api/google/connect", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-idempotency-key": "oauth-rt-1",
      },
      body: JSON.stringify({
        returnTo: "/dashboard/integrations?tab=google",
        scopePreset: "drive",
        workspaceId: "workspace-1",
        businessId: "rt_solutions",
        profileId: "rt_solutions_work",
        correlationId: "corr-1",
      }),
    });

    const response = await POST(request, {} as never);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      authUrl: "https://accounts.google.com/o/oauth2/auth",
      businessId: "rt_solutions",
      profileId: "rt_solutions_work",
    });

    expect(stateSetMock).toHaveBeenCalledOnce();
    expect(stateSetMock.mock.calls[0]?.[0]).toMatchObject({
      uid: "uid-123",
      returnTo: "/dashboard/integrations?tab=google",
      origin: "https://leadflow-review.web.app",
      scopePreset: "drive",
      workspaceId: "workspace-1",
      businessId: "rt_solutions",
      profileId: "rt_solutions_work",
      correlationId: "corr-1",
    });
    expect(idempotencySetMock).toHaveBeenCalledOnce();
  });

  it("preserves the no-context legacy connect response", async () => {
    const request = new NextRequest("https://leadflow-review.web.app/api/google/connect", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scopePreset: "core" }),
    });

    const response = await POST(request, {} as never);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      authUrl: "https://accounts.google.com/o/oauth2/auth",
    });
    expect(stateSetMock.mock.calls[0]?.[0]).toMatchObject({
      businessId: null,
      profileId: null,
    });
  });

  it("fails closed for an unknown or mismatched profile", async () => {
    const unknownRequest = new NextRequest(
      "https://leadflow-review.web.app/api/google/connect",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ businessId: "rosser_gallery" }),
      }
    );
    const unknownResponse = await POST(unknownRequest, {} as never);
    expect(unknownResponse.status).toBe(400);

    const mismatchRequest = new NextRequest(
      "https://leadflow-review.web.app/api/google/connect",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          businessId: "rt_solutions",
          profileId: "rosser_gallery_work",
        }),
      }
    );
    const mismatchResponse = await POST(mismatchRequest, {} as never);
    expect(mismatchResponse.status).toBe(400);
    expect(stateSetMock).not.toHaveBeenCalled();
    expect(getGoogleAuthUrlMock).not.toHaveBeenCalled();
  });

  it("rejects a protocol-relative return path", async () => {
    const request = new NextRequest("https://leadflow-review.web.app/api/google/connect", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ returnTo: "//example.invalid/steal" }),
    });

    const response = await POST(request, {} as never);
    expect(response.status).toBe(400);
    expect(stateSetMock).not.toHaveBeenCalled();
  });
});
