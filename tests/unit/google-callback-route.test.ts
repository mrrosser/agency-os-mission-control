import { createHash } from "crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const {
  transactionGetMock,
  transactionDeleteMock,
  transactionUpdateMock,
  attemptRecord,
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
import {
  createGoogleOAuthBrowserBinding,
  googleOAuthAttemptDocumentId,
  setGoogleOAuthBrowserCookie,
} from "@/lib/google/oauth-state";

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

function mockRtSendingState(overrides: Record<string, unknown> = {}) {
  const profileId = "rt_solutions_send";
  const businessId = "rt_solutions";
  const attemptDocumentId = createHash("sha256")
    .update(`7:uid-123:${profileId.length}:${profileId}`).digest("hex");
  transactionGetMock.mockImplementation(async (reference: { collection: string }) =>
    reference.collection === "google_oauth_state"
      ? stateSnapshot(stateData({ profileId, businessId, attemptDocumentId, returnTo: "/dashboard/crm", ...overrides }))
      : attemptSnapshot({ profileId, businessId, ...attemptRecord.current })
  );
}

function currentBrowserBinding(state = STATE, existingCookie = "") {
  const binding = createGoogleOAuthBrowserBinding(callbackRequest("", existingCookie), state);
  const response = NextResponse.json({ ok: true });
  setGoogleOAuthBrowserCookie(response, binding.browserSecret);
  const cookie = response.cookies.get("__session")!;
  return { ...binding, cookie: `${cookie.name}=${cookie.value}` };
}

function mockStoredAttempts(entries: Array<{ state: string; data: ReturnType<typeof stateData> }>) {
  const states = new Map(entries.map(({ state, data }) => [state, data]));
  const attempts = new Map<string, Record<string, unknown>>();
  for (const { state, data } of entries) {
    attempts.set(data.attemptDocumentId, {
      uid: data.uid, businessId: data.businessId, profileId: data.profileId,
      latestState: state, status: "pending",
    });
  }
  transactionGetMock.mockImplementation(async (reference: { collection: string; id: string }) => {
    const value = reference.collection === "google_oauth_state"
      ? states.get(reference.id) : attempts.get(reference.id);
    return { exists: value !== undefined, data: () => value };
  });
  transactionUpdateMock.mockImplementation((reference: { id: string }, update: Record<string, unknown>) => {
    Object.assign(attempts.get(reference.id)!, update);
  });
  transactionDeleteMock.mockImplementation((reference: { collection: string; id: string }) => {
    if (reference.collection === "google_oauth_state") states.delete(reference.id);
    else attempts.delete(reference.id);
  });
  return { states, attempts };
}

