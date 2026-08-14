import { createHash } from "crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const {
  transactionGetMock,
  transactionDeleteMock,
  transactionUpdateMock,
  attemptRecord,
  runTransactionMock,
  getAdminDbMock,
  getTokenMock,
  getTokenInfoMock,
  getOAuthClientMock,
  storeGoogleProfileTokensMock,
  fetchGoogleAccountIdentityMock,
} = vi.hoisted(() => {
  const transactionGetMock = vi.fn();
  const transactionDeleteMock = vi.fn();
  const transactionUpdateMock = vi.fn();
  const attemptRecord = { current: {} as Record<string, unknown> };
  const runTransactionMock = vi.fn(async (callback: (transaction: {
    get: typeof transactionGetMock;
    delete: typeof transactionDeleteMock;
    update: typeof transactionUpdateMock;
  }) => unknown) => callback({
    get: transactionGetMock,
    delete: transactionDeleteMock,
    update: transactionUpdateMock,
  }));
  const getAdminDbMock = vi.fn(() => ({
    collection: vi.fn((collection: string) => ({
      doc: vi.fn((id: string) => ({ collection, id })),
    })),
    runTransaction: runTransactionMock,
  }));
  return {
    transactionGetMock,
    transactionDeleteMock,
    transactionUpdateMock,
    attemptRecord,
    runTransactionMock,
    getAdminDbMock,
    getTokenMock: vi.fn(),
    getTokenInfoMock: vi.fn(),
    getOAuthClientMock: vi.fn(),
    storeGoogleProfileTokensMock: vi.fn(),
    fetchGoogleAccountIdentityMock: vi.fn(),
  };
});

vi.mock("@/lib/firebase-admin", () => ({ getAdminDb: getAdminDbMock }));

vi.mock("@/lib/google/oauth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/google/oauth")>(
    "@/lib/google/oauth"
  );
  return {
    ...actual,
    getOAuthClient: getOAuthClientMock,
    storeGoogleProfileTokens: storeGoogleProfileTokensMock,
    fetchGoogleAccountIdentity: fetchGoogleAccountIdentityMock,
  };
});

import { GET } from "@/app/api/google/callback/route";
import { GoogleAccountProfileReplacementRequiresDisconnectError } from "@/lib/google/account-token-store";

const STATE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const VERIFIER = "v".repeat(43);
const CHALLENGE = createHash("sha256").update(VERIFIER).digest("base64url");
const ATTEMPT_ID = createHash("sha256")
  .update("7:uid-123:17:rt_solutions_work")
  .digest("hex");
const COOKIE_NAME = `__Host-mc-google-oauth-${STATE.replace(/-/g, "")}`;
const LIVE_SCOPE = [
  "email",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/gmail.send",
  "openid",
].join(" ");

function stateData(overrides: Record<string, unknown> = {}) {
  return {
    uid: "uid-123",
    returnTo: "/dashboard/integrations",
    origin: "https://leadflow-review.web.app",
    correlationId: "corr-rts-1",
    workspaceId: null,
    businessId: "rt_solutions",
    profileId: "rt_solutions_work",
    scopePreset: "gmail_send",
    codeChallenge: CHALLENGE,
    attemptDocumentId: ATTEMPT_ID,
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 9 * 60 * 1_000),
    ...overrides,
  };
}

function stateSnapshot(value = stateData()) {
  return { exists: true, data: () => value };
}

function attemptSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    exists: true,
    data: () => ({
      uid: "uid-123",
      businessId: "rt_solutions",
      profileId: "rt_solutions_work",
      latestState: STATE,
      ...overrides,
    }),
  };
}

function callbackRequest(query: string, cookie = `${COOKIE_NAME}=${VERIFIER}`) {
  return new NextRequest(
    `https://leadflow-review.web.app/api/google/callback?${query}`,
    { method: "GET", headers: cookie ? { cookie } : {} }
  );
}

