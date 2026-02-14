import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET } from "@/app/api/google/places/photo/route";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { resolveSecret } from "@/lib/api/secrets";

vi.mock("@/lib/api/auth", () => ({
  requireFirebaseAuth: vi.fn(),
}));

vi.mock("@/lib/api/secrets", () => ({
  resolveSecret: vi.fn(),
}));

const requireAuthMock = vi.mocked(requireFirebaseAuth);
const resolveSecretMock = vi.mocked(resolveSecret);

function createContext() {
  return { params: Promise.resolve({}) };
}

describe("google places photo proxy", () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.restoreAllMocks();
    requireAuthMock.mockResolvedValue({ uid: "user-1" } as unknown as { uid: string });
    resolveSecretMock.mockResolvedValue("places-key");
    (globalThis as unknown as { fetch: typeof fetch }).fetch = mockFetch as unknown as typeof fetch;
  });

  it("returns 400 for invalid query", async () => {
    const req = new Request("http://localhost/api/google/places/photo", { method: "GET" });
    const res = await GET(
      req as unknown as Parameters<typeof GET>[0],
      createContext() as unknown as Parameters<typeof GET>[1]
    );
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toContain("Invalid request");
    expect(typeof data.correlationId).toBe("string");
  });

  it("returns 500 when GOOGLE_PLACES_API_KEY is missing", async () => {
    resolveSecretMock.mockResolvedValue(undefined);
    const req = new Request("http://localhost/api/google/places/photo?ref=photo-ref-1", { method: "GET" });
    const res = await GET(
      req as unknown as Parameters<typeof GET>[0],
      createContext() as unknown as Parameters<typeof GET>[1]
    );
    const data = await res.json();

    expect(res.status).toBe(500);
    expect(data.error).toContain("Missing GOOGLE_PLACES_API_KEY");
  });

  it("streams image bytes from upstream", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "image/png" }),
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    });

    const req = new Request("http://localhost/api/google/places/photo?ref=photo-ref-1&maxWidth=320", {
      method: "GET",
    });
    const res = await GET(
      req as unknown as Parameters<typeof GET>[0],
      createContext() as unknown as Parameters<typeof GET>[1]
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toContain("max-age");
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(Array.from(bytes)).toEqual([1, 2, 3]);
  });
});

