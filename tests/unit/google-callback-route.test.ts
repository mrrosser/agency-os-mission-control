import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const {
  deleteMock,
  stateGetMock,
  getAdminDbMock,
  getTokenMock,
  storeGoogleTokensMock,
} = vi.hoisted(() => {
  const deleteMock = vi.fn();
  const stateGetMock = vi.fn();
  const stateDocMock = vi.fn(() => ({
    get: stateGetMock,
    delete: deleteMock,
  }));
  const collectionMock = vi.fn(() => ({ doc: stateDocMock }));
  const getAdminDbMock = vi.fn(() => ({ collection: collectionMock }));
  const getTokenMock = vi.fn();
  const storeGoogleTokensMock = vi.fn();
  return {
    deleteMock,
    stateGetMock,
    getAdminDbMock,
    getTokenMock,
    storeGoogleTokensMock,
  };
});

vi.mock("@/lib/firebase-admin", () => ({
  getAdminDb: getAdminDbMock,
}));

vi.mock("@/lib/google/oauth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/google/oauth")>(
    "@/lib/google/oauth"
  );
  return {
    ...actual,
    getOAuthClient: () => ({
      getToken: getTokenMock,
    }),
    storeGoogleTokens: storeGoogleTokensMock,
  };
});

import { GET } from "@/app/api/google/callback/route";

describe("google callback route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.MISSION_CONTROL_PUBLIC_ORIGIN = "https://leadflow-review.web.app";
    getTokenMock.mockResolvedValue({
      tokens: {
        access_token: "access-token",
        refresh_token: "refresh-token",
        expiry_date: 123456,
        scope: "scope",
        token_type: "Bearer",
      },
    });
    stateGetMock.mockResolvedValue({
      exists: true,
      data: () => ({
        uid: "uid-123",
        returnTo: "/dashboard/integrations",
        origin: "http://localhost:3000",
        correlationId: "corr-1",
      }),
    });
    storeGoogleTokensMock.mockResolvedValue(undefined);
  });

  it("redirects to the canonical origin even when the stored state origin is localhost", async () => {
    const request = new NextRequest(
      "https://leadflow-review.web.app/api/google/callback?code=abc123&state=state-1",
      { method: "GET" }
    );

    const response = await GET(request, {} as never);

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://leadflow-review.web.app/dashboard/integrations"
    );
    expect(getTokenMock).toHaveBeenCalledWith("abc123");
    expect(storeGoogleTokensMock).toHaveBeenCalledOnce();
    expect(deleteMock).toHaveBeenCalledOnce();
  });
});