describe("google callback route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    attemptRecord.current = {};
    process.env.MISSION_CONTROL_PUBLIC_ORIGIN = "https://leadflow-review.web.app";
    transactionGetMock.mockImplementation(async (reference: { collection: string }) =>
      reference.collection === "google_oauth_state"
        ? stateSnapshot()
        : attemptSnapshot(attemptRecord.current)
    );
    transactionUpdateMock.mockImplementation(
      (_reference: unknown, update: Record<string, unknown>) => {
        Object.assign(attemptRecord.current, update);
      }
    );
    getOAuthClientMock.mockReturnValue({
      getToken: getTokenMock,
      getTokenInfo: getTokenInfoMock,
    });
    getTokenMock.mockResolvedValue({
      tokens: {
        access_token: "access-token",
        refresh_token: "refresh-token",
        expiry_date: 123456,
        scope: LIVE_SCOPE,
        token_type: "Bearer",
      },
    });
    getTokenInfoMock.mockResolvedValue({ scopes: LIVE_SCOPE.split(" ") });
    fetchGoogleAccountIdentityMock.mockResolvedValue({
      email: "sender@example.com",
      subject: "google-subject-123",
    });
    storeGoogleProfileTokensMock.mockResolvedValue(undefined);
  });

  it("accepts Google's live Gmail-send alias set and stores the exact profile identity", async () => {
    const response = await GET(
      callbackRequest(`code=abc123&state=${STATE}&scope=${encodeURIComponent(LIVE_SCOPE)}`),
      {} as never
    );

    expect(response.status).toBe(303);
    const location = response.headers.get("location") || "";
    expect(location).toContain("/dashboard/integrations?google=connected");
    expect(location).toContain("googleBusiness=rt_solutions");
    expect(location).toContain("googleProfile=rt_solutions_work");
    expect(location).toContain("googleCorrelation=corr-rts-1");
    expect(location).not.toContain("abc123");
    expect(location).not.toContain(STATE);
    expect(getTokenMock).toHaveBeenCalledWith({
      code: "abc123",
      codeVerifier: VERIFIER,
    });
    expect(storeGoogleProfileTokensMock).toHaveBeenCalledWith(
      "uid-123",
      "rt_solutions_work",
      expect.objectContaining({
        refresh_token: "refresh-token",
        scope: LIVE_SCOPE,
        account_email: "sender@example.com",
        account_subject: "google-subject-123",
      }),
      "gmail_send",
      expect.anything()
    );
    expect(transactionUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({ collection: "google_oauth_connect_attempts" }),
      expect.objectContaining({
        status: "processing",
        processingState: STATE,
        processingExpiresAt: expect.anything(),
        expiresAt: expect.anything(),
      })
    );
    expect(transactionDeleteMock).toHaveBeenCalledTimes(2);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("uses token introspection when the token response omits scopes", async () => {
    getTokenMock.mockResolvedValue({
      tokens: {
        access_token: "access-token",
        refresh_token: "refresh-token",
        scope: null,
      },
    });
    const response = await GET(
      callbackRequest(`code=abc123&state=${STATE}`),
      {} as never
    );
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toContain("google=connected");
    expect(getTokenInfoMock).toHaveBeenCalledWith("access-token");
  });

  it("redirects invalid runtime configuration without exposing callback parameters", async () => {
    getOAuthClientMock.mockImplementationOnce(() => {
      throw new Error("client secret details must stay private");
    });

    const response = await GET(
      callbackRequest(`code=abc123&state=${STATE}`),
      {} as never
    );
    const location = response.headers.get("location") || "";

    expect(response.status).toBe(303);
    expect(location).toContain("google=error");
    expect(location).toContain("googleError=configuration_error");
    expect(location).not.toContain("abc123");
    expect(location).not.toContain(STATE);
    expect(location).not.toContain("client+secret");
    expect(getTokenMock).not.toHaveBeenCalled();
    expect(storeGoogleProfileTokensMock).not.toHaveBeenCalled();
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  });

  it("rejects a missing or wrong browser cookie before exchange or state consumption", async () => {
    const missing = await GET(
      callbackRequest(`code=abc123&state=${STATE}`, ""),
      {} as never
    );
    const wrong = await GET(
      callbackRequest(`code=abc123&state=${STATE}`, `${COOKIE_NAME}=${"x".repeat(43)}`),
      {} as never
    );

    for (const response of [missing, wrong]) {
      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toContain(
        "googleError=connection_session_invalid"
      );
    }
    expect(getTokenMock).not.toHaveBeenCalled();
    expect(storeGoogleProfileTokensMock).not.toHaveBeenCalled();
    expect(transactionDeleteMock).not.toHaveBeenCalled();
  });

  it("rejects an older callback after a newer profile attempt exists", async () => {
    transactionGetMock.mockImplementation(async (reference: { collection: string }) =>
      reference.collection === "google_oauth_state"
        ? stateSnapshot()
        : attemptSnapshot({ latestState: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" })
    );
    const response = await GET(
      callbackRequest(`code=abc123&state=${STATE}`),
      {} as never
    );
    expect(response.headers.get("location")).toContain(
      "googleError=connection_superseded"
    );
    expect(getTokenMock).not.toHaveBeenCalled();
    expect(transactionDeleteMock).not.toHaveBeenCalled();
  });

  it("atomically consumes provider denial and never reflects provider descriptions", async () => {
    const response = await GET(
      callbackRequest(
        `error=access_denied&error_description=${encodeURIComponent("Bearer secret-value")}&state=${STATE}`
      ),
      {} as never
    );
    const location = response.headers.get("location") || "";
    expect(response.status).toBe(303);
    expect(location).toContain("googleError=access_denied");
    expect(location).not.toContain("secret-value");
    expect(location).not.toContain("googleErrorDescription");
    expect(transactionDeleteMock).toHaveBeenCalledTimes(2);
    expect(getTokenMock).not.toHaveBeenCalled();
  });

  it("redirects a broader Gmail grant to trusted scope guidance without storage", async () => {
    getTokenMock.mockResolvedValue({
      tokens: {
        access_token: "access-token",
        refresh_token: "refresh-token",
        scope: `${LIVE_SCOPE} https://www.googleapis.com/auth/gmail.readonly`,
      },
    });
    const response = await GET(
      callbackRequest(`code=abc123&state=${STATE}`),
      {} as never
    );
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toContain(
      "googleError=scope_not_allowed"
    );
    expect(storeGoogleProfileTokensMock).not.toHaveBeenCalled();
  });

  it("gives trusted disconnect-first guidance for a different account on an occupied profile", async () => {
    storeGoogleProfileTokensMock.mockRejectedValueOnce(
      new GoogleAccountProfileReplacementRequiresDisconnectError()
    );

    const response = await GET(
      callbackRequest(`code=abc123&state=${STATE}`),
      {} as never
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toContain(
      "googleError=profile_replacement_requires_disconnect"
    );
  });

  it("rejects expired and malformed state before provider access", async () => {
    transactionGetMock.mockResolvedValueOnce(stateSnapshot(stateData({
      createdAt: new Date(Date.now() - 11 * 60 * 1_000),
      expiresAt: new Date(Date.now() - 60_000),
    })));
    const expired = await GET(
      callbackRequest(`code=abc123&state=${STATE}`),
      {} as never
    );
    const malformed = await GET(
      callbackRequest("code=abc123&state=state-1", ""),
      {} as never
    );
    expect(expired.headers.get("location")).toContain(
      "googleError=connection_session_invalid"
    );
    expect(malformed.headers.get("location")).toContain(
      "googleError=connection_session_invalid"
    );
    expect(getTokenMock).not.toHaveBeenCalled();
    expect(storeGoogleProfileTokensMock).not.toHaveBeenCalled();
  });
});
