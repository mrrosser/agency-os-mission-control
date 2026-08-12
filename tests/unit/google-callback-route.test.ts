import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const {
  deleteMock,
  stateGetMock,
  getAdminDbMock,
  getTokenMock,
  storeGoogleTokensMock,
  storeGoogleProfileTokensMock,
  fetchGoogleAccountEmailMock,
} = vi.hoisted(() => {
  const deleteMock = vi.fn();
  const stateGetMock = vi.fn();
  const stateDocMock = vi.fn(() => ({
    get: stateGetMock,
    delete: deleteMock,
  }));
  const collectionMock = vi.fn(() => ({ doc: stateDocMock }));
  const runTransactionMock = vi.fn(
    async (
      callback: (transaction: {
        get: typeof stateGetMock;
        delete: typeof deleteMock;
      }) => unknown
    ) => callback({ get: stateGetMock, delete: deleteMock })
  );
  const getAdminDbMock = vi.fn(() => ({
    collection: collectionMock,
    runTransaction: runTransactionMock,
  }));
  const getTokenMock = vi.fn();
  const storeGoogleTokensMock = vi.fn();
  const storeGoogleProfileTokensMock = vi.fn();
  const fetchGoogleAccountEmailMock = vi.fn();
  return {
    deleteMock,
    stateGetMock,
    getAdminDbMock,
    getTokenMock,
    storeGoogleTokensMock,
    storeGoogleProfileTokensMock,
    fetchGoogleAccountEmailMock,
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
    storeGoogleProfileTokens: storeGoogleProfileTokensMock,
    fetchGoogleAccountEmail: fetchGoogleAccountEmailMock,
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
        businessId: null,
        profileId: null,
        createdAt: new Date(),
      }),
    });
    deleteMock.mockResolvedValue(undefined);
    storeGoogleTokensMock.mockResolvedValue(undefined);
    storeGoogleProfileTokensMock.mockResolvedValue(undefined);
    fetchGoogleAccountEmailMock.mockResolvedValue("sender@example.com");
  });

  it("preserves the legacy callback and canonical redirect behavior", async () => {
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
    expect(storeGoogleProfileTokensMock).not.toHaveBeenCalled();
    expect(deleteMock).toHaveBeenCalledOnce();
  });

  it("stores tokens in the selected schema-v2 profile and reports that context", async () => {
    stateGetMock.mockResolvedValue({
      exists: true,
      data: () => ({
        uid: "uid-123",
        returnTo: "/dashboard/integrations",
        origin: "https://leadflow-review.web.app",
        correlationId: "corr-rts-1",
        businessId: "rt_solutions",
        profileId: "rt_solutions_work",
        createdAt: new Date(),
      }),
    });
    const request = new NextRequest(
      "https://leadflow-review.web.app/api/google/callback?code=abc123&state=state-1",
      { method: "GET" }
    );

    const response = await GET(request, {} as never);

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://leadflow-review.web.app/dashboard/integrations?google=connected&googleBusiness=rt_solutions&googleProfile=rt_solutions_work"
    );
    expect(storeGoogleProfileTokensMock).toHaveBeenCalledWith(
      "uid-123",
      "rt_solutions_work",
      expect.objectContaining({
        refresh_token: "refresh-token",
        account_email: "sender@example.com",
      }),
      expect.anything()
    );
    expect(fetchGoogleAccountEmailMock).toHaveBeenCalledWith(
      "access-token",
      expect.anything()
    );
    expect(storeGoogleTokensMock).not.toHaveBeenCalled();
    expect(deleteMock.mock.invocationCallOrder[0]).toBeLessThan(
      getTokenMock.mock.invocationCallOrder[0]
    );
  });

  it("fails closed before token exchange when stored context is unknown", async () => {
    stateGetMock.mockResolvedValue({
      exists: true,
      data: () => ({
        uid: "uid-123",
        returnTo: "/dashboard/integrations",
        businessId: "rosser_gallery",
        profileId: "rosser_gallery_work",
        createdAt: new Date(),
      }),
    });
    const request = new NextRequest(
      "https://leadflow-review.web.app/api/google/callback?code=abc123&state=state-1",
      { method: "GET" }
    );

    const response = await GET(request, {} as never);

    expect(response.status).toBe(400);
    expect(getTokenMock).not.toHaveBeenCalled();
    expect(storeGoogleProfileTokensMock).not.toHaveBeenCalled();
    expect(storeGoogleTokensMock).not.toHaveBeenCalled();
  });

  it("does not redirect to a protocol-relative stored return path", async () => {
    stateGetMock.mockResolvedValue({
      exists: true,
      data: () => ({
        uid: "uid-123",
        returnTo: "//example.invalid/steal",
        businessId: null,
        profileId: null,
        createdAt: new Date(),
      }),
    });
    const request = new NextRequest(
      "https://leadflow-review.web.app/api/google/callback?code=abc123&state=state-1",
      { method: "GET" }
    );

    const response = await GET(request, {} as never);
    expect(response.headers.get("location")).toBe(
      "https://leadflow-review.web.app/dashboard/integrations"
    );
  });

  it("consumes and rejects an expired OAuth state before token exchange", async () => {
    stateGetMock.mockResolvedValue({
      exists: true,
      data: () => ({
        uid: "uid-123",
        returnTo: "/dashboard/crm",
        businessId: "rt_solutions",
        profileId: "rt_solutions_work",
        createdAt: new Date(Date.now() - 11 * 60 * 1000),
      }),
    });
    const request = new NextRequest(
      "https://leadflow-review.web.app/api/google/callback?code=abc123&state=state-1",
      { method: "GET" }
    );

    const response = await GET(request, {} as never);

    expect(response.status).toBe(400);
    expect(deleteMock).toHaveBeenCalledOnce();
    expect(getTokenMock).not.toHaveBeenCalled();
    expect(storeGoogleProfileTokensMock).not.toHaveBeenCalled();
  });

  it("atomically consumes error callbacks and never reflects provider descriptions", async () => {
    stateGetMock
      .mockResolvedValueOnce({
        exists: true,
        data: () => ({
          uid: "uid-123",
          returnTo: "/dashboard/integrations",
          businessId: "rt_solutions",
          profileId: "rt_solutions_work",
          createdAt: new Date(),
        }),
      })
      .mockResolvedValueOnce({ exists: false, data: () => undefined });
    const url =
      "https://leadflow-review.web.app/api/google/callback?error=access_denied" +
      "&error_description=Bearer%20secret-value&state=state-error";

    const first = await GET(new NextRequest(url, { method: "GET" }), {} as never);
    const second = await GET(new NextRequest(url, { method: "GET" }), {} as never);

    expect(first.status).toBe(307);
    expect(first.headers.get("location")).toContain("googleError=access_denied");
    expect(first.headers.get("location")).not.toContain("secret-value");
    expect(first.headers.get("location")).not.toContain("googleErrorDescription");
    expect(second.status).toBe(307);
    expect(deleteMock).toHaveBeenCalledOnce();
    expect(getTokenMock).not.toHaveBeenCalled();
  });

  it("rejects a broader grant for the dedicated Gmail-send profile", async () => {
    stateGetMock.mockResolvedValue({
      exists: true,
      data: () => ({
        uid: "uid-123",
        returnTo: "/dashboard/crm",
        businessId: "rt_solutions",
        profileId: "rt_solutions_work",
        scopePreset: "gmail_send",
        createdAt: new Date(),
      }),
    });
    getTokenMock.mockResolvedValue({
      tokens: {
        access_token: "access-token",
        refresh_token: "refresh-token",
        scope:
          "https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly",
      },
    });

    const response = await GET(
      new NextRequest(
        "https://leadflow-review.web.app/api/google/callback?code=abc123&state=state-1",
        { method: "GET" }
      ),
      {} as never
    );

    expect(response.status).toBe(400);
    expect(deleteMock).toHaveBeenCalledOnce();
    expect(storeGoogleProfileTokensMock).not.toHaveBeenCalled();
  });
});
