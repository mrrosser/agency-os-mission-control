import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/revenue/day2/worker-task/route";
import { runDay2RevenueAutomation } from "@/lib/revenue/day2-automation";
import { ApiError } from "@/lib/api/handler";
import {
  authorizeRevenueAutomationWorker,
  resolveRevenueAutomationWorkerUid,
} from "@/lib/revenue/worker-auth";

vi.mock("@/lib/revenue/day2-automation", () => ({
  runDay2RevenueAutomation: vi.fn(),
}));
vi.mock("@/lib/revenue/worker-auth", () => ({
  authorizeRevenueAutomationWorker: vi.fn(),
  resolveRevenueAutomationWorkerUid: vi.fn(),
}));

const runDay2Mock = vi.mocked(runDay2RevenueAutomation);
const authorizeMock = vi.mocked(authorizeRevenueAutomationWorker);
const resolveUidMock = vi.mocked(resolveRevenueAutomationWorkerUid);

function createContext() {
  return { params: Promise.resolve({}) };
}

describe("revenue day2 worker-task route", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
    authorizeMock.mockResolvedValue({ mode: "oidc", principalHash: "principal" });
    resolveUidMock.mockReturnValue("configured-worker-uid");

    runDay2Mock.mockResolvedValue({
      uid: "user-1",
      dateKey: "2026-02-25",
      dryRun: false,
      processDueResponses: true,
      requireApprovalGates: true,
      templates: [],
      totals: {
        templatesAttempted: 1,
        templatesSucceeded: 1,
        leadsScored: 7,
        followupsSeeded: 7,
        responseProcessed: 3,
        responseCompleted: 3,
        responseSkipped: 0,
        responseFailed: 0,
      },
      warnings: [],
    });
  });

  it("rejects failed shared worker authentication", async () => {
    authorizeMock.mockRejectedValue(new ApiError(403, "Forbidden"));
    const req = new Request("http://localhost/api/revenue/day2/worker-task", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        templateIds: ["rng-south-day1"],
      }),
    });

    const res = await POST(
      req as Parameters<typeof POST>[0],
      createContext() as Parameters<typeof POST>[1]
    );
    const data = await res.json();

    expect(res.status).toBe(403);
    expect(data.error).toBe("Forbidden");
  });

  it("runs with signed worker auth and the server-configured uid", async () => {
    const req = new Request("http://localhost/api/revenue/day2/worker-task", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer signed-oidc-token",
      },
      body: JSON.stringify({
        templateIds: ["rng-south-day1"],
        dryRun: false,
        requireApprovalGates: false,
        processDueResponses: true,
      }),
    });

    const res = await POST(
      req as Parameters<typeof POST>[0],
      createContext() as Parameters<typeof POST>[1]
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.authMode).toBe("oidc");
    expect(runDay2Mock).toHaveBeenCalledOnce();
    const [args] = runDay2Mock.mock.calls[0] || [];
    expect(args).toMatchObject({
      uid: "configured-worker-uid",
      templateIds: ["rng-south-day1"],
      dryRun: false,
      requireApprovalGates: true,
      processDueResponses: true,
    });
  });

  it("runs dry-run flow with approval gates still enabled", async () => {
    const req = new Request("http://localhost/api/revenue/day2/worker-task", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer signed-oidc-token",
      },
      body: JSON.stringify({
        templateIds: ["rng-south-day1"],
        dryRun: true,
        requireApprovalGates: true,
        processDueResponses: false,
      }),
    });

    const res = await POST(
      req as Parameters<typeof POST>[0],
      createContext() as Parameters<typeof POST>[1]
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(runDay2Mock).toHaveBeenCalledOnce();
    const [args] = runDay2Mock.mock.calls[0] || [];
    expect(args).toMatchObject({
      uid: "configured-worker-uid",
      templateIds: ["rng-south-day1"],
      dryRun: true,
      requireApprovalGates: true,
      processDueResponses: false,
    });
  });

  it("rejects caller substitution of the configured worker uid", async () => {
    resolveUidMock.mockImplementation(() => {
      throw new ApiError(400, "Worker uid must match the configured revenue automation identity.");
    });
    const req = new Request("http://localhost/api/revenue/day2/worker-task", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer signed-oidc-token" },
      body: JSON.stringify({ uid: "other-user", templateIds: ["rng-south-day1"] }),
    });

    const res = await POST(req as Parameters<typeof POST>[0], createContext() as Parameters<typeof POST>[1]);
    expect(res.status).toBe(400);
    expect(runDay2Mock).not.toHaveBeenCalled();
  });
});
