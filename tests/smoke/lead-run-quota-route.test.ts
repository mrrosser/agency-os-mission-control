import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/lead-runs/quota/route";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { getLeadRunQuotaSummary, resolveLeadRunOrgId } from "@/lib/lead-runs/quotas";

vi.mock("@/lib/api/auth", () => ({
  requireFirebaseAuth: vi.fn(),
}));

vi.mock("@/lib/lead-runs/quotas", () => ({
  getLeadRunQuotaSummary: vi.fn(),
  resolveLeadRunOrgId: vi.fn(),
}));

const requireAuthMock = vi.mocked(requireFirebaseAuth);
const resolveOrgMock = vi.mocked(resolveLeadRunOrgId);
const getQuotaMock = vi.mocked(getLeadRunQuotaSummary);

function createContext() {
  return { params: Promise.resolve({}) };
}

describe("lead run quota route", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    requireAuthMock.mockResolvedValue({ uid: "user-1" } as unknown as { uid: string });
    resolveOrgMock.mockResolvedValue("org-1");
    getQuotaMock.mockResolvedValue({
      orgId: "org-1",
      windowKey: "2026-02-12",
      runsUsed: 5,
      leadsUsed: 120,
      activeRuns: 1,
      maxRunsPerDay: 80,
      maxLeadsPerDay: 1200,
      maxActiveRuns: 3,
      runsRemaining: 75,
      leadsRemaining: 1080,
      utilization: {
        runsPct: 6,
        leadsPct: 10,
      },
    });
  });

  it("returns quota summary for authenticated user org", async () => {
    const req = new Request("http://localhost/api/lead-runs/quota", { method: "GET" });
    const res = await GET(
      req as unknown as Parameters<typeof GET>[0],
      createContext() as unknown as Parameters<typeof GET>[1]
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.quota.orgId).toBe("org-1");
    expect(data.quota.maxRunsPerDay).toBe(80);
    expect(data.quota.activeRuns).toBe(1);
    expect(data.quota.maxActiveRuns).toBe(3);
    expect(resolveOrgMock).toHaveBeenCalledWith("user-1", expect.anything());
  });
});
