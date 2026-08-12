import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const {
  requireFirebaseAuthMock,
  getStoredGoogleTokensMock,
  resolveGoogleAccountTokensMock,
} = vi.hoisted(() => ({
  requireFirebaseAuthMock: vi.fn(),
  getStoredGoogleTokensMock: vi.fn(),
  resolveGoogleAccountTokensMock: vi.fn(),
}));

vi.mock("@/lib/api/auth", () => ({
  requireFirebaseAuth: requireFirebaseAuthMock,
}));

vi.mock("@/lib/google/oauth", () => ({
  getStoredGoogleTokens: getStoredGoogleTokensMock,
}));

vi.mock("@/lib/google/account-token-store", () => ({
  resolveGoogleAccountTokens: resolveGoogleAccountTokensMock,
}));

import { GET } from "@/app/api/google/status/route";

describe("google status route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireFirebaseAuthMock.mockResolvedValue({ uid: "uid-123" });
    getStoredGoogleTokensMock.mockResolvedValue(null);
    resolveGoogleAccountTokensMock.mockImplementation(
      async (_uid: string, profileId: string) => {
        if (profileId === "rt_solutions_work") {
          return {
            registryFound: true,
            profileMapped: true,
            record: {
              accountId: "rt-account",
              profileId,
              tokens: {
                refreshToken: "rt-refresh-token",
                scope:
                  "https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/gmail.send",
              },
            },
          };
        }
        return {
          registryFound: true,
          profileMapped: false,
          record: null,
        };
      }
    );
  });

  it("reports RT Solutions and Rosser Gallery independently", async () => {
    const request = new NextRequest("https://leadflow-review.web.app/api/google/status");
    const response = await GET(request, {} as never);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.connected).toBe(true);
    expect(payload.storageMode).toBe("schema_v2");
    expect(payload.capabilities).toEqual({ drive: true, gmail: true, calendar: true });
    expect(payload.profiles).toEqual([
      expect.objectContaining({
        businessId: "rt_solutions",
        profileId: "rt_solutions_work",
          label: "RT.Solutions",
        connected: true,
        state: "connected",
      }),
      expect.objectContaining({
        businessId: "rosser_nft_gallery",
        profileId: "rosser_gallery_work",
        label: "Rosser Gallery",
        connected: false,
        state: "not_connected",
      }),
    ]);
  });

  it("does not fall back to a legacy account for a selected profile", async () => {
    getStoredGoogleTokensMock.mockResolvedValue({
      refreshToken: "legacy-refresh-token",
      scope: "https://www.googleapis.com/auth/gmail.send",
    });
    const request = new NextRequest(
      "https://leadflow-review.web.app/api/google/status?businessId=rosser_nft_gallery&profileId=rosser_gallery_work"
    );
    const response = await GET(request, {} as never);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.connected).toBe(false);
    expect(payload.storageMode).toBe("none");
    expect(payload.legacy.connected).toBe(true);
    expect(payload.profile).toMatchObject({
      businessId: "rosser_nft_gallery",
      profileId: "rosser_gallery_work",
      connected: false,
    });
    expect(payload.capabilities).toEqual({ drive: false, gmail: false, calendar: false });
  });

  it("fails closed on unknown selection", async () => {
    const request = new NextRequest(
      "https://leadflow-review.web.app/api/google/status?businessId=rosser_gallery"
    );
    const response = await GET(request, {} as never);

    expect(response.status).toBe(400);
    expect(resolveGoogleAccountTokensMock).not.toHaveBeenCalled();
    expect(getStoredGoogleTokensMock).not.toHaveBeenCalled();
  });

  it("marks a vault lookup failure unavailable without borrowing another profile", async () => {
    resolveGoogleAccountTokensMock.mockImplementation(
      async (_uid: string, profileId: string) => {
        if (profileId === "rosser_gallery_work") {
          throw new Error("secret payload must not be logged");
        }
        return {
          registryFound: true,
          profileMapped: false,
          record: null,
        };
      }
    );
    const request = new NextRequest("https://leadflow-review.web.app/api/google/status");
    const response = await GET(request, {} as never);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.profiles[1]).toMatchObject({
      profileId: "rosser_gallery_work",
      connected: false,
      state: "unavailable",
    });
  });
});
