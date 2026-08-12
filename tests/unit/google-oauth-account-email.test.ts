import { beforeEach, describe, expect, it, vi } from "vitest";

const { callGoogleAPIMock } = vi.hoisted(() => ({
  callGoogleAPIMock: vi.fn(),
}));

vi.mock("@/lib/google/tokens", () => ({
  callGoogleAPI: callGoogleAPIMock,
}));

import { fetchGoogleAccountEmail } from "@/lib/google/oauth";

describe("Google OAuth account identity", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns only a verified normalized account email", async () => {
    callGoogleAPIMock.mockResolvedValue({
      email: " Sender@Example.com ",
      email_verified: true,
    });

    await expect(fetchGoogleAccountEmail("access-token")).resolves.toBe(
      "sender@example.com"
    );
    expect(callGoogleAPIMock).toHaveBeenCalledWith(
      "https://openidconnect.googleapis.com/v1/userinfo",
      "access-token",
      {},
      undefined
    );
  });

  it("rejects an unverified or missing account identity", async () => {
    callGoogleAPIMock.mockResolvedValue({
      email: "sender@example.com",
      email_verified: false,
    });
    await expect(fetchGoogleAccountEmail("access-token")).rejects.toThrow(
      "verified account email"
    );
  });
});
