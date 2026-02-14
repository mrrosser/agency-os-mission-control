import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/public/call-audio/[clipId]/route";
import { getAdminDb } from "@/lib/firebase-admin";

vi.mock("@/lib/firebase-admin", () => ({
  getAdminDb: vi.fn(),
}));

const getAdminDbMock = vi.mocked(getAdminDb);

function createContext(clipId: string) {
  return { params: Promise.resolve({ clipId }) };
}

describe("public call-audio route", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("serves stored audio clip bytes", async () => {
    const clipGet = vi.fn(async () => ({
      exists: true,
      data: () => ({
        audioBase64: Buffer.from("audio-bytes").toString("base64"),
        mimeType: "audio/mpeg",
        servedCount: 2,
        expiresAt: { toDate: () => new Date(Date.now() + 60_000) },
      }),
    }));
    const clipSet = vi.fn(async () => undefined);

    getAdminDbMock.mockReturnValue({
      collection: vi.fn(() => ({
        doc: vi.fn(() => ({
          get: clipGet,
          set: clipSet,
        })),
      })),
    } as unknown as ReturnType<typeof getAdminDb>);

    const req = new Request("http://localhost/api/public/call-audio/clip-1", { method: "GET" });
    const res = await GET(
      req as unknown as Parameters<typeof GET>[0],
      createContext("clip-1") as unknown as Parameters<typeof GET>[1]
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("audio/mpeg");
    expect(await res.arrayBuffer()).toBeInstanceOf(ArrayBuffer);
    expect(clipSet).toHaveBeenCalledOnce();
  });
});
