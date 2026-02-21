import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/competitors/monitor/worker-task/route";
import { getAdminDb } from "@/lib/firebase-admin";
import { resolveSecret } from "@/lib/api/secrets";
import { firecrawlScrape } from "@/lib/firecrawl/client";
import { triggerCompetitorMonitorWorker } from "@/lib/competitors/jobs";

vi.mock("@/lib/firebase-admin", () => ({
  getAdminDb: vi.fn(),
}));

vi.mock("@/lib/api/secrets", () => ({
  resolveSecret: vi.fn(),
}));

vi.mock("@/lib/firecrawl/client", () => ({
  firecrawlScrape: vi.fn(),
}));

vi.mock("@/lib/competitors/jobs", () => ({
  triggerCompetitorMonitorWorker: vi.fn(async () => "http"),
}));

const getAdminDbMock = vi.mocked(getAdminDb);
const resolveSecretMock = vi.mocked(resolveSecret);
const firecrawlScrapeMock = vi.mocked(firecrawlScrape);
const triggerMonitorWorkerMock = vi.mocked(triggerCompetitorMonitorWorker);

function createContext(params: Record<string, string> = {}) {
  return { params: Promise.resolve(params) };
}

describe("competitor monitor worker-task route", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    resolveSecretMock.mockResolvedValue("firecrawl-key");
    firecrawlScrapeMock.mockResolvedValue({
      markdown: "Contact us at sales@signal.example and (512) 555-0100",
      links: ["https://signal.example/about"],
      metadata: {
        title: "Signal HVAC",
        description: "HVAC service",
      },
    });
  });

  it("generates markdown/html report and schedules next run", async () => {
    const reportSet = vi.fn(async () => undefined);
    const monitorSet = vi.fn(async () => undefined);
    const monitorGet = vi.fn(async () => ({
      exists: true,
      data: () => ({
        name: "HVAC Monitor",
        workerToken: "worker-1",
        frequencyHours: 24,
        competitors: [{ name: "Signal HVAC", url: "https://signal.example" }],
      }),
    }));

    const monitorRef = {
      get: monitorGet,
      set: monitorSet,
      collection: vi.fn((name: string) => {
        if (name !== "reports") throw new Error("unexpected subcollection");
        return {
          doc: vi.fn(() => ({
            set: reportSet,
          })),
        };
      }),
    };

    getAdminDbMock.mockReturnValue({
      collection: vi.fn(() => ({
        doc: vi.fn(() => ({
          collection: vi.fn(() => ({
            doc: vi.fn(() => monitorRef),
          })),
        })),
      })),
    } as unknown as ReturnType<typeof getAdminDb>);

    const req = new Request("http://localhost/api/competitors/monitor/worker-task", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        uid: "user-1",
        monitorId: "monitor-1",
        workerToken: "worker-1",
      }),
    });

    const res = await POST(
      req as unknown as Parameters<typeof POST>[0],
      createContext() as unknown as Parameters<typeof POST>[1]
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.monitorId).toBe("monitor-1");
    expect(firecrawlScrapeMock).toHaveBeenCalledOnce();
    expect(reportSet).toHaveBeenCalledOnce();
    expect(monitorSet).toHaveBeenCalled();
    expect(triggerMonitorWorkerMock).toHaveBeenCalledOnce();
  });
});
