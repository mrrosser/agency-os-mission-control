import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/handler";
import { POST } from "@/app/api/revenue/daily-outcomes/worker-task/route";
import { evaluateDailyOutcomesForRevenueWorker } from "@/lib/revenue/daily-outcome-worker";
import {
  authorizeRevenueAutomationWorker,
  resolveRevenueAutomationWorkerUid,
} from "@/lib/revenue/worker-auth";

vi.mock("@/lib/revenue/daily-outcome-worker", () => ({
  evaluateDailyOutcomesForRevenueWorker: vi.fn(),
}));

vi.mock("@/lib/revenue/worker-auth", () => ({
  authorizeRevenueAutomationWorker: vi.fn(),
  resolveRevenueAutomationWorkerUid: vi.fn(),
}));

const authorizeWorkerMock = vi.mocked(authorizeRevenueAutomationWorker);
const resolveWorkerUidMock = vi.mocked(resolveRevenueAutomationWorkerUid);
const evaluateDailyOutcomesMock = vi.mocked(evaluateDailyOutcomesForRevenueWorker);

function createContext() {
  return { params: Promise.resolve({}) };
}

function makeRequest(body: Record<string, unknown> = {}): Request {
  return new Request("https://example.com/api/revenue/daily-outcomes/worker-task", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer oidc-token" },
    body: JSON.stringify(body),
  });
}

describe("revenue daily outcomes worker-task route", () => {
  beforeEach(() => {
    authorizeWorkerMock.mockReset();
    resolveWorkerUidMock.mockReset();
    evaluateDailyOutcomesMock.mockReset();
    authorizeWorkerMock.mockResolvedValue({ mode: "oidc", principalHash: "abc123def456" });
    resolveWorkerUidMock.mockReturnValue("worker-uid");
    evaluateDailyOutcomesMock.mockResolvedValue({
      asOf: "2026-08-07T11:00:00.000Z",
      timeZone: "America/Chicago",
      outcomes: [
        { businessUnit: "rosser_nft_gallery", status: "at_risk", outcomeId: "rosser" },
        { businessUnit: "rt_solutions", status: "not_observed", outcomeId: "rt" },
      ],
    } as Awaited<ReturnType<typeof evaluateDailyOutcomesForRevenueWorker>>);
  });

  it("evaluates both canonical organizations under the configured worker identity", async () => {
    const response = await POST(
      makeRequest() as Parameters<typeof POST>[0],
      createContext() as Parameters<typeof POST>[1]
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toMatchObject({
      ok: true,
      authMode: "oidc",
      timeZone: "America/Chicago",
    });
    expect(data.outcomes).toHaveLength(2);
    expect(evaluateDailyOutcomesMock).toHaveBeenCalledWith(
      expect.objectContaining({ uid: "worker-uid" })
    );
  });

  it("fails before evaluation when OIDC authentication is rejected", async () => {
    authorizeWorkerMock.mockRejectedValueOnce(
      Object.assign(new Error("Forbidden"), { status: 403 })
    );

    const response = await POST(
      makeRequest() as Parameters<typeof POST>[0],
      createContext() as Parameters<typeof POST>[1]
    );

    expect(response.status).toBe(403);
    expect(evaluateDailyOutcomesMock).not.toHaveBeenCalled();
  });

  it("rejects caller-controlled fields", async () => {
    const response = await POST(
      makeRequest({ uid: "other-user" }) as Parameters<typeof POST>[0],
      createContext() as Parameters<typeof POST>[1]
    );

    expect(response.status).toBe(400);
    expect(evaluateDailyOutcomesMock).not.toHaveBeenCalled();
  });

  it("returns a retryable failure when a critical source read is unavailable", async () => {
    evaluateDailyOutcomesMock.mockRejectedValueOnce(
      new ApiError(503, "Daily outcome source reads were unavailable")
    );

    const response = await POST(
      makeRequest() as Parameters<typeof POST>[0],
      createContext() as Parameters<typeof POST>[1]
    );

    expect(response.status).toBe(503);
  });
});
