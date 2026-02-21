import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/competitors/monitor/route";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { getAdminDb } from "@/lib/firebase-admin";
import { triggerCompetitorMonitorWorker } from "@/lib/competitors/jobs";

vi.mock("@/lib/api/auth", () => ({
  requireFirebaseAuth: vi.fn(),
}));

vi.mock("@/lib/firebase-admin", () => ({
  getAdminDb: vi.fn(),
}));

vi.mock("@/lib/competitors/jobs", () => ({
  triggerCompetitorMonitorWorker: vi.fn(async () => "http"),
}));

const requireAuthMock = vi.mocked(requireFirebaseAuth);
const getAdminDbMock = vi.mocked(getAdminDb);
const triggerWorkerMock = vi.mocked(triggerCompetitorMonitorWorker);

function createContext(params: Record<string, string> = {}) {
  return { params: Promise.resolve(params) };
}

describe("competitor monitor route", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    requireAuthMock.mockResolvedValue({ uid: "user-1" } as unknown as { uid: string });
  });

  it("creates a monitor and dispatches worker", async () => {
    const monitorGet = vi.fn(async () => ({ exists: false, data: () => ({}) }));
    const monitorSet = vi.fn(async () => undefined);

    const monitorsCollection = {
      doc: vi.fn(() => ({
        get: monitorGet,
        set: monitorSet,
      })),
      orderBy: vi.fn(() => ({
        limit: vi.fn(() => ({
          get: vi.fn(async () => ({ docs: [] })),
        })),
      })),
    };

    getAdminDbMock.mockReturnValue({
      collection: vi.fn(() => ({
        doc: vi.fn(() => ({
          collection: vi.fn(() => monitorsCollection),
        })),
      })),
    } as unknown as ReturnType<typeof getAdminDb>);

    const req = new Request("http://localhost/api/competitors/monitor", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "HVAC Monitor",
        competitors: [{ name: "Signal HVAC", url: "https://signal.example" }],
        frequencyHours: 24,
        runNow: true,
      }),
    });
    const res = await POST(
      req as unknown as Parameters<typeof POST>[0],
      createContext() as unknown as Parameters<typeof POST>[1]
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.monitor.name).toBe("HVAC Monitor");
    expect(monitorSet).toHaveBeenCalledOnce();
    expect(triggerWorkerMock).toHaveBeenCalledOnce();
  });

  it("lists monitors", async () => {
    const monitorsCollection = {
      orderBy: vi.fn(() => ({
        limit: vi.fn(() => ({
          get: vi.fn(async () => ({
            docs: [
              {
                id: "monitor-1",
                data: () => ({
                  name: "HVAC Monitor",
                  competitors: [{ name: "Signal HVAC", url: "https://signal.example" }],
                  frequencyHours: 12,
                  status: "idle",
                }),
              },
            ],
          })),
        })),
      })),
      doc: vi.fn(),
    };

    getAdminDbMock.mockReturnValue({
      collection: vi.fn(() => ({
        doc: vi.fn(() => ({
          collection: vi.fn(() => monitorsCollection),
        })),
      })),
    } as unknown as ReturnType<typeof getAdminDb>);

    const req = new Request("http://localhost/api/competitors/monitor", {
      method: "GET",
    });
    const res = await GET(
      req as unknown as Parameters<typeof GET>[0],
      createContext() as unknown as Parameters<typeof GET>[1]
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(Array.isArray(data.monitors)).toBe(true);
    expect(data.monitors[0].name).toBe("HVAC Monitor");
  });
});
