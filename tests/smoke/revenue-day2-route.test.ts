import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/revenue/day2/route";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { runDay2RevenueAutomation } from "@/lib/revenue/day2-automation";

vi.mock("@/lib/api/auth", () => ({
  requireFirebaseAuth: vi.fn(),
}));

vi.mock("@/lib/revenue/day2-automation", () => ({
  runDay2RevenueAutomation: vi.fn(),
}));

const requireAuthMock = vi.mocked(requireFirebaseAuth);
const runDay2Mock = vi.mocked(runDay2RevenueAutomation);

function createContext() {
  return { params: Promise.resolve({}) };
}

describe("revenue day2 route", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    requireAuthMock.mockResolvedValue({ uid: "user-1" } as Awaited<ReturnType<typeof requireFirebaseAuth>>);
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
        leadsScored: 6,
        followupsSeeded: 6,
        responseProcessed: 2,
        responseCompleted: 2,
        responseSkipped: 0,
        responseFailed: 0,
      },
      warnings: [],
    });
  });

  it("runs day2 automation for authenticated user", async () => {
    const req = new Request("http://localhost/api/revenue/day2", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        templateIds: ["rng-south-day1"],
        processDueResponses: true,
        responseLoopMaxTasks: 10,
      }),
    });

    const res = await POST(
      req as Parameters<typeof POST>[0],
      createContext() as Parameters<typeof POST>[1]
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.totals?.leadsScored).toBe(6);
    expect(runDay2Mock).toHaveBeenCalledOnce();
    const [args] = runDay2Mock.mock.calls[0] || [];
    expect(args?.uid).toBe("user-1");
    expect(args?.templateIds).toEqual(["rng-south-day1"]);
    expect(args?.processDueResponses).toBe(true);
  });

  it("returns 400 for invalid payload", async () => {
    const req = new Request("http://localhost/api/revenue/day2", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        templateIds: [],
      }),
    });

    const res = await POST(
      req as Parameters<typeof POST>[0],
      createContext() as Parameters<typeof POST>[1]
    );
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(String(data.error || "")).toContain("Invalid request body");
  });
});
