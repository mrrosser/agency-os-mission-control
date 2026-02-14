import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/lead-runs/[runId]/jobs/route";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { assertLeadRunOwner } from "@/lib/lead-runs/receipts";
import { getAdminDb } from "@/lib/firebase-admin";
import { triggerLeadRunWorker } from "@/lib/lead-runs/jobs";
import { ApiError } from "@/lib/api/handler";
import {
  acquireLeadRunConcurrencySlot,
  claimLeadRunQuota,
  releaseLeadRunConcurrencySlot,
  resolveLeadRunOrgId,
} from "@/lib/lead-runs/quotas";

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

vi.mock("@/lib/lead-runs/jobs", async () => {
  const actual = await vi.importActual<typeof import("@/lib/lead-runs/jobs")>(
    "@/lib/lead-runs/jobs"
  );
  return {
    ...actual,
    triggerLeadRunWorker: vi.fn(async () => undefined),
  };
});

vi.mock("@/lib/lead-runs/quotas", () => ({
  acquireLeadRunConcurrencySlot: vi.fn(async () => ({ activeRuns: 1, maxActiveRuns: 3 })),
  claimLeadRunQuota: vi.fn(async () => ({ windowKey: "2026-02-12", maxRunsPerDay: 30, maxLeadsPerDay: 400 })),
  releaseLeadRunConcurrencySlot: vi.fn(async () => undefined),
  resolveLeadRunOrgId: vi.fn(async () => "org-1"),
}));

const requireAuthMock = vi.mocked(requireFirebaseAuth);
const assertOwnerMock = vi.mocked(assertLeadRunOwner);
const getAdminDbMock = vi.mocked(getAdminDb);
const triggerLeadRunWorkerMock = vi.mocked(triggerLeadRunWorker);
const acquireLeadRunConcurrencySlotMock = vi.mocked(acquireLeadRunConcurrencySlot);
const claimLeadRunQuotaMock = vi.mocked(claimLeadRunQuota);
const releaseLeadRunConcurrencySlotMock = vi.mocked(releaseLeadRunConcurrencySlot);
const resolveLeadRunOrgIdMock = vi.mocked(resolveLeadRunOrgId);

function createContext(params: Record<string, string>) {
  return { params: Promise.resolve(params) };
}

