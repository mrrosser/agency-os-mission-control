import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/telemetry/retention-status/route";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { getAdminDb } from "@/lib/firebase-admin";

vi.mock("@/lib/api/auth", () => ({
  requireFirebaseAuth: vi.fn(),
}));

vi.mock("@/lib/firebase-admin", () => ({
  getAdminDb: vi.fn(),
}));

const requireAuthMock = vi.mocked(requireFirebaseAuth);
const getAdminDbMock = vi.mocked(getAdminDb);

function createContext() {
  return { params: Promise.resolve({}) };
}

describe("telemetry retention status route", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    requireAuthMock.mockResolvedValue({ uid: "user-1" } as unknown as Awaited<ReturnType<typeof requireFirebaseAuth>>);
  });

  it("returns latest retention cleanup metrics and recent runs", async () => {
    const latestDoc = {
      exists: true,
      data: () => ({
        status: "success",
        correlationId: "cid-latest",
        dryRun: false,
        eventRetentionDays: 30,
        groupRetentionDays: 180,
        events: { deleted: 4, batches: 1, reachedDeleteCap: false },
        groups: { deleted: 1, batches: 1, reachedDeleteCap: false },
        github: { runId: "1234", runUrl: "https://github.com/org/repo/actions/runs/1234" },
      }),
    };

    const runs = [
      {
        data: () => ({
          status: "success",
          correlationId: "cid-a",
          dryRun: false,
          eventRetentionDays: 30,
          groupRetentionDays: 180,
          events: { deleted: 4, batches: 1, reachedDeleteCap: false },
          groups: { deleted: 1, batches: 1, reachedDeleteCap: false },
        }),
      },
      {
        data: () => ({
          status: "failed",
          correlationId: "cid-b",
          dryRun: true,
          eventRetentionDays: 30,
          groupRetentionDays: 180,
          error: { message: "permission denied" },
        }),
      },
    ];

    getAdminDbMock.mockReturnValue({
      collection: vi.fn((name: string) => {
        if (name === "telemetry_maintenance") {
          return {
            doc: vi.fn(() => ({
              get: vi.fn(async () => latestDoc),
            })),
          };
        }
        if (name === "telemetry_maintenance_runs") {
          return {
            orderBy: vi.fn(() => ({
              limit: vi.fn(() => ({
                get: vi.fn(async () => ({ docs: runs })),
              })),
            })),
          };
        }
        throw new Error(`unexpected collection ${name}`);
      }),
    } as unknown as ReturnType<typeof getAdminDb>);

    const req = new Request("http://localhost/api/telemetry/retention-status?limit=2", {
      method: "GET",
    });
    const res = await GET(
      req as unknown as Parameters<typeof GET>[0],
      createContext() as unknown as Parameters<typeof GET>[1]
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.latest.status).toBe("success");
    expect(data.latest.events.deleted).toBe(4);
    expect(data.latest.groups.deleted).toBe(1);
    expect(data.latest.github.runUrl).toContain("/actions/runs/1234");
    expect(Array.isArray(data.runs)).toBe(true);
    expect(data.runs).toHaveLength(2);
    expect(data.runs[1].status).toBe("failed");
    expect(data.runs[1].error.message).toContain("permission denied");
    expect(data.runs[1].alert.code).toBe("cleanup_failed");
  });
});
