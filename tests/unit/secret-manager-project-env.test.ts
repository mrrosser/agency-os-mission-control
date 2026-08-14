import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  accessSecretVersionMock,
  addSecretVersionMock,
  createSecretMock,
  deleteSecretMock,
  getSecretMock,
} = vi.hoisted(() => ({
  accessSecretVersionMock: vi.fn(),
  addSecretVersionMock: vi.fn(),
  createSecretMock: vi.fn(),
  deleteSecretMock: vi.fn(),
  getSecretMock: vi.fn(),
}));

vi.mock("@google-cloud/secret-manager", () => ({
  SecretManagerServiceClient: class {
    accessSecretVersion = accessSecretVersionMock;
    addSecretVersion = addSecretVersionMock;
    createSecret = createSecretMock;
    deleteSecret = deleteSecretMock;
    getSecret = getSecretMock;
  },
}));

import {
  accessUserSecret,
  deleteUserSecret,
  getUserSecretId,
  setUserSecret,
} from "@/lib/secret-manager";

describe("Secret Manager project resolution", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    delete process.env.FIREBASE_PROJECT_ID;
    delete process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
    delete process.env.GOOGLE_CLOUD_PROJECT;
    process.env.GCLOUD_PROJECT = "leadflow-review";
    accessSecretVersionMock.mockResolvedValue([
      { payload: { data: Buffer.from("stored-value", "utf-8") } },
    ]);
    deleteSecretMock.mockResolvedValue(undefined);
    getSecretMock.mockResolvedValue([{}]);
    addSecretVersionMock.mockResolvedValue([{}]);
    createSecretMock.mockResolvedValue([{}]);
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("uses the Firebase runtime GCLOUD_PROJECT variable", async () => {
    await expect(accessUserSecret("uid-1", "google-oauth-account-1")).resolves.toBe(
      "stored-value"
    );
    expect(accessSecretVersionMock).toHaveBeenCalledWith({
      name: `projects/leadflow-review/secrets/${getUserSecretId(
        "uid-1",
        "google-oauth-account-1"
      )}/versions/latest`,
    });
  });

  it("uses collision-resistant identifiers for distinct exact UIDs", () => {
    expect(getUserSecretId("a/b", "oauth")).not.toBe(
      getUserSecretId("a?b", "oauth")
    );
    expect(getUserSecretId("a/b", "oauth")).toMatch(
      /^mission-control-v2-[a-f0-9]{48}$/
    );
  });

  it("does not try a lossy legacy secret id for a normalization-unstable UID", async () => {
    accessSecretVersionMock.mockRejectedValueOnce(Object.assign(new Error("missing"), { code: 5 }));

    await expect(accessUserSecret("a/b", "oauth")).resolves.toBeUndefined();

    expect(accessSecretVersionMock).toHaveBeenCalledTimes(1);
    expect(accessSecretVersionMock).toHaveBeenCalledWith({
      name: `projects/leadflow-review/secrets/${getUserSecretId("a/b", "oauth")}/versions/latest`,
    });
  });

  it("deletes both versioned and normalization-stable legacy secrets", async () => {
    await deleteUserSecret("uid-1", "google-oauth-account-1");

    expect(deleteSecretMock).toHaveBeenCalledTimes(2);
    expect(deleteSecretMock.mock.calls.map(([request]) => request.name)).toEqual([
      `projects/leadflow-review/secrets/${getUserSecretId("uid-1", "google-oauth-account-1")}`,
      "projects/leadflow-review/secrets/mission-control-uid-1-google-oauth-account-1",
    ]);
  });

  it("never derives a lossy legacy secret id during deletion", async () => {
    await deleteUserSecret("a/b", "oauth");

    expect(deleteSecretMock).toHaveBeenCalledTimes(1);
    expect(deleteSecretMock).toHaveBeenCalledWith({
      name: `projects/leadflow-review/secrets/${getUserSecretId("a/b", "oauth")}`,
    });
  });

  it("removes the stable legacy secret after a versioned write", async () => {
    await setUserSecret("uid-1", "google-oauth-account-1", "new-value");

    expect(addSecretVersionMock).toHaveBeenCalledWith({
      parent: `projects/leadflow-review/secrets/${getUserSecretId(
        "uid-1",
        "google-oauth-account-1"
      )}`,
      payload: { data: Buffer.from("new-value", "utf-8") },
    });
    expect(deleteSecretMock).toHaveBeenCalledWith({
      name: "projects/leadflow-review/secrets/mission-control-uid-1-google-oauth-account-1",
    });
  });

  it("does not derive a lossy legacy id after a versioned write", async () => {
    await setUserSecret("a/b", "oauth", "new-value");

    expect(addSecretVersionMock).toHaveBeenCalledTimes(1);
    expect(deleteSecretMock).not.toHaveBeenCalled();
  });
});
