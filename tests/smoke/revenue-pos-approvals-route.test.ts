import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/revenue/pos/approvals/route";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { getAdminDb } from "@/lib/firebase-admin";
import { setPosWorkerApproval } from "@/lib/revenue/pos-worker";

vi.mock("@/lib/api/auth", () => ({
  requireFirebaseAuth: vi.fn(),
}));

vi.mock("@/lib/firebase-admin", () => ({
  getAdminDb: vi.fn(),
}));

vi.mock("@/lib/revenue/pos-worker", () => ({
  setPosWorkerApproval: vi.fn(),
}));

const requireAuthMock = vi.mocked(requireFirebaseAuth);
const getAdminDbMock = vi.mocked(getAdminDb);
const setPosWorkerApprovalMock = vi.mocked(setPosWorkerApproval);

function createContext() {
  return { params: Promise.resolve({}) };
}

describe("revenue pos approvals route", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    requireAuthMock.mockResolvedValue({ uid: "user-1" } as Awaited<ReturnType<typeof requireFirebaseAuth>>);
    setPosWorkerApprovalMock.mockResolvedValue(undefined);

    const idempotencyStore = new Map<string, Record<string, unknown>>();
    getAdminDbMock.mockReturnValue({
      collection: (name: string) => {
        if (name !== "idempotency") {
          throw new Error(`unexpected collection: ${name}`);
        }
        return {
          doc: (id: string) => ({
            get: async () => ({
              exists: idempotencyStore.has(id),
              data: () => idempotencyStore.get(id),
            }),
            set: async (data: Record<string, unknown>) => {
              idempotencyStore.set(id, data);
            },
          }),
        };
      },
    } as unknown as ReturnType<typeof getAdminDb>);
  });

  it("records approval decisions with idempotency", async () => {
    const request = new Request("http://localhost/api/revenue/pos/approvals", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-idempotency-key": "pos-approval-1",
      },
      body: JSON.stringify({
        eventId: "evt-1",
        actionKind: "refund.review.queue",
        approved: true,
        note: "Approved by operator",
      }),
    });

    const response = await POST(
      request as Parameters<typeof POST>[0],
      createContext() as Parameters<typeof POST>[1]
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.replayed).toBe(false);
    expect(setPosWorkerApprovalMock).toHaveBeenCalledWith({
      uid: "user-1",
      eventId: "evt-1",
      actionKind: "refund.review.queue",
      approved: true,
      note: "Approved by operator",
      actorUid: "user-1",
      correlationId: expect.any(String),
    });
  });
});
