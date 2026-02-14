import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GET } from "@/app/api/drive/picker-token/route";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { getAccessTokenForUser } from "@/lib/google/oauth";
import { resolveSecret } from "@/lib/api/secrets";

vi.mock("@/lib/api/auth", () => ({
  requireFirebaseAuth: vi.fn(),
}));

vi.mock("@/lib/google/oauth", () => ({
  getAccessTokenForUser: vi.fn(),
}));

vi.mock("@/lib/api/secrets", () => ({
  resolveSecret: vi.fn(),
}));

const requireAuthMock = vi.mocked(requireFirebaseAuth);
const getAccessTokenMock = vi.mocked(getAccessTokenForUser);
const resolveSecretMock = vi.mocked(resolveSecret);

function createContext() {
  return { params: Promise.resolve({}) };
}

describe("drive picker token", () => {
  const prevEnv = { ...process.env };

  beforeEach(() => {
    vi.restoreAllMocks();
    requireAuthMock.mockResolvedValue({ uid: "user-1" } as unknown as { uid: string });
    getAccessTokenMock.mockResolvedValue("access-token");
  });

  afterEach(() => {
    process.env = { ...prevEnv };
  });

  it("returns access token + picker config", async () => {
    resolveSecretMock.mockResolvedValue("test-picker-key");
    process.env.__FIREBASE_DEFAULTS__ = JSON.stringify({
      config: { projectNumber: 123 },
    });

    const req = new Request("http://localhost/api/drive/picker-token", {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });

    const res = await GET(
      req as unknown as Parameters<typeof GET>[0],
      createContext() as unknown as Parameters<typeof GET>[1]
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.accessToken).toBe("access-token");
    expect(data.pickerApiKey).toBe("test-picker-key");
    expect(data.appId).toBe("123");
    expect(data.origin).toBe("http://localhost");
  });

  it("returns a 500 when GOOGLE_PICKER_API_KEY is missing", async () => {
    resolveSecretMock.mockResolvedValue(undefined);

    const req = new Request("http://localhost/api/drive/picker-token", {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });

    const res = await GET(
      req as unknown as Parameters<typeof GET>[0],
      createContext() as unknown as Parameters<typeof GET>[1]
    );
    const data = await res.json();

    expect(res.status).toBe(500);
    expect(data.error).toContain("Missing GOOGLE_PICKER_API_KEY");
    expect(typeof data.correlationId).toBe("string");
  });
});
