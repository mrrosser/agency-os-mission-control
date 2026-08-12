import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  registryGetMock,
  registrySetMock,
  bindingGetMock,
  bindingSetMock,
  accountGetMock,
  accountSetMock,
  accessUserSecretMock,
  setUserSecretMock,
} = vi.hoisted(() => ({
  registryGetMock: vi.fn(),
  registrySetMock: vi.fn(),
  bindingGetMock: vi.fn(),
  bindingSetMock: vi.fn(),
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
  const bindingRef = { get: bindingGetMock, set: bindingSetMock };
  const registryRef = {
    get: registryGetMock,
    set: registrySetMock,
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
  persistGoogleAccountProfileTokens,
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
      accountEmail: "sender@example.com",
    }));
    accountSetMock.mockResolvedValue(undefined);
    registrySetMock.mockResolvedValue(undefined);
    bindingSetMock.mockResolvedValue(undefined);
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
          accountEmail: "sender@example.com",
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
      accountEmail: "sender@example.com",
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

  it("stores an OAuth reconnect in the existing profile binding and preserves its refresh token", async () => {
    const result = await persistGoogleAccountProfileTokens(
      "uid-1",
      "rt_solutions_work",
      {
        accessToken: "new-access-token",
        refreshToken: null,
        expiryDate: 999999,
        scope: "gmail calendar drive",
      tokenType: "Bearer",
      accountEmail: "sender@example.com",
      }
    );

    expect(result).toEqual({
      accountId: "rt-account",
      profileId: "rt_solutions_work",
    });
    expect(setUserSecretMock).toHaveBeenCalledWith(
      "uid-1",
      "google-oauth-account-rt-account",
      expect.any(String)
    );
    const stored = JSON.parse(setUserSecretMock.mock.calls[0]?.[2] as string);
    expect(stored).toMatchObject({
      accessToken: "new-access-token",
      refreshToken: "refresh-token",
      accountEmail: "sender@example.com",
    });
    expect(bindingSetMock).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: "rt-account" }),
      { merge: true }
    );
    expect(accountSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        pendingRevocation: false,
        oauthHealthStatus: "healthy",
      }),
      { merge: true }
    );
  });

  it("never reuses another Google account's refresh token on a cross-account reconnect", async () => {
    await expect(
      persistGoogleAccountProfileTokens("uid-1", "rt_solutions_work", {
        accessToken: "new-account-access-token",
        refreshToken: null,
        expiryDate: 999999,
        scope: "https://www.googleapis.com/auth/gmail.send",
        tokenType: "Bearer",
        accountEmail: "different-sender@example.com",
      })
    ).rejects.toThrow("Missing refresh token from Google");

    expect(setUserSecretMock).not.toHaveBeenCalled();
    expect(bindingSetMock).not.toHaveBeenCalled();
    expect(accountSetMock).not.toHaveBeenCalled();
  });

  it("creates an idempotent profile-derived account when a canonical profile is not bound", async () => {
    registryGetMock.mockResolvedValue({ exists: false, data: () => undefined });
    bindingGetMock.mockResolvedValue({ exists: false, data: () => undefined });

    const result = await persistGoogleAccountProfileTokens(
      "uid-1",
      "rosser_gallery_work",
      {
        accessToken: "rng-access-token",
        refreshToken: "rng-refresh-token",
        scope: "calendar drive",
      }
    );

    expect(result.accountId).toBe("profile-rosser_gallery_work");
    expect(accessUserSecretMock).not.toHaveBeenCalled();
    expect(setUserSecretMock).toHaveBeenCalledWith(
      "uid-1",
      "google-oauth-account-profile-rosser_gallery_work",
      expect.any(String)
    );
    expect(registrySetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        schemaVersion: 2,
        defaultAccountId: "profile-rosser_gallery_work",
      }),
      { merge: true }
    );
    expect(bindingSetMock).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: "profile-rosser_gallery_work" }),
      { merge: true }
    );
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
