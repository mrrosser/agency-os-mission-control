import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST as synthesizePost } from "@/app/api/elevenlabs/synthesize/route";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { resolveSecret } from "@/lib/api/secrets";
import { withIdempotency } from "@/lib/api/idempotency";
import { dbAdmin } from "@/lib/db-admin";

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

vi.mock("@/lib/db-admin", () => ({
  dbAdmin: {
    logActivity: vi.fn(),
  },
}));

const requireAuthMock = vi.mocked(requireFirebaseAuth);
const resolveSecretMock = vi.mocked(resolveSecret);
const withIdempotencyMock = vi.mocked(withIdempotency);
const logActivityMock = vi.mocked(dbAdmin.logActivity);

function createContext() {
  return { params: Promise.resolve({}) };
}

describe("elevenlabs synthesize route", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    requireAuthMock.mockResolvedValue({ uid: "user-1" } as unknown as { uid: string });
    withIdempotencyMock.mockImplementation(async (_params, executor: () => Promise<unknown>) => ({
      data: await executor(),
      replayed: false,
    }));
    resolveSecretMock.mockResolvedValue("test_elevenlabs_key");
    logActivityMock.mockResolvedValue(undefined as never);
  });

  it("returns 400 when ElevenLabs key is missing", async () => {
    resolveSecretMock.mockResolvedValue(null);

    const req = new Request("http://localhost/api/elevenlabs/synthesize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: "Hello there",
      }),
    });

    const res = await synthesizePost(
      req as unknown as Parameters<typeof synthesizePost>[0],
      createContext() as unknown as Parameters<typeof synthesizePost>[1]
    );
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toContain("ElevenLabs API key");
  });

  it("returns base64 audio on successful synth", async () => {
    const audioBytes = new Uint8Array([1, 2, 3, 4]);
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      arrayBuffer: async () => audioBytes.buffer,
    } as Response);

    const req = new Request("http://localhost/api/elevenlabs/synthesize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: "Quick test line",
        voiceId: "voice_123",
      }),
    });

    const res = await synthesizePost(
      req as unknown as Parameters<typeof synthesizePost>[0],
      createContext() as unknown as Parameters<typeof synthesizePost>[1]
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.voiceId).toBe("voice_123");
    expect(data.mimeType).toBe("audio/mpeg");
    expect(data.audioBase64).toBe(Buffer.from(audioBytes).toString("base64"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(logActivityMock).toHaveBeenCalledTimes(1);
  });
});
