import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { callGoogleAPI } from "@/lib/google/tokens";

const log = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

describe("callGoogleAPI", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns JSON on success", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;

    const result = await callGoogleAPI<{ ok: boolean }>(
      "https://example.com/test",
      "token",
      { method: "GET" },
      log
    );

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(log.info).toHaveBeenCalled();
  });

  it("throws on API error", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { message: "Denied" } }), {
        status: 403,
        statusText: "Forbidden",
        headers: { "Content-Type": "application/json" },
      })
    );
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;

    await expect(
      callGoogleAPI("https://example.com/test", "token", {}, log)
    ).rejects.toThrow("Denied");

    expect(log.warn).toHaveBeenCalled();
  });
});
