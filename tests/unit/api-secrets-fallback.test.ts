import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { accessUserSecret } = vi.hoisted(() => ({
  accessUserSecret: vi.fn(),
}));

vi.mock("@/lib/secret-manager", () => ({
  accessUserSecret,
  setUserSecret: vi.fn(),
}));

vi.mock("@/lib/firebase-admin", () => ({
  getAdminDb: vi.fn(() => {
    throw new Error("Firestore should not be reached after the first lookup fails");
  }),
}));

describe("resolveSecret runtime fallback", () => {
  const original = process.env.GOOGLE_PLACES_API_KEY;
  const log = { warn: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GOOGLE_PLACES_API_KEY = "runtime-provider-key";
  });

  afterEach(() => {
    if (original === undefined) delete process.env.GOOGLE_PLACES_API_KEY;
    else process.env.GOOGLE_PLACES_API_KEY = original;
  });

  it("uses the mounted runtime secret when user Secret Manager lookup fails", async () => {
    accessUserSecret.mockRejectedValueOnce({ code: 5, details: "not found" });
    const { resolveSecret } = await import("@/lib/api/secrets");

    await expect(
      resolveSecret("operator", "googlePlacesKey", "GOOGLE_PLACES_API_KEY", {
        allowRuntimeFallbackOnAccessError: true,
        log,
      }),
    ).resolves.toBe("runtime-provider-key");
    expect(log.warn).toHaveBeenCalledWith("secret.resolve.runtime_fallback", {
      key: "googlePlacesKey",
      envVarName: "GOOGLE_PLACES_API_KEY",
      errorCode: 5,
      errorName: null,
    });
  });

  it("does not silently use a shared runtime secret for default callers", async () => {
    accessUserSecret.mockRejectedValueOnce({ code: 7, details: "denied" });
    const { resolveSecret } = await import("@/lib/api/secrets");

    await expect(
      resolveSecret("operator", "googlePlacesKey", "GOOGLE_PLACES_API_KEY"),
    ).rejects.toEqual({ code: 7, details: "denied" });
  });

  it("fails closed when neither user nor runtime secret is available", async () => {
    delete process.env.GOOGLE_PLACES_API_KEY;
    accessUserSecret.mockRejectedValueOnce({ code: 7, details: "denied" });
    const { resolveSecret } = await import("@/lib/api/secrets");

    await expect(
      resolveSecret("operator", "googlePlacesKey", "GOOGLE_PLACES_API_KEY", {
        allowRuntimeFallbackOnAccessError: true,
        log,
      }),
    ).rejects.toEqual({ code: 7, details: "denied" });
  });
});
