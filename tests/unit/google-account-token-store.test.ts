import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  registryGetMock,
  bindingGetMock,
  accountGetMock,
  accountSetMock,
  accessUserSecretMock,
  setUserSecretMock,
} = vi.hoisted(() => ({
  registryGetMock: vi.fn(),
  bindingGetMock: vi.fn(),
  accountGetMock: vi.fn(),
  accountSetMock: vi.fn(),
  accessUserSecretMock: vi.fn(),
  setUserSecretMock: vi.fn(),
}));

vi.mock("firebase-admin/firestore", () => ({
  FieldValue: { serverTimestamp: vi.fn(() => "server-timestamp") },
}));

vi.mock("@/lib/secret-manager", () => ({
  accessUserSecret: accessUserSecretMock,
  setUserSecret: setUserSecretMock,
}));

vi.mock("@/lib/firebase-admin", () => {
  const accountRef = { get: accountGetMock, set: accountSetMock };
  const bindingRef = { get: bindingGetMock };
  const registryRef = {
    get: registryGetMock,
    collection: vi.fn((name: string) => ({
      doc: vi.fn(() => (name === "accounts" ? accountRef : bindingRef)),
    })),
  };
  return {
    getAdminDb: vi.fn(() => ({
      collection: vi.fn(() => ({ doc: vi.fn(() => registryRef) })),
    })),
  };
});

import {
  persistGoogleAccountTokenFailure,
  persistGoogleAccountTokens,
  resolveGoogleAccountTokens,
} from "@/lib/google/account-token-store";

describe("Google account token store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    registryGetMock.mockResolvedValue({
      exists: true,
      data: () => ({ schemaVersion: 2, defaultAccountId: "default-account" }),
    });
    bindingGetMock.mockResolvedValue({
      exists: true,
      data: () => ({ accountId: "rt-account" }),
    });
    accountGetMock.mockResolvedValue({
      exists: true,
      data: () => ({ pendingRevocation: false }),
    });
    accessUserSecretMock.mockResolvedValue(JSON.stringify({
      accessToken: "access-token",
      refreshToken: "refresh-token",
      expiryDate: 123456,
      scope: "gmail calendar drive",
      tokenType: "Bearer",
    }));
    accountSetMock.mockResolvedValue(undefined);
    setUserSecretMock.mockResolvedValue(undefined);
  });

  it("resolves a profile binding to its Secret Manager token record", async () => {
    const result = await resolveGoogleAccountTokens("uid-1", "rt_solutions_work");

    expect(result).toMatchObject({
      registryFound: true,
      profileMapped: true,
      record: {
        accountId: "rt-account",
        profileId: "rt_solutions_work",
        tokens: {
          accessToken: "access-token",
          refreshToken: "refresh-token",
        },
      },
    });
    expect(accessUserSecretMock).toHaveBeenCalledWith(
      "uid-1",
      "google-oauth-account-rt-account"
    );
  });

  it("fails closed when a requested profile is not mapped", async () => {
    bindingGetMock.mockResolvedValue({ exists: false, data: () => undefined });

    const result = await resolveGoogleAccountTokens("uid-1", "missing_profile");

    expect(result).toEqual({
      registryFound: true,
      profileMapped: false,
      record: null,
    });
    expect(accessUserSecretMock).not.toHaveBeenCalled();
  });

  it("persists refreshed tokens only to Secret Manager and safe account metadata", async () => {
    await persistGoogleAccountTokens("uid-1", "rt-account", {
      accessToken: "new-access-token",
      refreshToken: "refresh-token",
      expiryDate: 999999,
      scope: "gmail calendar drive",
      tokenType: "Bearer",
    });

    expect(setUserSecretMock).toHaveBeenCalledOnce();
    const stored = JSON.parse(setUserSecretMock.mock.calls[0]?.[2] as string);
    expect(stored).toMatchObject({
      accessToken: "new-access-token",
      refreshToken: "refresh-token",
    });
    expect(accountSetMock).toHaveBeenCalledOnce();
    expect(accountSetMock.mock.calls[0]?.[0]).not.toHaveProperty("accessToken");
    expect(accountSetMock.mock.calls[0]?.[0]).not.toHaveProperty("refreshToken");
    expect(accountSetMock.mock.calls[0]?.[0]).toMatchObject({
      oauthHealthStatus: "healthy",
      lastRefreshStatus: "ok",
    });
  });

  it("records sanitized refresh failures without touching the token secret", async () => {
    await persistGoogleAccountTokenFailure("uid-1", "rt-account", {
      reauthRequired: true,
      code: "invalid grant! with details",
    });

    expect(setUserSecretMock).not.toHaveBeenCalled();
    expect(accountSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        oauthHealthStatus: "reauth_required",
        lastRefreshStatus: "error",
        lastRefreshErrorCode: "invalid_grant__with_details",
        lastRefreshErrorMessage: "Google OAuth refresh requires reconnection.",
      }),
      { merge: true }
    );
  });
});
