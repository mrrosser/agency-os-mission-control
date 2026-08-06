import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { accessSecretVersionMock } = vi.hoisted(() => ({
  accessSecretVersionMock: vi.fn(),
}));

vi.mock("@google-cloud/secret-manager", () => ({
  SecretManagerServiceClient: class {
    accessSecretVersion = accessSecretVersionMock;
  },
}));

import { accessUserSecret } from "@/lib/secret-manager";

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
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("uses the Firebase runtime GCLOUD_PROJECT variable", async () => {
    await expect(accessUserSecret("uid-1", "google-oauth-account-1")).resolves.toBe(
      "stored-value"
    );
    expect(accessSecretVersionMock).toHaveBeenCalledWith({
      name: "projects/leadflow-review/secrets/mission-control-uid-1-google-oauth-account-1/versions/latest",
    });
  });
});
