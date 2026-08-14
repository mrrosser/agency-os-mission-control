import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  resolveGoogleAccountTokensMock,
  persistGoogleAccountTokensMock,
  persistGoogleAccountTokenFailureMock,
  oauthClientMock,
  getAccessTokenMock,
  setCredentialsMock,
  getAdminDbMock,
  legacyGetMock,
} = vi.hoisted(() => {
  const getAccessTokenMock = vi.fn();
  const setCredentialsMock = vi.fn();
  const client = {
    credentials: {
      access_token: "refreshed-access-token",
      refresh_token: null,
      expiry_date: 9999999999999,
      scope: "gmail calendar drive",
      token_type: "Bearer",
    },
    getAccessToken: getAccessTokenMock,
    setCredentials: setCredentialsMock,
  };
  return {
    resolveGoogleAccountTokensMock: vi.fn(),
    persistGoogleAccountTokensMock: vi.fn(),
    persistGoogleAccountTokenFailureMock: vi.fn(),
    oauthClientMock: vi.fn(() => client),
    getAccessTokenMock,
    setCredentialsMock,
    getAdminDbMock: vi.fn(),
    legacyGetMock: vi.fn(),
  };
});

vi.mock("googleapis", () => ({
  google: { auth: { OAuth2: oauthClientMock } },
}));

vi.mock("@/lib/firebase-admin", () => ({
  getAdminDb: getAdminDbMock,
}));

vi.mock("@/lib/google/account-token-store", () => ({
  resolveGoogleAccountTokens: resolveGoogleAccountTokensMock,
  persistGoogleAccountTokens: persistGoogleAccountTokensMock,
  persistGoogleAccountTokenFailure: persistGoogleAccountTokenFailureMock,
}));

import { getAccessTokenForUser } from "@/lib/google/oauth";

