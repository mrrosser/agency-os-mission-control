import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/revenue/kpi/latest/route";
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

describe("revenue kpi latest route", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    requireAuthMock.mockResolvedValue({ uid: "user-1" } as Awaited<ReturnType<typeof requireFirebaseAuth>>);
  });

  it("returns the latest weekly KPI report", async () => {
    const getMock = vi.fn(async () => ({
      exists: true,
      data: () => ({
        weekStartDate: "2026-02-23",
        weekEndDate: "2026-03-01",
        timeZone: "America/Chicago",
        generatedAt: "2026-02-25T18:02:01.000Z",
        scannedLeadCount: 42,
        sampled: false,
        summary: {
          leadsSourced: 21,
          qualifiedLeads: 15,
          outreachReady: 13,
          meetingsBooked: 8,
          depositsCollected: 5,
          dealsWon: 3,
          closeRatePct: 14.29,
          avgCycleDaysToDeposit: 6.2,
          pipelineValueUsd: 12000,
        },
        decisionSummary: {
          scale: 1,
          fix: 2,
          kill: 0,
          watch: 3,
        },
      }),
    }));

    const collectionMock = vi.fn((name: string) => {
      if (name !== "identities") throw new Error(`unexpected collection ${name}`);
      return {
        doc: vi.fn((uid: string) => ({
          collection: vi.fn((subName: string) => {
            if (uid !== "user-1" || subName !== "revenue_kpi_reports") {
              throw new Error(`unexpected sub-collection ${subName}`);
            }
            return {
              doc: vi.fn((docId: string) => {
                if (docId !== "latest") throw new Error(`unexpected doc ${docId}`);
                return { get: getMock };
              }),
            };
          }),
        })),
      };
    });

    getAdminDbMock.mockReturnValue({
      collection: collectionMock,
    } as unknown as ReturnType<typeof getAdminDb>);

    const request = new Request("http://localhost/api/revenue/kpi/latest", { method: "GET" });
    const response = await GET(
      request as Parameters<typeof GET>[0],
      createContext() as Parameters<typeof GET>[1]
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.report.weekStartDate).toBe("2026-02-23");
    expect(payload.report.summary.depositsCollected).toBe(5);
    expect(payload.report.decisionSummary.scale).toBe(1);
    expect(getMock).toHaveBeenCalledOnce();
  });

  it("returns null report when latest KPI doc is missing", async () => {
    const getMock = vi.fn(async () => ({
      exists: false,
    }));

    getAdminDbMock.mockReturnValue({
      collection: vi.fn(() => ({
        doc: vi.fn(() => ({
          collection: vi.fn(() => ({
            doc: vi.fn(() => ({
              get: getMock,
            })),
          })),
        })),
      })),
    } as unknown as ReturnType<typeof getAdminDb>);

    const request = new Request("http://localhost/api/revenue/kpi/latest", { method: "GET" });
    const response = await GET(
      request as Parameters<typeof GET>[0],
      createContext() as Parameters<typeof GET>[1]
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.report).toBeNull();
    expect(getMock).toHaveBeenCalledOnce();
  });
});
