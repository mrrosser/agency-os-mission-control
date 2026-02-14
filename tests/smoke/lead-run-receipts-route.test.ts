import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/lead-runs/[runId]/receipts/route";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { assertLeadRunOwner } from "@/lib/lead-runs/receipts";
import { getAdminDb } from "@/lib/firebase-admin";

vi.mock("@/lib/api/auth", () => ({
  requireFirebaseAuth: vi.fn(),
}));

vi.mock("@/lib/lead-runs/receipts", async () => {
  const actual = await vi.importActual<typeof import("@/lib/lead-runs/receipts")>(
    "@/lib/lead-runs/receipts"
  );
  return {
    ...actual,
    assertLeadRunOwner: vi.fn(),
  };
});

vi.mock("@/lib/firebase-admin", () => ({
  getAdminDb: vi.fn(),
}));

const requireAuthMock = vi.mocked(requireFirebaseAuth);
const assertOwnerMock = vi.mocked(assertLeadRunOwner);
const getAdminDbMock = vi.mocked(getAdminDb);

function createContext(params: Record<string, string>) {
  return { params: Promise.resolve(params) };
}

describe("lead run receipts route", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    requireAuthMock.mockResolvedValue({ uid: "user-1" } as unknown as { uid: string });
    assertOwnerMock.mockResolvedValue(undefined);
  });

  it("returns run metadata, leads, and action receipts", async () => {
    const actionsForLead = {
      docs: [
        {
          data: () => ({
            actionId: "gmail.outreach",
            status: "complete",
            updatedAt: { toDate: () => new Date("2026-02-12T10:00:00Z") },
          }),
        },
      ],
    };

    const leadsSnap = {
      docs: [
        {
          id: "googlePlaces-lead1",
          data: () => ({ id: "lead1", companyName: "Acme", score: 72, source: "googlePlaces" }),
          ref: {
            collection: vi.fn(() => ({
              get: vi.fn(async () => actionsForLead),
            })),
          },
        },
      ],
    };

    const runRef = {
      get: vi.fn(async () => ({
        exists: true,
        data: () => ({ userId: "user-1", total: 1, warnings: [] }),
      })),
      collection: vi.fn((name: string) => {
        if (name === "leads") {
          return { get: vi.fn(async () => leadsSnap) };
        }
        throw new Error(`unexpected subcollection: ${name}`);
      }),
    };

    getAdminDbMock.mockReturnValue({
      collection: vi.fn(() => ({
        doc: vi.fn(() => runRef),
      })),
    } as unknown as ReturnType<typeof getAdminDb>);

    const req = new Request("http://localhost/api/lead-runs/run-1/receipts", { method: "GET" });
    const res = await GET(
      req as unknown as Parameters<typeof GET>[0],
      createContext({ runId: "run-1" }) as unknown as Parameters<typeof GET>[1]
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.run.runId).toBe("run-1");
    expect(Array.isArray(data.leads)).toBe(true);
    expect(data.leads).toHaveLength(1);
    expect(data.leads[0].leadDocId).toBe("googlePlaces-lead1");
    expect(Array.isArray(data.leads[0].actions)).toBe(true);
    expect(data.leads[0].actions[0].actionId).toBe("gmail.outreach");
  });
});

