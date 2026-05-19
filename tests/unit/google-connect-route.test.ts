import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const {
  setMock,
  getAdminDbMock,
  requireFirebaseAuthMock,
  getGoogleAuthUrlMock,
} = vi.hoisted(() => {
  const setMock = vi.fn();
  const docMock = vi.fn(() => ({ set: setMock }));
  const collectionMock = vi.fn(() => ({ doc: docMock }));
  const getAdminDbMock = vi.fn(() => ({ collection: collectionMock }));
  const requireFirebaseAuthMock = vi.fn();
  const getGoogleAuthUrlMock = vi.fn();
  return {
    setMock,
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
  });

  it("stores canonical origin and workspace metadata for OAuth state", async () => {
    const request = new NextRequest("https://leadflow-review.web.app/api/google/connect", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        returnTo: "/dashboard/integrations?tab=google",
        scopePreset: "drive",
        workspaceId: "workspace-1",
        businessId: "business-1",
        correlationId: "corr-1",
      }),
    });

    const response = await POST(request, {} as never);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      authUrl: "https://accounts.google.com/o/oauth2/auth",
    });

    expect(setMock).toHaveBeenCalledOnce();
    expect(setMock.mock.calls[0]?.[0]).toMatchObject({
      uid: "uid-123",
      returnTo: "/dashboard/integrations?tab=google",
      origin: "https://leadflow-review.web.app",
      scopePreset: "drive",
      workspaceId: "workspace-1",
      businessId: "business-1",
      correlationId: "corr-1",
    });
  });
});
