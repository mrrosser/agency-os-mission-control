import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST as createAvatarPost } from "@/app/api/heygen/create-avatar/route";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { resolveSecret } from "@/lib/api/secrets";
import { withIdempotency } from "@/lib/api/idempotency";
import { assertProviderSpendAllowed } from "@/lib/budget/enforcement";
import { ApiError } from "@/lib/api/handler";

vi.mock("@/lib/api/auth", () => ({
  requireFirebaseAuth: vi.fn(),
}));

vi.mock("@/lib/api/secrets", () => ({
  resolveSecret: vi.fn(),
}));

vi.mock("@/lib/api/idempotency", () => ({
  getIdempotencyKey: vi.fn(() => undefined),
  withIdempotency: vi.fn(async (_params, executor: () => Promise<unknown>) => ({
    data: await executor(),
    replayed: false,
  })),
}));

vi.mock("@/lib/budget/enforcement", () => ({
  assertProviderSpendAllowed: vi.fn(async () => undefined),
}));

const requireAuthMock = vi.mocked(requireFirebaseAuth);
const resolveSecretMock = vi.mocked(resolveSecret);
const withIdempotencyMock = vi.mocked(withIdempotency);
const assertProviderSpendAllowedMock = vi.mocked(assertProviderSpendAllowed);

function createContext() {
  return { params: Promise.resolve({}) };
}

describe("heygen route", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    requireAuthMock.mockResolvedValue({ uid: "user-1" } as never);
    resolveSecretMock.mockResolvedValue("heygen_key");
    withIdempotencyMock.mockImplementation(async (_params, executor: () => Promise<unknown>) => ({
      data: await executor(),
      replayed: false,
    }));
    assertProviderSpendAllowedMock.mockResolvedValue(undefined);
  });

  it("starts avatar generation when budget allows", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ data: { video_id: "video-1", status: "processing" } }),
    } as Response);

    const req = new Request("http://localhost/api/heygen/create-avatar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        script: "Avatar intro",
      }),
    });

    const res = await createAvatarPost(
      req as unknown as Parameters<typeof createAvatarPost>[0],
      createContext() as unknown as Parameters<typeof createAvatarPost>[1]
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.videoId).toBe("video-1");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("blocks avatar generation when the budget governor hard-stops HeyGen", async () => {
    assertProviderSpendAllowedMock.mockRejectedValueOnce(
      new ApiError(423, "Budget governor blocked heygen after reaching the provider hard limit.")
    );

    const req = new Request("http://localhost/api/heygen/create-avatar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        script: "Blocked avatar",
      }),
    });

    const res = await createAvatarPost(
      req as unknown as Parameters<typeof createAvatarPost>[0],
      createContext() as unknown as Parameters<typeof createAvatarPost>[1]
    );
    const data = await res.json();

    expect(res.status).toBe(423);
    expect(String(data.error)).toContain("Budget governor blocked heygen");
  });
});
