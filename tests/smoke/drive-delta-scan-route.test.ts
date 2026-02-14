import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/drive/delta-scan/route";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { getAccessTokenForUser } from "@/lib/google/oauth";
import { listMetadataSince } from "@/lib/google/drive";
import { getAdminDb } from "@/lib/firebase-admin";
import { withIdempotency } from "@/lib/api/idempotency";

vi.mock("@/lib/api/auth", () => ({
  requireFirebaseAuth: vi.fn(),
}));

vi.mock("@/lib/google/oauth", () => ({
  getAccessTokenForUser: vi.fn(),
}));

vi.mock("@/lib/google/drive", async () => {
  const actual = await vi.importActual<typeof import("@/lib/google/drive")>("@/lib/google/drive");
  return {
    ...actual,
    listMetadataSince: vi.fn(),
  };
});

vi.mock("@/lib/firebase-admin", () => ({
  getAdminDb: vi.fn(),
}));

vi.mock("@/lib/api/idempotency", () => ({
  getIdempotencyKey: vi.fn(() => null),
  withIdempotency: vi.fn(async (_params, executor: () => Promise<unknown>) => ({
    data: await executor(),
    replayed: false,
  })),
}));

const requireAuthMock = vi.mocked(requireFirebaseAuth);
const getAccessTokenMock = vi.mocked(getAccessTokenForUser);
const listMetadataSinceMock = vi.mocked(listMetadataSince);
const getAdminDbMock = vi.mocked(getAdminDb);
const withIdempotencyMock = vi.mocked(withIdempotency);

function createContext() {
  return { params: Promise.resolve({}) };
}

describe("drive delta-scan route", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    requireAuthMock.mockResolvedValue({ uid: "user-1" } as unknown as { uid: string });
    getAccessTokenMock.mockResolvedValue("ya29.test-token");
    withIdempotencyMock.mockImplementation(async (_params, executor: () => Promise<unknown>) => ({
      data: await executor(),
      replayed: false,
    }));
  });

  it("returns scan summary", async () => {
    const getMock = vi.fn(async () => ({
      exists: true,
      data: () => ({
        lastCheckpoint: { toDate: () => new Date("2026-02-10T10:00:00.000Z") },
        lastRunAt: { toDate: () => new Date("2026-02-11T10:00:00.000Z") },
        lastResultCount: 12,
        folderIds: ["folder-1"],
        maxFiles: 200,
      }),
    }));

    getAdminDbMock.mockReturnValue({
      collection: vi.fn(() => ({
        doc: vi.fn(() => ({
          collection: vi.fn(() => ({
            doc: vi.fn(() => ({ get: getMock })),
          })),
        })),
      })),
    } as unknown as ReturnType<typeof getAdminDb>);

    const req = new Request("http://localhost/api/drive/delta-scan", { method: "GET" });
    const res = await GET(
      req as unknown as Parameters<typeof GET>[0],
      createContext() as unknown as Parameters<typeof GET>[1]
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.summary.lastResultCount).toBe(12);
  });

  it("runs metadata-only scan and persists checkpoint", async () => {
    const getMock = vi.fn(async () => ({ exists: false, data: () => undefined }));
    const setMock = vi.fn(async () => undefined);

    getAdminDbMock.mockReturnValue({
      collection: vi.fn(() => ({
        doc: vi.fn(() => ({
          collection: vi.fn(() => ({
            doc: vi.fn(() => ({ get: getMock, set: setMock })),
          })),
        })),
      })),
    } as unknown as ReturnType<typeof getAdminDb>);

    listMetadataSinceMock.mockResolvedValue([
      {
        id: "file-1",
        name: "Proposal.docx",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        modifiedTime: "2026-02-12T12:00:00.000Z",
      },
    ]);

    const req = new Request("http://localhost/api/drive/delta-scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ maxFiles: 100 }),
    });
    const res = await POST(
      req as unknown as Parameters<typeof POST>[0],
      createContext() as unknown as Parameters<typeof POST>[1]
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.scannedCount).toBe(1);
    expect(listMetadataSinceMock).toHaveBeenCalledOnce();
    expect(setMock).toHaveBeenCalledOnce();
  });
});