describe("getAccessTokenForUser with schema-v2 Google accounts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GOOGLE_OAUTH_CLIENT_ID = "client-id";
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = "client-secret";
    process.env.GOOGLE_OAUTH_REDIRECT_URI =
      "https://leadflow-review.web.app/api/google/callback";
    delete process.env.MISSION_CONTROL_PUBLIC_ORIGIN;
    getAccessTokenMock.mockResolvedValue({ token: "refreshed-access-token" });
    persistGoogleAccountTokensMock.mockResolvedValue(undefined);
    persistGoogleAccountTokenFailureMock.mockResolvedValue(undefined);
    resolveGoogleAccountTokensMock.mockResolvedValue({
      registryFound: false,
      profileMapped: false,
      record: null,
    });
    getAdminDbMock.mockReturnValue({
      collection: vi.fn(() => ({
        doc: vi.fn(() => ({ get: legacyGetMock })),
      })),
    });
  });

  it("uses a healthy work-profile token without reading the legacy root token", async () => {
    resolveGoogleAccountTokensMock.mockResolvedValue({
      registryFound: true,
      profileMapped: true,
      record: {
        accountId: "rt-account",
        profileId: "rt_solutions_work",
        tokens: {
          accessToken: "stored-access-token",
          refreshToken: "stored-refresh-token",
          accountEmail: "sender@example.com",
          expiryDate: Date.now() + 3_600_000,
        },
      },
    });

    const token = await getAccessTokenForUser("uid-1", undefined, {
      profileId: "rt_solutions_work",
    });

    expect(token).toBe("stored-access-token");
    expect(getAdminDbMock).not.toHaveBeenCalled();
    expect(oauthClientMock).not.toHaveBeenCalled();
    expect(persistGoogleAccountTokensMock).not.toHaveBeenCalled();
  });

  it("keeps only genuinely pre-v2 no-profile callers on the transitional legacy path", async () => {
    legacyGetMock.mockResolvedValue({
      exists: true,
      data: () => ({
        accessToken: "legacy-access-token",
        refreshToken: "legacy-refresh-token",
        expiryDate: Date.now() + 3_600_000,
      }),
    });

    const token = await getAccessTokenForUser("uid-1");

    expect(token).toBe("legacy-access-token");
    expect(resolveGoogleAccountTokensMock).toHaveBeenCalledWith("uid-1", null);
    expect(getAdminDbMock).toHaveBeenCalledOnce();
  });

  it("uses the exact explicit schema-v2 default for a no-profile caller", async () => {
    resolveGoogleAccountTokensMock.mockResolvedValue({
      registryFound: true,
      profileMapped: true,
      record: {
        accountId: "rosser-account",
        profileId: "rosser_gallery_work",
        tokens: {
          accessToken: "rosser-default-access-token",
          refreshToken: "rosser-default-refresh-token",
          expiryDate: Date.now() + 3_600_000,
        },
      },
    });
    legacyGetMock.mockResolvedValue({
      exists: true,
      data: () => ({
        accessToken: "legacy-access-token",
        refreshToken: "legacy-refresh-token",
        expiryDate: Date.now() + 3_600_000,
      }),
    });

    await expect(getAccessTokenForUser("uid-1")).resolves.toBe(
      "rosser-default-access-token"
    );
    expect(resolveGoogleAccountTokensMock).toHaveBeenCalledWith("uid-1", null);
    expect(getAdminDbMock).not.toHaveBeenCalled();
  });

  it("never falls back to valid legacy credentials when schema v2 has no default", async () => {
    resolveGoogleAccountTokensMock.mockResolvedValue({
      registryFound: true,
      profileMapped: false,
      record: null,
    });
    legacyGetMock.mockResolvedValue({
      exists: true,
      data: () => ({
        accessToken: "legacy-access-token",
        refreshToken: "legacy-refresh-token",
        expiryDate: Date.now() + 3_600_000,
      }),
    });

    await expect(getAccessTokenForUser("uid-1")).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining("default Google organization profile"),
    });
    expect(getAdminDbMock).not.toHaveBeenCalled();
    expect(oauthClientMock).not.toHaveBeenCalled();
  });

  it("never falls back to legacy credentials when the explicit default needs reconnecting", async () => {
    resolveGoogleAccountTokensMock.mockResolvedValue({
      registryFound: true,
      profileMapped: true,
      record: null,
    });
    legacyGetMock.mockResolvedValue({
      exists: true,
      data: () => ({
        accessToken: "legacy-access-token",
        refreshToken: "legacy-refresh-token",
        expiryDate: Date.now() + 3_600_000,
      }),
    });

    await expect(getAccessTokenForUser("uid-1")).rejects.toMatchObject({
      status: 403,
      message: expect.stringContaining("default Google organization profile"),
    });
    expect(getAdminDbMock).not.toHaveBeenCalled();
  });

  it("refreshes an expired profile token back into Secret Manager storage", async () => {
    resolveGoogleAccountTokensMock.mockResolvedValue({
      registryFound: true,
      profileMapped: true,
      record: {
        accountId: "rng-account",
        profileId: "rosser_gallery_work",
        tokens: {
          accessToken: "expired-access-token",
          refreshToken: "stored-refresh-token",
          expiryDate: Date.now() - 1,
          scope: "gmail calendar drive",
          tokenType: "Bearer",
          accountEmail: "sender@example.com",
        },
      },
    });

    const token = await getAccessTokenForUser("uid-1", undefined, {
      profileId: "rosser_gallery_work",
    });

    expect(token).toBe("refreshed-access-token");
    expect(setCredentialsMock).toHaveBeenCalledWith(
      expect.objectContaining({ refresh_token: "stored-refresh-token" })
    );
    expect(persistGoogleAccountTokensMock).toHaveBeenCalledWith(
      "uid-1",
      "rng-account",
      expect.objectContaining({
        accessToken: "refreshed-access-token",
        refreshToken: "stored-refresh-token",
        accountEmail: "sender@example.com",
      })
    );
    expect(getAdminDbMock).not.toHaveBeenCalled();
  });

  it("does not fall back to another account when a requested profile is missing", async () => {
    resolveGoogleAccountTokensMock.mockResolvedValue({
      registryFound: true,
      profileMapped: false,
      record: null,
    });

    await expect(
      getAccessTokenForUser("uid-1", undefined, {
        profileId: "rt_solutions_work",
      })
    ).rejects.toMatchObject({ status: 409 });
    expect(getAdminDbMock).not.toHaveBeenCalled();
  });

  it("marks invalid_grant as reauthentication required", async () => {
    resolveGoogleAccountTokensMock.mockResolvedValue({
      registryFound: true,
      profileMapped: true,
      record: {
        accountId: "rt-account",
        profileId: "rt_solutions_work",
        tokens: {
          accessToken: "expired-access-token",
          refreshToken: "stored-refresh-token",
          expiryDate: Date.now() - 1,
        },
      },
    });
    getAccessTokenMock.mockRejectedValue({
      response: { status: 400, data: { error: "invalid_grant" } },
    });

    await expect(
      getAccessTokenForUser("uid-1", undefined, {
        profileId: "rt_solutions_work",
      })
    ).rejects.toMatchObject({ status: 403 });
    expect(persistGoogleAccountTokenFailureMock).toHaveBeenCalledWith(
      "uid-1",
      "rt-account",
      { reauthRequired: true, code: "invalid_grant" }
    );
  });

  it("fails closed when a requested profile has no schema-v2 registry", async () => {
    resolveGoogleAccountTokensMock.mockResolvedValue({
      registryFound: false,
      profileMapped: false,
      record: null,
    });

    await expect(
      getAccessTokenForUser("uid-1", undefined, {
        profileId: "rt_solutions_work",
      })
    ).rejects.toMatchObject({ status: 409 });
    expect(getAdminDbMock).not.toHaveBeenCalled();
  });

  it("returns a stable 503 and logs a sanitized vault resolution failure", async () => {
    const secretBearingError = Object.assign(
      new Error("refresh_token=do-not-log Bearer do-not-log"),
      { code: 7, name: "Bearer do-not-log" }
    );
    resolveGoogleAccountTokensMock.mockRejectedValue(secretBearingError);
    const errorLogMock = vi.fn();
    const log = {
      info: vi.fn(),
      warn: vi.fn(),
      error: errorLogMock,
    } as unknown as Parameters<typeof getAccessTokenForUser>[1];

    await expect(
      getAccessTokenForUser("uid-1", log, {
        profileId: "rt_solutions_work",
      })
    ).rejects.toMatchObject({
      status: 503,
      message: "Google account credential vault is unavailable",
    });
    expect(log?.error).toHaveBeenCalledWith(
      "oauth.account_token_resolution_failed",
      expect.objectContaining({
        uid: "uid-1",
        profileId: "rt_solutions_work",
        errorCategory: "credential_vault_unavailable",
        grpcStatus: 7,
      })
    );
    expect(JSON.stringify(errorLogMock.mock.calls)).not.toContain("do-not-log");
    expect(JSON.stringify(errorLogMock.mock.calls)).not.toContain("refresh_token");
    expect(JSON.stringify(errorLogMock.mock.calls)).not.toContain("Bearer");
    expect(getAdminDbMock).not.toHaveBeenCalled();
  });

  it("fails closed when a mapped profile is missing its Secret Manager token", async () => {
    resolveGoogleAccountTokensMock.mockResolvedValue({
      registryFound: true,
      profileMapped: true,
      record: {
        accountId: "rt-account",
        profileId: "rt_solutions_work",
        tokens: null,
      },
    });

    await expect(
      getAccessTokenForUser("uid-1", undefined, {
        profileId: "rt_solutions_work",
      })
    ).rejects.toMatchObject({ status: 403 });
    expect(getAdminDbMock).not.toHaveBeenCalled();
    expect(persistGoogleAccountTokenFailureMock).toHaveBeenCalledWith(
      "uid-1",
      "rt-account",
      { reauthRequired: true, code: "missing_refresh_token" }
    );
  });
});
