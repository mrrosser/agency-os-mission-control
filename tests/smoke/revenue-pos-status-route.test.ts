import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/revenue/pos/status/route";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { getPosWorkerStatus } from "@/lib/revenue/pos-worker";

vi.mock("@/lib/api/auth", () => ({
  requireFirebaseAuth: vi.fn(),
}));

vi.mock("@/lib/revenue/pos-worker", () => ({
  getPosWorkerStatus: vi.fn(),
}));

const requireAuthMock = vi.mocked(requireFirebaseAuth);
const getPosWorkerStatusMock = vi.mocked(getPosWorkerStatus);

function createContext() {
  return { params: Promise.resolve({}) };
}

describe("revenue pos status route", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    requireAuthMock.mockResolvedValue({ uid: "user-1" } as Awaited<ReturnType<typeof requireFirebaseAuth>>);
    getPosWorkerStatusMock.mockResolvedValue({
      generatedAt: "2026-02-24T00:00:00.000Z",
      uid: "user-1",
      policy: {
        allowSideEffects: false,
        autoApproveLowRisk: true,
        requireApprovalForHighRisk: true,
      },
      supportedEventPrefixes: ["PAYMENT.", "INVOICE.", "REFUND.", "ORDER."],
      summary: {
        health: "operational",
        detail: "Webhook feed active and queue healthy.",
        queuedEvents: 0,
        processingEvents: 0,
        blockedEvents: 0,
        deadLetterEvents: 0,
        completedEvents: 3,
        oldestPendingSeconds: 0,
        outboxQueued: 0,
        lastWebhookAt: "2026-02-24T00:00:00.000Z",
        lastProcessedAt: "2026-02-24T00:00:00.000Z",
        lastRunAt: "2026-02-24T00:00:00.000Z",
      },
    });
  });

  it("returns the POS worker status snapshot for the authenticated user", async () => {
    const request = new Request("http://localhost/api/revenue/pos/status", { method: "GET" });
    const response = await GET(
      request as Parameters<typeof GET>[0],
      createContext() as Parameters<typeof GET>[1]
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.snapshot.summary.health).toBe("operational");
    expect(getPosWorkerStatusMock).toHaveBeenCalledWith({
      uid: "user-1",
      log: expect.anything(),
    });
  });
});
