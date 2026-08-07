import { beforeEach, describe, expect, it, vi } from "vitest";
import { getAdminDb } from "@/lib/firebase-admin";
import {
  AutonomyPolicyVersionConflictError,
  updateAutonomyPolicy,
} from "@/lib/agents/autonomy-policy-store";

vi.mock("@/lib/firebase-admin", () => ({
  getAdminDb: vi.fn(),
}));

const getAdminDbMock = vi.mocked(getAdminDb);

describe("autonomy policy store", () => {
  const transactionSet = vi.fn();
  const transactionGet = vi.fn();
  const historyDoc = vi.fn((auditId: string) => ({ path: `history/${auditId}` }));
  const policyRef = {
    path: "agentAutonomyPolicies/user-1",
    collection: vi.fn(() => ({ doc: historyDoc })),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    getAdminDbMock.mockReturnValue({
      collection: vi.fn(() => ({ doc: vi.fn(() => policyRef) })),
      runTransaction: vi.fn(async (callback) =>
        callback({
          get: transactionGet,
          set: transactionSet,
        })
      ),
    } as unknown as ReturnType<typeof getAdminDb>);
  });

  it("atomically writes the next version and an audit entry", async () => {
    transactionGet.mockResolvedValue({
      exists: true,
      data: () => ({
        uid: "user-1",
        version: 3,
        globalKillSwitch: false,
        businessModes: {
          rt_solutions: "assist",
          rosser_gallery: "supervised",
        },
        updatedAt: "2026-08-06T12:00:00.000Z",
        updatedByUid: "user-1",
      }),
    });

    const result = await updateAutonomyPolicy({
      uid: "user-1",
      actorUid: "user-1",
      expectedVersion: 3,
      globalKillSwitch: true,
      businessModes: {
        rt_solutions: "supervised",
        rosser_gallery: "assist",
      },
      executionEnvelope: {
        agentId: "mission-control/operator",
        scope: ["agent.autonomy_policy.update"],
        trustLevel: "high",
        evidenceRef: "operator:mobile-settings",
      },
      correlationId: "corr-1",
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    expect(result.policy.version).toBe(4);
    expect(result.policy.globalKillSwitch).toBe(true);
    expect(transactionSet).toHaveBeenCalledTimes(2);
    expect(transactionSet.mock.calls[0]?.[1]).toMatchObject({
      uid: "user-1",
      version: 4,
      updatedByUid: "user-1",
    });
    expect(transactionSet.mock.calls[1]?.[1]).toMatchObject({
      uid: "user-1",
      actorUid: "user-1",
      correlationId: "corr-1",
      beforeVersion: 3,
      afterVersion: 4,
    });
  });

  it("rejects a stale optimistic version without writing", async () => {
    transactionGet.mockResolvedValue({
      exists: true,
      data: () => ({
        uid: "user-1",
        version: 5,
        globalKillSwitch: false,
        businessModes: {
          rt_solutions: "assist",
          rosser_gallery: "assist",
        },
      }),
    });

    await expect(
      updateAutonomyPolicy({
        uid: "user-1",
        actorUid: "user-1",
        expectedVersion: 4,
        globalKillSwitch: false,
        businessModes: {
          rt_solutions: "assist",
          rosser_gallery: "assist",
        },
        executionEnvelope: {
          agentId: "mission-control/operator",
          scope: ["agent.autonomy_policy.update"],
          trustLevel: "high",
          evidenceRef: "operator:mobile-settings",
        },
        correlationId: "corr-2",
        log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      })
    ).rejects.toEqual(expect.any(AutonomyPolicyVersionConflictError));
    expect(transactionSet).not.toHaveBeenCalled();
  });
});
