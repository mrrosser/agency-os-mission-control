import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/google/status/route";
import { ApiError } from "@/lib/api/handler";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { getAccessTokenForUser, getStoredGoogleTokens } from "@/lib/google/oauth";

vi.mock("@/lib/api/auth", () => ({
  requireFirebaseAuth: vi.fn(),
}));

vi.mock("@/lib/google/oauth", () => ({
  getAccessTokenForUser: vi.fn(),
  getStoredGoogleTokens: vi.fn(),
  googleCapabilitiesFromScopeString: vi.fn((scope?: string | null) => ({
    drive: Boolean(scope?.includes("drive")),
    gmail: Boolean(scope?.includes("gmail")),
    calendar: Boolean(scope?.includes("calendar")),
  })),
}));

const requireFirebaseAuthMock = vi.mocked(requireFirebaseAuth);
const getStoredGoogleTokensMock = vi.mocked(getStoredGoogleTokens);
const getAccessTokenForUserMock = vi.mocked(getAccessTokenForUser);

function createContext() {
  return { params: Promise.resolve({}) };
}

describe("google status route", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    requireFirebaseAuthMock.mockResolvedValue({ uid: "user-1" } as never);
  });

  it("returns disconnected when no tokens are stored", async () => {
    getStoredGoogleTokensMock.mockResolvedValue(null);

    const response = await GET(
      new Request("http://localhost/api/google/status") as never,
      createContext() as never
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      connected: false,
      reconnectRequired: false,
      scopes: null,
      capabilities: {
        drive: false,
        gmail: false,
        calendar: false,
      },
    });
    expect(getAccessTokenForUserMock).not.toHaveBeenCalled();
  });

  it("returns connected when the stored Google token validates", async () => {
    getStoredGoogleTokensMock.mockResolvedValue({
      refreshToken: "refresh-token",
      scope: "https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/drive.readonly",
    } as never);
    getAccessTokenForUserMock.mockResolvedValue("access-token");

    const response = await GET(
      new Request("http://localhost/api/google/status") as never,
      createContext() as never
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.connected).toBe(true);
    expect(payload.reconnectRequired).toBe(false);
    expect(payload.scopes).toContain("gmail.send");
    expect(payload.capabilities).toEqual({
      drive: true,
      gmail: true,
      calendar: false,
    });
    expect(getAccessTokenForUserMock).toHaveBeenCalledWith("user-1", expect.anything());
  });

  it("downgrades revoked Google tokens to reconnect required", async () => {
    getStoredGoogleTokensMock.mockResolvedValue({
      refreshToken: "refresh-token",
      scope: "https://www.googleapis.com/auth/calendar.events",
    } as never);
    getAccessTokenForUserMock.mockRejectedValue(
      new ApiError(403, "Google connection expired or was revoked. Reconnect your Google Workspace account.")
    );

    const response = await GET(
      new Request("http://localhost/api/google/status") as never,
      createContext() as never
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      connected: false,
      reconnectRequired: true,
      scopes: null,
      capabilities: {
        drive: false,
        gmail: false,
        calendar: false,
      },
    });
  });
});