describe("google callback route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    transactionDeleteMock.mockReset();
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

  it.each([
    ["mrosser@rossergallery.com", true],
    ["mrosser@rossernftgallery.com", false],
    ["personal@example.com", false],
  ])("pins dedicated Gallery sending to the confirmed Google identity: %s", async (email, allowed) => {
    const profileId = "rosser_gallery_send";
    const businessId = "rosser_nft_gallery";
    const attemptDocumentId = createHash("sha256")
      .update(`7:uid-123:${profileId.length}:${profileId}`).digest("hex");
    transactionGetMock.mockImplementation(async (reference: { collection: string }) =>
      reference.collection === "google_oauth_state"
        ? stateSnapshot(stateData({ profileId, businessId, attemptDocumentId, returnTo: "/dashboard/crm" }))
        : attemptSnapshot({ profileId, businessId, ...attemptRecord.current })
    );
    fetchGoogleAccountIdentityMock.mockResolvedValue({ email, subject: "gallery-subject" });
    const response = await GET(callbackRequest(`code=abc123&state=${STATE}`), {} as never);
    expect(response.status).toBe(303);
    if (allowed) {
      expect(response.headers.get("location")).toContain("google=connected");
      expect(storeGoogleProfileTokensMock).toHaveBeenCalledWith(
        "uid-123", profileId,
        expect.objectContaining({ account_email: email, account_subject: "gallery-subject", scope: LIVE_SCOPE }),
        "gmail_send", expect.anything()
      );
    } else {
      expect(response.headers.get("location")).toContain("googleError=sending_account_mismatch");
      expect(storeGoogleProfileTokensMock).not.toHaveBeenCalled();
    }
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

  it.each([
    ["mrosser@rt.solutions", true],
    ["mrosser@rossergallery.com", false],
    ["personal@example.com", false],
  ])("pins RT sending to the confirmed Google identity: %s", async (email, allowed) => {
    mockRtSendingState();
    fetchGoogleAccountIdentityMock.mockResolvedValue({ email, subject: "rt-sending-subject" });
    const response = await GET(callbackRequest(`code=abc123&state=${STATE}`), {} as never);
    const location = new URL(response.headers.get("location")!);
    expect(response.status).toBe(303);
    expect(location.pathname).toBe("/dashboard/crm");
    expect(location.searchParams.get("googleBusiness")).toBe("rt_solutions");
    expect(location.searchParams.get("googleProfile")).toBe("rt_solutions_send");
    expect(location.searchParams.has("code")).toBe(false);
    expect(location.searchParams.has("state")).toBe(false);
    if (allowed) {
      expect(location.searchParams.get("google")).toBe("connected");
      expect(storeGoogleProfileTokensMock).toHaveBeenCalledExactlyOnceWith(
        "uid-123", "rt_solutions_send",
        expect.objectContaining({ account_email: email, account_subject: "rt-sending-subject", scope: LIVE_SCOPE }),
        "gmail_send", expect.anything()
      );
    } else {
      expect(location.searchParams.get("googleError")).toBe("sending_account_mismatch");
      expect(storeGoogleProfileTokensMock).not.toHaveBeenCalled();
    }
  });

  it.each(["core", "drive", "calendar", "gmail", "full"])(
    "rejects an RT sending callback with the %s preset before storing credentials",
    async (scopePreset) => {
      mockRtSendingState({ scopePreset });
      const response = await GET(callbackRequest(`code=abc123&state=${STATE}`), {} as never);
      expect(response.headers.get("location")).toContain("googleError=scope_not_allowed");
      expect(fetchGoogleAccountIdentityMock).not.toHaveBeenCalled();
      expect(storeGoogleProfileTokensMock).not.toHaveBeenCalled();
    }
  );

  it("rejects broader grants for RT sending without accessing identity or storage", async () => {
    mockRtSendingState();
    getTokenMock.mockResolvedValue({
      tokens: {
        access_token: "access-token", refresh_token: "refresh-token",
        scope: `${LIVE_SCOPE} https://www.googleapis.com/auth/drive.file`,
      },
    });
    const response = await GET(callbackRequest(`code=abc123&state=${STATE}`), {} as never);
    expect(response.headers.get("location")).toContain("googleError=scope_not_allowed");
    expect(fetchGoogleAccountIdentityMock).not.toHaveBeenCalled();
    expect(storeGoogleProfileTokensMock).not.toHaveBeenCalled();
  });

  it("rejects mismatched RT sending state without reflecting unvalidated profile context", async () => {
    mockRtSendingState({ businessId: "rosser_nft_gallery" });
    const response = await GET(callbackRequest(`code=abc123&state=${STATE}`), {} as never);
    const location = new URL(response.headers.get("location")!);
    expect(location.searchParams.get("googleError")).toBe("connection_session_invalid");
    expect(location.searchParams.has("googleBusiness")).toBe(false);
    expect(location.searchParams.has("googleProfile")).toBe(false);
    expect(getTokenMock).not.toHaveBeenCalled();
    expect(storeGoogleProfileTokensMock).not.toHaveBeenCalled();
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

  it("finishes an older legacy attempt without overwriting a newer profile's browser anchor", async () => {
    const current = currentBrowserBinding("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
    const response = await GET(callbackRequest(`code=legacy-code&state=${STATE}`, `${current.cookie}; ${COOKIE_NAME}=${VERIFIER}`), {} as never);
    expect(response.headers.get("location")).toContain("google=connected");
    expect(getTokenMock).toHaveBeenCalledExactlyOnceWith({ code: "legacy-code", codeVerifier: VERIFIER });
    expect(storeGoogleProfileTokensMock).toHaveBeenCalledTimes(1);
    expect(response.cookies.get("__session")).toBeUndefined();
  });

  it.each(["scoped-first", "root-first"])(
    "exchanges the current browser-bound verifier alongside a framework cookie (%s)", async (order) => {
      const binding = currentBrowserBinding();
      const cookies = [binding.cookie, "__session=synthetic.firebase.jwt"];
      if (order === "root-first") cookies.reverse();
      mockStoredAttempts([{ state: STATE, data: stateData({ codeChallenge: binding.challenge }) }]);

      const response = await GET(callbackRequest(`code=current-code&state=${STATE}`, cookies.join("; ")), {} as never);

      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toContain("google=connected");
      expect(getTokenMock).toHaveBeenCalledExactlyOnceWith({ code: "current-code", codeVerifier: binding.verifier });
      expect(storeGoogleProfileTokensMock).toHaveBeenCalledTimes(1);
      expect(response.cookies.get("__session")).toBeUndefined();
      expect(response.headers.get("location")).not.toContain(binding.browserSecret);
      expect(response.headers.get("location")).not.toContain(binding.verifier);
    }
  );

  it.each(["missing", "wrong-browser", "wrong-state", "malformed", "duplicate", "oversized"])(
    "rejects a %s current binding before exchange or consuming state", async (kind) => {
      const binding = currentBrowserBinding();
      const other = currentBrowserBinding("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
      let cookie = binding.cookie;
      if (kind === "missing") cookie = "__session=synthetic.firebase.jwt";
      if (kind === "wrong-browser") cookie = other.cookie;
      if (kind === "malformed") cookie = "__session=mc-google-oauth-v1.short";
      if (kind === "duplicate") cookie += `; ${binding.cookie}`;
      if (kind === "oversized") cookie += `; extra=${"x".repeat(16_384)}`;
      const wrongStateBinding = currentBrowserBinding("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", binding.cookie);
      mockStoredAttempts([{ state: STATE, data: stateData({
        codeChallenge: kind === "wrong-state" ? wrongStateBinding.challenge : binding.challenge,
      }) }]);

      const response = await GET(callbackRequest(`code=current-code&state=${STATE}`, cookie), {} as never);

      expect(response.headers.get("location")).toContain("googleError=connection_session_invalid");
      expect(getTokenMock).not.toHaveBeenCalled();
      expect(storeGoogleProfileTokensMock).not.toHaveBeenCalled();
      expect(transactionDeleteMock).not.toHaveBeenCalled();
      expect(transactionUpdateMock).not.toHaveBeenCalled();
      expect(response.cookies.get("__session")).toBeUndefined();
    }
  );

  it.each(["expired", "stale-created", "missing-state"])(
    "does not let a retained browser cookie revive %s server state", async (kind) => {
      const binding = currentBrowserBinding();
      const overrides: Record<string, unknown> = { codeChallenge: binding.challenge };
      if (kind === "expired") overrides.expiresAt = new Date(Date.now() - 1_000);
      if (kind === "stale-created") {
        overrides.createdAt = new Date(Date.now() - 11 * 60_000);
        overrides.expiresAt = new Date(Date.now() + 60_000);
      }
      mockStoredAttempts(kind === "missing-state" ? [] : [{ state: STATE, data: stateData(overrides) }]);

      const response = await GET(callbackRequest(`code=current-code&state=${STATE}`, binding.cookie), {} as never);

      expect(response.headers.get("location")).toContain("googleError=connection_session_invalid");
      expect(getTokenMock).not.toHaveBeenCalled();
      expect(transactionDeleteMock).not.toHaveBeenCalled();
      expect(response.cookies.get("__session")).toBeUndefined();
    }
  );

  it("rejects a superseded callback without disrupting its replacement, then rejects replay", async () => {
    const newerState = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const older = currentBrowserBinding();
    const newer = currentBrowserBinding(newerState, older.cookie);
    const stored = mockStoredAttempts([
      { state: STATE, data: stateData({ codeChallenge: older.challenge }) },
      { state: newerState, data: stateData({ codeChallenge: newer.challenge }) },
    ]);

    const rejected = await GET(callbackRequest(`code=older-code&state=${STATE}`, newer.cookie), {} as never);
    expect(rejected.headers.get("location")).toContain("googleError=connection_superseded");
    expect(rejected.cookies.get("__session")).toBeUndefined();
    expect(getTokenMock).not.toHaveBeenCalled();
    expect(transactionDeleteMock).not.toHaveBeenCalled();
    expect(stored.states.has(newerState)).toBe(true);

    const accepted = await GET(callbackRequest(`code=newer-code&state=${newerState}`, newer.cookie), {} as never);
    expect(accepted.headers.get("location")).toContain("google=connected");
    expect(accepted.cookies.get("__session")).toBeUndefined();
    const replay = await GET(callbackRequest(`code=newer-code&state=${newerState}`, newer.cookie), {} as never);
    expect(replay.headers.get("location")).toContain("googleError=connection_session_invalid");
    expect(getTokenMock).toHaveBeenCalledExactlyOnceWith({ code: "newer-code", codeVerifier: newer.verifier });
    expect(storeGoogleProfileTokensMock).toHaveBeenCalledTimes(1);
  });

  it("supports repeated sending-profile callbacks out of order without clearing their shared cookie", async () => {
    const browser = currentBrowserBinding();
    const states = [
      [STATE, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"],
      ["cccccccc-cccc-4ccc-8ccc-cccccccccccc", "dddddddd-dddd-4ddd-8ddd-dddddddddddd"],
    ];
    const profiles = [
      { businessId: "rt_solutions", profileId: "rt_solutions_send", email: "mrosser@rt.solutions" },
      { businessId: "rosser_nft_gallery", profileId: "rosser_gallery_send", email: "mrosser@rossergallery.com" },
    ];
    for (const round of states) {
      const bindings = round.map((state) => currentBrowserBinding(state, browser.cookie));
      mockStoredAttempts(round.map((state, index) => ({
        state,
        data: stateData({
          businessId: profiles[index].businessId, profileId: profiles[index].profileId,
          attemptDocumentId: googleOAuthAttemptDocumentId("uid-123", profiles[index].profileId),
          codeChallenge: bindings[index].challenge,
        }),
      })));
      for (const index of [1, 0]) {
        fetchGoogleAccountIdentityMock.mockResolvedValueOnce({ email: profiles[index].email, subject: `subject-${index}` });
        const response = await GET(callbackRequest(`code=code-${round[index]}&state=${round[index]}`, browser.cookie), {} as never);
        expect(response.headers.get("location")).toContain("google=connected");
        expect(response.headers.get("location")).toContain(`googleProfile=${profiles[index].profileId}`);
        expect(response.cookies.get("__session")).toBeUndefined();
        expect(getTokenMock).toHaveBeenLastCalledWith({ code: `code-${round[index]}`, codeVerifier: bindings[index].verifier });
        expect(bindings[index].browserSecret).toBe(browser.browserSecret);
      }
    }
    expect(getTokenMock).toHaveBeenCalledTimes(4);
    expect(storeGoogleProfileTokensMock).toHaveBeenCalledTimes(4);
  });

  it("never exchanges the losing first-bootstrap callback and accepts the surviving profile", async () => {
    const otherState = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const first = currentBrowserBinding();
    const second = currentBrowserBinding(otherState);
    const otherProfile = "rosser_gallery_work";
    mockStoredAttempts([
      { state: STATE, data: stateData({ codeChallenge: first.challenge }) },
      { state: otherState, data: stateData({
        businessId: "rosser_nft_gallery", profileId: otherProfile,
        attemptDocumentId: googleOAuthAttemptDocumentId("uid-123", otherProfile),
        codeChallenge: second.challenge,
      }) },
    ]);
    const rejected = await GET(callbackRequest(`code=losing-code&state=${STATE}`, second.cookie), {} as never);
    expect(rejected.headers.get("location")).toContain("googleError=connection_session_invalid");
    expect(getTokenMock).not.toHaveBeenCalled();
    expect(transactionDeleteMock).not.toHaveBeenCalled();
    expect(rejected.cookies.get("__session")).toBeUndefined();

    const accepted = await GET(callbackRequest(`code=surviving-code&state=${otherState}`, second.cookie), {} as never);
    expect(accepted.headers.get("location")).toContain("google=connected");
    expect(getTokenMock).toHaveBeenCalledExactlyOnceWith({ code: "surviving-code", codeVerifier: second.verifier });
  });
});
