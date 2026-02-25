import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/revenue/pos/worker-task/route";
import { runPosOutboxCycle, runPosWorkerCycle } from "@/lib/revenue/pos-worker";

vi.mock("@/lib/revenue/pos-worker", () => ({
  runPosWorkerCycle: vi.fn(),
  runPosOutboxCycle: vi.fn(),
}));

const runPosWorkerCycleMock = vi.mocked(runPosWorkerCycle);
const runPosOutboxCycleMock = vi.mocked(runPosOutboxCycle);
const ORIGINAL_TOKEN = process.env.REVENUE_POS_WORKER_TOKEN;
const ORIGINAL_OUTBOX_EXECUTE = process.env.POS_WORKER_EXECUTE_OUTBOX;

function createContext() {
  return { params: Promise.resolve({}) };
}

describe("revenue pos worker-task route", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.REVENUE_POS_WORKER_TOKEN = "pos-worker-token";
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

  it("runs the worker cycle when authorized", async () => {
    const request = new Request("http://localhost/api/revenue/pos/worker-task", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-revenue-pos-token": "pos-worker-token",
      },
      body: JSON.stringify({ uid: "user-1", limit: 10 }),
    });

    const response = await POST(
      request as Parameters<typeof POST>[0],
      createContext() as Parameters<typeof POST>[1]
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.cycle.uid).toBe("user-1");
    expect(runPosWorkerCycleMock).toHaveBeenCalledTimes(1);
    expect(runPosOutboxCycleMock).not.toHaveBeenCalled();
  });

  it("runs outbox cycle when enabled via env fallback", async () => {
    process.env.POS_WORKER_EXECUTE_OUTBOX = "true";

    const request = new Request("http://localhost/api/revenue/pos/worker-task", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-revenue-pos-token": "pos-worker-token",
      },
      body: JSON.stringify({ uid: "user-1", limit: 10 }),
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

  it("fails closed when token is invalid", async () => {
    const request = new Request("http://localhost/api/revenue/pos/worker-task", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-revenue-pos-token": "wrong-token",
      },
      body: JSON.stringify({ uid: "user-1" }),
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

  afterAll(() => {
    if (typeof ORIGINAL_TOKEN === "string") {
      process.env.REVENUE_POS_WORKER_TOKEN = ORIGINAL_TOKEN;
    } else {
      delete process.env.REVENUE_POS_WORKER_TOKEN;
    }
    if (typeof ORIGINAL_OUTBOX_EXECUTE === "string") {
      process.env.POS_WORKER_EXECUTE_OUTBOX = ORIGINAL_OUTBOX_EXECUTE;
    } else {
      delete process.env.POS_WORKER_EXECUTE_OUTBOX;
    }
  });
});
