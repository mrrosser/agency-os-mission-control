import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { POST as post } from "@/app/api/ai/script/route";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { resolveSecret } from "@/lib/api/secrets";
import { withIdempotency } from "@/lib/api/idempotency";

vi.mock("@/lib/api/auth", () => ({
  requireFirebaseAuth: vi.fn(),
}));

vi.mock("@/lib/api/secrets", () => ({
  resolveSecret: vi.fn(),
}));

vi.mock("@/lib/api/idempotency", () => ({
  getIdempotencyKey: vi.fn(() => null),
  withIdempotency: vi.fn(async (_params, executor: () => Promise<unknown>) => ({
    data: await executor(),
    replayed: false,
  })),
}));

const requireAuthMock = vi.mocked(requireFirebaseAuth);
const resolveSecretMock = vi.mocked(resolveSecret);
const withIdempotencyMock = vi.mocked(withIdempotency);

function createContext() {
  return { params: Promise.resolve({}) };
}

describe("ai script route", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
    requireAuthMock.mockResolvedValue({ uid: "user-1" } as unknown as { uid: string });
    resolveSecretMock.mockResolvedValue(null);
    withIdempotencyMock.mockImplementation(async (_params, executor: () => Promise<unknown>) => ({
      data: await executor(),
      replayed: false,
    }));
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("falls back to template scripts when OpenAI key is missing", async () => {
    const req = new Request("http://localhost/api/ai/script", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer test",
      },
      body: JSON.stringify({
        context: "Pricing is performance based. We integrate via API.",
        lead: {
          companyName: "Acme Roofing",
          founderName: "Alex",
          targetIndustry: "roofing",
        },
        type: "voice",
      }),
    });

    const res = await post(
      req as unknown as Parameters<typeof post>[0],
      createContext() as unknown as Parameters<typeof post>[1]
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.provider).toBe("template");
    expect(String(data.script)).toContain("Hi Alex");
  });

  it("uses OpenAI responses when key is present", async () => {
    resolveSecretMock.mockResolvedValue("test_openai_key");

    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers as HeadersInit);
      expect(headers.get("authorization")).toBe("Bearer test_openai_key");

      return new Response(
        JSON.stringify({
          output: [
            {
              type: "message",
              content: [{ type: "output_text", text: "Hello from OpenAI" }],
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    });

    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const req = new Request("http://localhost/api/ai/script", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer test",
      },
      body: JSON.stringify({
        context: "Case studies show 3x results.",
        lead: {
          companyName: "Fortify Roofs",
          founderName: "Beth",
          targetIndustry: "roofing",
        },
        type: "video",
      }),
    });

    const res = await post(
      req as unknown as Parameters<typeof post>[0],
      createContext() as unknown as Parameters<typeof post>[1]
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.provider).toBe("openai");
    expect(data.script).toBe("Hello from OpenAI");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.openai.com/v1/responses",
      expect.objectContaining({ method: "POST" })
    );
  });
});

