import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  assertLeadRunOwnerMock,
  getAccessTokenForUserMock,
  getAdminDbMock,
  loadLeadRunJobMock,
} = vi.hoisted(() => ({
  assertLeadRunOwnerMock: vi.fn(),
  getAccessTokenForUserMock: vi.fn(),
  getAdminDbMock: vi.fn(),
  loadLeadRunJobMock: vi.fn(),
}));

vi.mock("@/lib/firebase-admin", () => ({
  getAdminDb: getAdminDbMock,
}));

vi.mock("@/lib/google/oauth", () => ({
  getAccessTokenForUser: getAccessTokenForUserMock,
}));

vi.mock("@/lib/lead-runs/receipts", () => ({
  assertLeadRunOwner: assertLeadRunOwnerMock,
  recordLeadActionReceipt: vi.fn(),
}));

vi.mock("@/lib/lead-runs/jobs", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/lead-runs/jobs")>();
  return {
    ...original,
    loadLeadRunJob: loadLeadRunJobMock,
  };
});

import { processDueFollowupDraftTasks } from "@/lib/outreach/followups";

function mockFollowupStore(
  tasks: Array<{ id: string; data: Record<string, unknown> }> = []
) {
  const tasksGetMock = vi.fn(async () => ({
    docs: tasks.map((task) => ({
      id: task.id,
      data: () => task.data,
    })),
  }));
  const tasksQuery = {
    orderBy: vi.fn(() => ({
      limit: vi.fn(() => ({ get: tasksGetMock })),
    })),
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
              if (subcollectionName !== "followup_tasks") {
                throw new Error(`Unexpected subcollection: ${subcollectionName}`);
              }
              return tasksQuery;
            }),
          })),
        };
      }

      throw new Error(`Unexpected collection: ${collectionName}`);
    }),
  });
}

describe("follow-up Google work-profile routing", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.LEAD_RUNS_GOOGLE_PROFILE_RT;
    delete process.env.LEAD_RUNS_GOOGLE_PROFILE_RTS;
    delete process.env.LEAD_RUNS_GOOGLE_PROFILE_RNG;
    delete process.env.LEAD_RUNS_GOOGLE_PROFILE_AICF;
    vi.clearAllMocks();
    assertLeadRunOwnerMock.mockResolvedValue(undefined);
    getAccessTokenForUserMock.mockResolvedValue("access-token");
    mockFollowupStore();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it.each([
    ["rts", "rt_solutions_work"],
    ["rt", "rt_solutions_work"],
    ["rng", "rosser_gallery_work"],
  ] as const)("uses the %s lane profile for live draft processing", async (businessKey, profileId) => {
    loadLeadRunJobMock.mockResolvedValue({
      config: { businessKey },
    });

    await processDueFollowupDraftTasks({
      runId: `run-${businessKey}`,
      orgId: "org-1",
      uid: "uid-1",
      maxTasks: 5,
      dryRun: false,
    });

    expect(getAccessTokenForUserMock).toHaveBeenCalledWith(
      "uid-1",
      undefined,
      { profileId }
    );
  });

  it("fails closed for a retired AICF follow-up job", async () => {
    loadLeadRunJobMock.mockResolvedValue({
      config: { businessKey: "aicf" },
    });

    await expect(
      processDueFollowupDraftTasks({
        runId: "run-aicf",
        orgId: "org-1",
        uid: "uid-1",
        maxTasks: 5,
        dryRun: false,
      })
    ).rejects.toMatchObject({ status: 409, message: "The AICF lead-run lane is retired" });

    expect(getAccessTokenForUserMock).not.toHaveBeenCalled();
  });

  it("does not let an old AICF profile override reactivate the retired lane", async () => {
    process.env.LEAD_RUNS_GOOGLE_PROFILE_AICF = "aicf_work";
    loadLeadRunJobMock.mockResolvedValue({
      config: { businessKey: "aicf" },
    });

    await expect(
      processDueFollowupDraftTasks({
        runId: "run-aicf-override",
        orgId: "org-1",
        uid: "uid-1",
        maxTasks: 5,
        dryRun: false,
      })
    ).rejects.toMatchObject({ status: 409, message: "The AICF lead-run lane is retired" });

    expect(getAccessTokenForUserMock).not.toHaveBeenCalled();
  });

  it.each([
    ["rt_solutions", "rt_solutions_work"],
    ["rosser_nft_gallery", "rosser_gallery_work"],
    ["rosser_gallery", "rosser_gallery_work"],
  ] as const)("derives the profile from businessUnit %s when businessKey is absent", async (businessUnit, profileId) => {
    loadLeadRunJobMock.mockResolvedValue({
      config: { businessUnit },
    });

    await processDueFollowupDraftTasks({
      runId: `run-${businessUnit}`,
      orgId: "org-1",
      uid: "uid-1",
      maxTasks: 5,
      dryRun: false,
    });

    expect(getAccessTokenForUserMock).toHaveBeenCalledWith(
      "uid-1",
      undefined,
      { profileId }
    );
  });

  it("derives the profile from follow-up task context for a historical job", async () => {
    mockFollowupStore([
      {
        id: "task-1",
        data: {
          uid: "uid-1",
          status: "pending",
          dueAtMs: Date.now() + 60_000,
          lead: { businessUnit: "rt_solutions" },
        },
      },
    ]);
    loadLeadRunJobMock.mockResolvedValue({ config: {} });

    await processDueFollowupDraftTasks({
      runId: "historical-run-with-task-context",
      orgId: "org-1",
      uid: "uid-1",
      maxTasks: 5,
      dryRun: false,
    });

    expect(getAccessTokenForUserMock).toHaveBeenCalledWith(
      "uid-1",
      undefined,
      { profileId: "rt_solutions_work" }
    );
  });

  it("preserves the legacy token path when a historical job has no context", async () => {
    loadLeadRunJobMock.mockResolvedValue({ config: {} });

    await processDueFollowupDraftTasks({
      runId: "historical-run-no-context",
      orgId: "org-1",
      uid: "uid-1",
      maxTasks: 5,
      dryRun: false,
    });

    expect(getAccessTokenForUserMock).toHaveBeenCalledWith(
      "uid-1",
      undefined,
      { profileId: null }
    );
  });

  it.each([
    [{ businessKey: "unknown" }, "Unsupported lead-run businessKey"],
    [
      { businessKey: "rng", businessUnit: "rt_solutions" },
      "conflicts with businessUnit",
    ],
  ])("fails closed for malformed modern job context %#", async (config, message) => {
    loadLeadRunJobMock.mockResolvedValue({ config });

    await expect(
      processDueFollowupDraftTasks({
        runId: "malformed-run",
        orgId: "org-1",
        uid: "uid-1",
        maxTasks: 5,
        dryRun: false,
      })
    ).rejects.toEqual(
      expect.objectContaining({
        status: 409,
        message: expect.stringContaining(message),
      })
    );
    expect(getAccessTokenForUserMock).not.toHaveBeenCalled();
  });

  it("preserves the legacy token path for a run without a job document", async () => {
    loadLeadRunJobMock.mockResolvedValue(null);

    await processDueFollowupDraftTasks({
      runId: "legacy-run",
      orgId: "org-1",
      uid: "uid-1",
      maxTasks: 5,
      dryRun: false,
    });

    expect(getAccessTokenForUserMock).toHaveBeenCalledWith(
      "uid-1",
      undefined,
      { profileId: null }
    );
  });
});