describe("lead run jobs route", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    requireAuthMock.mockResolvedValue({ uid: "user-1" } as unknown as { uid: string });
    assertOwnerMock.mockResolvedValue(undefined);
    claimLeadRunQuotaMock.mockResolvedValue({ windowKey: "2026-02-12", maxRunsPerDay: 30, maxLeadsPerDay: 400 });
    acquireLeadRunConcurrencySlotMock.mockResolvedValue({ activeRuns: 1, maxActiveRuns: 3 });
    releaseLeadRunConcurrencySlotMock.mockResolvedValue(undefined);
    resolveLeadRunOrgIdMock.mockResolvedValue("org-1");
  });

  it("starts a background lead-run job", async () => {
    const jobSet = vi.fn(async () => undefined);

    const runRef = {
      get: vi.fn(async () => ({ exists: true, data: () => ({ userId: "user-1" }) })),
      collection: vi.fn((name: string) => {
        if (name === "jobs") {
          return {
            doc: vi.fn(() => ({
              get: vi.fn(async () => ({ exists: false })),
              set: jobSet,
            })),
          };
        }
        if (name === "leads") {
          return {
            get: vi.fn(async () => ({
              docs: [
                { id: "lead-1", data: () => ({ score: 90 }) },
                { id: "lead-2", data: () => ({ score: 60 }) },
              ],
            })),
          };
        }
        throw new Error(`unexpected subcollection: ${name}`);
      }),
    };

    getAdminDbMock.mockReturnValue({
      collection: vi.fn(() => ({
        doc: vi.fn(() => runRef),
      })),
    } as unknown as ReturnType<typeof getAdminDb>);

    const req = new Request("http://localhost/api/lead-runs/run-1/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "start", config: { dryRun: true, draftFirst: true, timeZone: "UTC" } }),
    });

    const res = await POST(
      req as unknown as Parameters<typeof POST>[0],
      createContext({ runId: "run-1" }) as unknown as Parameters<typeof POST>[1]
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.job.status).toBe("queued");
    expect(data.job.totalLeads).toBe(2);
    expect(jobSet).toHaveBeenCalledOnce();
    expect(triggerLeadRunWorkerMock).toHaveBeenCalledOnce();
    expect(resolveLeadRunOrgIdMock).toHaveBeenCalledWith("user-1", expect.anything());
    expect(claimLeadRunQuotaMock).toHaveBeenCalledTimes(1);
    expect(acquireLeadRunConcurrencySlotMock).toHaveBeenCalledTimes(1);
  });

  it("returns existing job status", async () => {
    const jobGet = vi.fn(async () => ({
      exists: true,
      data: () => ({
        runId: "run-2",
        userId: "user-1",
        status: "running",
        config: { dryRun: false, draftFirst: false, timeZone: "UTC" },
        leadDocIds: ["lead-a"],
        nextIndex: 0,
        totalLeads: 1,
        diagnostics: { processedLeads: 0, failedLeads: 0, noEmail: 0, noSlot: 0, meetingsScheduled: 0, meetingsDrafted: 0, emailsSent: 0, emailsDrafted: 0 },
      }),
    }));

    const runRef = {
      collection: vi.fn((name: string) => {
        if (name === "jobs") {
          return {
            doc: vi.fn(() => ({ get: jobGet })),
          };
        }
        throw new Error(`unexpected subcollection: ${name}`);
      }),
    };

    getAdminDbMock.mockReturnValue({
      collection: vi.fn(() => ({
        doc: vi.fn(() => runRef),
      })),
    } as unknown as ReturnType<typeof getAdminDb>);

    const req = new Request("http://localhost/api/lead-runs/run-2/jobs", { method: "GET" });
    const res = await GET(
      req as unknown as Parameters<typeof GET>[0],
      createContext({ runId: "run-2" }) as unknown as Parameters<typeof GET>[1]
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.job.status).toBe("running");
    expect(data.job.totalLeads).toBe(1);
  });

  it("returns 429 when active run concurrency cap is reached", async () => {
    const runRef = {
      get: vi.fn(async () => ({ exists: true, data: () => ({ userId: "user-1" }) })),
      collection: vi.fn((name: string) => {
        if (name === "jobs") {
          return {
            doc: vi.fn(() => ({
              get: vi.fn(async () => ({ exists: false })),
              set: vi.fn(async () => undefined),
            })),
          };
        }
        if (name === "leads") {
          return {
            get: vi.fn(async () => ({
              docs: [{ id: "lead-1", data: () => ({ score: 90 }) }],
            })),
          };
        }
        throw new Error(`unexpected subcollection: ${name}`);
      }),
      data: () => ({
        sourceDiagnostics: {
          fetchedTotal: 3,
          scoredTotal: 1,
          filteredByScore: 2,
          withEmail: 1,
          withoutEmail: 0,
        },
      }),
    };

    getAdminDbMock.mockReturnValue({
      collection: vi.fn(() => ({
        doc: vi.fn(() => runRef),
      })),
    } as unknown as ReturnType<typeof getAdminDb>);

    acquireLeadRunConcurrencySlotMock.mockRejectedValue(
      new ApiError(429, "Too many concurrent active runs (3).")
    );

    const req = new Request("http://localhost/api/lead-runs/run-3/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "start", config: { dryRun: true } }),
    });

    const res = await POST(
      req as unknown as Parameters<typeof POST>[0],
      createContext({ runId: "run-3" }) as unknown as Parameters<typeof POST>[1]
    );
    const data = await res.json();

    expect(res.status).toBe(429);
    expect(String(data.error || "")).toContain("Too many concurrent active runs");
  });
});
