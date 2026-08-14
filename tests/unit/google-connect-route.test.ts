import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const {
  transactionGetMock,
  transactionCreateMock,
  transactionSetMock,
  transactionDeleteMock,
  runTransactionMock,
  getAdminDbMock,
  requireFirebaseAuthMock,
  getGoogleAuthUrlMock,
} = vi.hoisted(() => {
  const transactionGetMock = vi.fn();
  const transactionCreateMock = vi.fn();
  const transactionSetMock = vi.fn();
  const transactionDeleteMock = vi.fn();
  const runTransactionMock = vi.fn(async (callback: (transaction: {
    get: typeof transactionGetMock;
    create: typeof transactionCreateMock;
    set: typeof transactionSetMock;
    delete: typeof transactionDeleteMock;
  }) => unknown) => callback({
    get: transactionGetMock,
    create: transactionCreateMock,
    set: transactionSetMock,
    delete: transactionDeleteMock,
  }));
  const getAdminDbMock = vi.fn(() => ({
    collection: vi.fn((collection: string) => ({
      doc: vi.fn((id: string) => ({ collection, id })),
    })),
    runTransaction: runTransactionMock,
  }));
  return {
    transactionGetMock,
    transactionCreateMock,
    transactionSetMock,
    transactionDeleteMock,
    runTransactionMock,
    getAdminDbMock,
    requireFirebaseAuthMock: vi.fn(),
    getGoogleAuthUrlMock: vi.fn(),
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
  return { ...actual, getGoogleAuthUrl: getGoogleAuthUrlMock };
});

import { POST } from "@/app/api/google/connect/route";

function connectRequest(body: Record<string, unknown>, url = "https://leadflow-review.web.app/api/google/connect") {
  return new NextRequest(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("google connect route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.MISSION_CONTROL_PUBLIC_ORIGIN = "https://leadflow-review.web.app";
    requireFirebaseAuthMock.mockResolvedValue({
      uid: "uid-123",
      email: "user@example.com",
    });
    getGoogleAuthUrlMock.mockReturnValue("https://accounts.google.com/o/oauth2/auth");
    transactionGetMock.mockResolvedValue({
      exists: false,
      data: () => undefined,
    });
  });

  it("creates a browser-bound latest-attempt state for the exact organization profile", async () => {
    const response = await POST(connectRequest({
      returnTo: "/dashboard/integrations?tab=google",
      scopePreset: "drive",
      workspaceId: "workspace-1",
      businessId: "rt_solutions",
      profileId: "rt_solutions_work",
      correlationId: "corr-1",
    }), {} as never);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      authUrl: "https://accounts.google.com/o/oauth2/auth",
      businessId: "rt_solutions",
      profileId: "rt_solutions_work",
    });
    expect(runTransactionMock).toHaveBeenCalledOnce();
    expect(transactionCreateMock).toHaveBeenCalledOnce();
    const stateRef = transactionCreateMock.mock.calls[0]?.[0];
    const stateData = transactionCreateMock.mock.calls[0]?.[1];
    expect(stateRef).toMatchObject({ collection: "google_oauth_state" });
    expect(stateRef.id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(stateData).toMatchObject({
      uid: "uid-123",
      returnTo: "/dashboard/integrations?tab=google",
      origin: "https://leadflow-review.web.app",
      scopePreset: "drive",
      workspaceId: "workspace-1",
      businessId: "rt_solutions",
      profileId: "rt_solutions_work",
      correlationId: "corr-1",
    });
    expect(stateData.codeChallenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(stateData.attemptDocumentId).toMatch(/^[a-f0-9]{64}$/);
    expect(transactionSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: "google_oauth_connect_attempts",
        id: stateData.attemptDocumentId,
      }),
      expect.objectContaining({
        uid: "uid-123",
        latestState: stateRef.id,
        status: "pending",
        businessId: "rt_solutions",
        profileId: "rt_solutions_work",
      })
    );
    expect(getGoogleAuthUrlMock).toHaveBeenCalledWith(stateRef.id, {
      scopePreset: "drive",
      codeChallenge: stateData.codeChallenge,
    });
    expect(response.headers.get("set-cookie")).toMatch(
      /__Host-mc-google-oauth-[0-9a-f]+=[A-Za-z0-9_-]{43}/i
    );
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(response.headers.get("set-cookie")).toContain("Secure");
    expect(response.headers.get("set-cookie")).toContain("SameSite=lax");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  });

  it("accepts the bounded Gmail-send preset", async () => {
    const response = await POST(connectRequest({
      returnTo: "/dashboard/crm",
      scopePreset: "gmail_send",
      businessId: "rosser_nft_gallery",
      profileId: "rosser_gallery_work",
    }), {} as never);

    expect(response.status).toBe(200);
    expect(getGoogleAuthUrlMock).toHaveBeenCalledWith(expect.any(String), {
      scopePreset: "gmail_send",
      codeChallenge: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
    });
  });

  it("deletes the prior state when a newer attempt supersedes it", async () => {
    const previousState = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    transactionGetMock.mockResolvedValue({
      exists: true,
      data: () => ({ latestState: previousState }),
    });

    const response = await POST(connectRequest({
      scopePreset: "calendar",
      businessId: "rt_solutions",
      profileId: "rt_solutions_work",
    }), {} as never);

    expect(response.status).toBe(200);
    expect(transactionDeleteMock).toHaveBeenCalledOnce();
    expect(transactionDeleteMock).toHaveBeenCalledWith({
      collection: "google_oauth_state",
      id: previousState,
    });
    const newState = transactionCreateMock.mock.calls[0]?.[0]?.id;
    expect(newState).not.toBe(previousState);
    expect(transactionSetMock).toHaveBeenCalledWith(
      expect.objectContaining({ collection: "google_oauth_connect_attempts" }),
      expect.objectContaining({ latestState: newState })
    );
  });

  it("rejects a newer connect while the exact profile callback is processing", async () => {
    transactionGetMock.mockResolvedValue({
      exists: true,
      data: () => ({
        latestState: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        status: "processing",
        expiresAt: { toMillis: () => Date.now() - 1_000 },
        processingExpiresAt: { toMillis: () => Date.now() + 19 * 60 * 1_000 },
      }),
    });

    const response = await POST(connectRequest({
      scopePreset: "gmail_send",
      businessId: "rt_solutions",
      profileId: "rt_solutions_work",
    }), {} as never);

    expect(response.status).toBe(409);
    expect(transactionCreateMock).not.toHaveBeenCalled();
    expect(transactionSetMock).not.toHaveBeenCalled();
    expect(getGoogleAuthUrlMock).not.toHaveBeenCalled();
  });

  it("requires an explicit bounded scope preset before creating state", async () => {
    const response = await POST(connectRequest({
      businessId: "rt_solutions",
      profileId: "rt_solutions_work",
    }), {} as never);

    expect(response.status).toBe(400);
    expect(runTransactionMock).not.toHaveBeenCalled();
    expect(getGoogleAuthUrlMock).not.toHaveBeenCalled();
  });

  it("rejects the legacy no-context connection path before writing state", async () => {
    const response = await POST(connectRequest({ scopePreset: "core" }), {} as never);
    expect(response.status).toBe(400);
    expect(runTransactionMock).not.toHaveBeenCalled();
    expect(getGoogleAuthUrlMock).not.toHaveBeenCalled();
  });

  it("fails closed for an unknown or mismatched profile", async () => {
    const response = await POST(connectRequest({
      scopePreset: "core",
      businessId: "rt_solutions",
      profileId: "rosser_gallery_work",
    }), {} as never);
    expect(response.status).toBe(400);
    expect(runTransactionMock).not.toHaveBeenCalled();
  });

  it("fails closed when the runtime exposes only a bind-all origin", async () => {
    delete process.env.MISSION_CONTROL_PUBLIC_ORIGIN;
    const response = await POST(connectRequest({
      scopePreset: "core",
      businessId: "rt_solutions",
      profileId: "rt_solutions_work",
    }, "https://0.0.0.0:8080/api/google/connect"), {} as never);
    expect(response.status).toBe(503);
    expect(runTransactionMock).not.toHaveBeenCalled();
  });

  it("rejects query parameters, non-JSON, and oversized bodies before state creation", async () => {
    const queryResponse = await POST(connectRequest({
      scopePreset: "core",
      businessId: "rt_solutions",
      profileId: "rt_solutions_work",
    }, "https://leadflow-review.web.app/api/google/connect?scope=gmail"), {} as never);
    const typeResponse = await POST(new NextRequest(
      "https://leadflow-review.web.app/api/google/connect",
      { method: "POST", headers: { "content-type": "text/plain" }, body: "{}" }
    ), {} as never);
    const largeResponse = await POST(connectRequest({
      returnTo: `/${"a".repeat(5_000)}`,
      scopePreset: "core",
      businessId: "rt_solutions",
      profileId: "rt_solutions_work",
    }), {} as never);

    expect(queryResponse.status).toBe(400);
    expect(typeResponse.status).toBe(415);
    expect(largeResponse.status).toBe(413);
    expect(runTransactionMock).not.toHaveBeenCalled();
  });
});
