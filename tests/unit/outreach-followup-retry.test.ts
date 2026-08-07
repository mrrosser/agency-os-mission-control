import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  assertLeadRunOwnerMock,
  createDraftEmailMock,
  findDncMatchMock,
  getAccessTokenForUserMock,
  getAdminDbMock,
  loadLeadRunJobMock,
  recordLeadActionReceiptMock,
  withIdempotencyMock,
} = vi.hoisted(() => ({
  assertLeadRunOwnerMock: vi.fn(),
  createDraftEmailMock: vi.fn(),
  findDncMatchMock: vi.fn(),
  getAccessTokenForUserMock: vi.fn(),
  getAdminDbMock: vi.fn(),
  loadLeadRunJobMock: vi.fn(),
  recordLeadActionReceiptMock: vi.fn(),
  withIdempotencyMock: vi.fn(),
}));

vi.mock("@/lib/firebase-admin", () => ({
  getAdminDb: getAdminDbMock,
}));

vi.mock("@/lib/api/idempotency", () => ({
  withIdempotency: withIdempotencyMock,
}));

vi.mock("@/lib/google/gmail", () => ({
  createDraftEmail: createDraftEmailMock,
}));

vi.mock("@/lib/google/oauth", () => ({
  getAccessTokenForUser: getAccessTokenForUserMock,
}));

vi.mock("@/lib/lead-runs/jobs", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/lead-runs/jobs")>();
  return {
    ...original,
    loadLeadRunJob: loadLeadRunJobMock,
  };
});

vi.mock("@/lib/lead-runs/receipts", () => ({
  assertLeadRunOwner: assertLeadRunOwnerMock,
  recordLeadActionReceipt: recordLeadActionReceiptMock,
}));

vi.mock("@/lib/outreach/dnc", () => ({
  findDncMatch: findDncMatchMock,
}));

import { processDueFollowupDraftTasks } from "@/lib/outreach/followups";

function installFollowupStore(attempts: number) {
  const taskSetMock = vi.fn(
    async (_data: Record<string, unknown>, _options?: { merge: boolean }) => undefined
  );
  const taskData = {
    runId: "run-1",
    leadDocId: "lead-1",
    uid: "uid-1",
    sequence: 1,
    branch: "standard",
    status: "pending",
    dueAtMs: Date.now() - 1_000,
    attempts,
    lead: {
      email: "lead@example.com",
      founderName: "Taylor",
      companyName: "Example Co",
      businessUnit: "rt_solutions",
    },
  };
  const followupTasks = {
    orderBy: vi.fn(() => ({
      limit: vi.fn(() => ({
        get: vi.fn(async () => ({
          docs: [{ id: "task-1", data: () => taskData }],
        })),
      })),
    })),
    doc: vi.fn(() => ({ set: taskSetMock })),
  };
  const transaction = {
    get: vi.fn(async () => ({
      exists: true,
      data: () => taskData,
    })),
    set: vi.fn(),
  };

  getAdminDbMock.mockReturnValue({
    collection: vi.fn((collectionName: string) => {
      if (collectionName === "identities") {
        return {
          doc: vi.fn(() => ({
            get: vi.fn(async () => ({ data: () => ({}) })),
          })),
        };
      }
      if (collectionName === "lead_runs") {
        return {
          doc: vi.fn(() => ({
            collection: vi.fn((subcollectionName: string) => {
              if (subcollectionName === "followup_tasks") return followupTasks;
              throw new Error(`Unexpected subcollection: ${subcollectionName}`);
            }),
          })),
        };
      }
      throw new Error(`Unexpected collection: ${collectionName}`);
    }),
    runTransaction: vi.fn(
      async (executor: (tx: typeof transaction) => Promise<unknown>) => executor(transaction)
    ),
  });

  return { taskSetMock };
}

describe("follow-up task failure recovery", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    delete process.env.FOLLOWUPS_MAX_ATTEMPTS;
    assertLeadRunOwnerMock.mockResolvedValue(undefined);
    findDncMatchMock.mockResolvedValue(null);
    getAccessTokenForUserMock.mockResolvedValue("access-token");
    loadLeadRunJobMock.mockResolvedValue({ config: { businessKey: "rts" } });
    createDraftEmailMock.mockRejectedValue(new Error("temporary Gmail failure"));
    withIdempotencyMock.mockImplementation(async (_args, executor) => ({
      data: await executor(),
      replayed: false,
    }));
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("requeues a failed draft with bounded backoff before the attempt limit", async () => {
    const startedAt = Date.now();
    const { taskSetMock } = installFollowupStore(0);

    const result = await processDueFollowupDraftTasks({
      runId: "run-1",
      orgId: "org-1",
      uid: "uid-1",
      maxTasks: 5,
      dryRun: false,
    });

    expect(result).toMatchObject({ processed: 1, completed: 0, failed: 1 });
    expect(taskSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "pending",
        lastError: "temporary Gmail failure",
        dueAtMs: expect.any(Number),
      }),
      { merge: true }
    );
    const retryAtMs = Number(taskSetMock.mock.calls[0]?.[0]?.dueAtMs);
    expect(retryAtMs).toBeGreaterThanOrEqual(startedAt + 60_000);
    expect(retryAtMs).toBeLessThan(startedAt + 61_000);
  });

  it("moves the task to terminal failure after the third attempt", async () => {
    const { taskSetMock } = installFollowupStore(2);

    await processDueFollowupDraftTasks({
      runId: "run-1",
      orgId: "org-1",
      uid: "uid-1",
      maxTasks: 5,
      dryRun: false,
    });

    expect(taskSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "failed",
        lastError: "temporary Gmail failure",
      }),
      { merge: true }
    );
    expect(taskSetMock.mock.calls[0]?.[0]).not.toHaveProperty("dueAtMs");
  });
});
