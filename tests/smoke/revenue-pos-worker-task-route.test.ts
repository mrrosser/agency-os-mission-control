import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/revenue/pos/worker-task/route";
import { runPosOutboxCycle, runPosWorkerCycle } from "@/lib/revenue/pos-worker";
import {
  authorizeRevenueAutomationWorker,
  resolveRevenueAutomationWorkerUid,
} from "@/lib/revenue/worker-auth";

vi.mock("@/lib/revenue/pos-worker", () => ({
  runPosWorkerCycle: vi.fn(),
  runPosOutboxCycle: vi.fn(),
}));

vi.mock("@/lib/revenue/worker-auth", () => ({
  authorizeRevenueAutomationWorker: vi.fn(),
  resolveRevenueAutomationWorkerUid: vi.fn(),
}));

const runPosWorkerCycleMock = vi.mocked(runPosWorkerCycle);
const runPosOutboxCycleMock = vi.mocked(runPosOutboxCycle);
const authorizeWorkerMock = vi.mocked(authorizeRevenueAutomationWorker);
const resolveWorkerUidMock = vi.mocked(resolveRevenueAutomationWorkerUid);
const ORIGINAL_OUTBOX_EXECUTE = process.env.POS_WORKER_EXECUTE_OUTBOX;

function createContext() {
  return { params: Promise.resolve({}) };
}

describe("revenue pos worker-task route", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    authorizeWorkerMock.mockResolvedValue({ mode: "oidc", principalHash: "abc123def456" });
    resolveWorkerUidMock.mockReturnValue("user-1");
    runPosWorkerCycleMock.mockResolvedValue({
      uid: "user-1",
      workerId: "worker-1",
      attempted: 2,
      completed: 2,
      blocked: 0,
      deadLettered: 0,
      skipped: 0,
      replayedActions: 0,
      queuedOutboxActions: 1,
      correlationId: "cid-1",
    });
    runPosOutboxCycleMock.mockResolvedValue({
      uid: "user-1",
      workerId: "worker-1",
      attempted: 1,
      completed: 1,
      deadLettered: 0,
      skipped: 0,
      replayedTasks: 0,
      queuedTasks: 1,
      correlationId: "cid-1",
    });
    delete process.env.POS_WORKER_EXECUTE_OUTBOX;
  });

  it("runs the worker cycle under the server-configured identity when OIDC-authorized", async () => {
    const request = new Request("http://localhost/api/revenue/pos/worker-task", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer signed-oidc-token",
      },
      body: JSON.stringify({ limit: 10 }),
    });

    const response = await POST(
      request as Parameters<typeof POST>[0],
      createContext() as Parameters<typeof POST>[1]
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.authMode).toBe("oidc");
    expect(payload.cycle.uid).toBe("user-1");
    expect(authorizeWorkerMock).toHaveBeenCalledOnce();
    expect(resolveWorkerUidMock).toHaveBeenCalledWith(undefined);
    expect(runPosWorkerCycleMock).toHaveBeenCalledWith(
      expect.objectContaining({ uid: "user-1", limit: 10 })
    );
    expect(runPosWorkerCycleMock).toHaveBeenCalledTimes(1);
    expect(runPosOutboxCycleMock).not.toHaveBeenCalled();
  });

  it("runs outbox cycle when enabled via env fallback", async () => {
    process.env.POS_WORKER_EXECUTE_OUTBOX = "true";

    const request = new Request("http://localhost/api/revenue/pos/worker-task", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer signed-oidc-token",
      },
      body: JSON.stringify({ limit: 10 }),
    });

    const response = await POST(
      request as Parameters<typeof POST>[0],
      createContext() as Parameters<typeof POST>[1]
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.outboxCycle?.queuedTasks).toBe(1);
    expect(runPosOutboxCycleMock).toHaveBeenCalledTimes(1);
  });

  it("fails closed before queue work when OIDC authorization is rejected", async () => {
    authorizeWorkerMock.mockRejectedValueOnce(
      Object.assign(new Error("Forbidden"), { status: 403 })
    );
    const request = new Request("http://localhost/api/revenue/pos/worker-task", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    });

    const response = await POST(
      request as Parameters<typeof POST>[0],
      createContext() as Parameters<typeof POST>[1]
    );
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(String(payload.error || "")).toContain("Forbidden");
    expect(runPosWorkerCycleMock).not.toHaveBeenCalled();
    expect(runPosOutboxCycleMock).not.toHaveBeenCalled();
  });

  it("rejects caller identity substitution before queue work", async () => {
    resolveWorkerUidMock.mockImplementationOnce(() => {
      throw Object.assign(new Error("Worker uid must match the configured revenue automation identity."), {
        status: 400,
      });
    });
    const request = new Request("http://localhost/api/revenue/pos/worker-task", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer signed-oidc-token",
      },
      body: JSON.stringify({ uid: "other-user" }),
    });

    const response = await POST(
      request as Parameters<typeof POST>[0],
      createContext() as Parameters<typeof POST>[1]
    );

    expect(response.status).toBe(400);
    expect(resolveWorkerUidMock).toHaveBeenCalledWith("other-user");
    expect(runPosWorkerCycleMock).not.toHaveBeenCalled();
    expect(runPosOutboxCycleMock).not.toHaveBeenCalled();
  });

  afterAll(() => {
    if (typeof ORIGINAL_OUTBOX_EXECUTE === "string") {
      process.env.POS_WORKER_EXECUTE_OUTBOX = ORIGINAL_OUTBOX_EXECUTE;
    } else {
      delete process.env.POS_WORKER_EXECUTE_OUTBOX;
    }
  });
});
