import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET, POST } from "@/app/api/outreach/followups/route";
import { POST as WORKER_POST } from "@/app/api/outreach/followups/worker/route";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { resolveLeadRunOrgId } from "@/lib/lead-runs/quotas";
import { listFollowupTasks, queueFollowupDraftTasksForRun, processDueFollowupDraftTasks } from "@/lib/outreach/followups";
import { getFollowupsOrgSettings } from "@/lib/outreach/followups-settings";

vi.mock("@/lib/api/auth", () => ({
  requireFirebaseAuth: vi.fn(),
}));

vi.mock("@/lib/lead-runs/quotas", () => ({
  resolveLeadRunOrgId: vi.fn(),
}));

vi.mock("@/lib/outreach/followups", () => ({
  listFollowupTasks: vi.fn(),
  queueFollowupDraftTasksForRun: vi.fn(),
  processDueFollowupDraftTasks: vi.fn(),
}));

vi.mock("@/lib/outreach/followups-settings", () => ({
  getFollowupsOrgSettings: vi.fn(),
}));

const requireAuthMock = vi.mocked(requireFirebaseAuth);
const resolveOrgMock = vi.mocked(resolveLeadRunOrgId);
const listMock = vi.mocked(listFollowupTasks);
const queueMock = vi.mocked(queueFollowupDraftTasksForRun);
const processMock = vi.mocked(processDueFollowupDraftTasks);
const getFollowupsOrgSettingsMock = vi.mocked(getFollowupsOrgSettings);

function createContext(params: Record<string, string> = {}) {
  return { params: Promise.resolve(params) };
}

describe("follow-up sequencing routes", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    requireAuthMock.mockResolvedValue({ uid: "user-1" } as unknown as { uid: string });
    resolveOrgMock.mockResolvedValue("org-1");
    // Keep these route tests focused on the API contract; scheduler behavior is covered separately.
    getFollowupsOrgSettingsMock.mockResolvedValue({
      orgId: "org-1",
      autoEnabled: false,
      maxTasksPerInvocation: 5,
      drainDelaySeconds: 30,
    });
  });

  it("lists tasks for a run", async () => {
    listMock.mockResolvedValue([
      {
        taskId: "t1",
        runId: "run-1",
        leadDocId: "lead-1",
        uid: "user-1",
        sequence: 1,
        status: "pending",
        dueAtMs: Date.now() + 1,
        attempts: 0,
        lead: { companyName: "ACME", email: "a@acme.test" },
      },
    ]);

    const req = new Request("http://localhost/api/outreach/followups?runId=run-1", { method: "GET" });
    const res = await GET(
      req as unknown as Parameters<typeof GET>[0],
      createContext() as unknown as Parameters<typeof GET>[1]
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.runId).toBe("run-1");
    expect(Array.isArray(data.tasks)).toBe(true);
    expect(data.tasks).toHaveLength(1);
    expect(listMock).toHaveBeenCalledOnce();
  });

  it("queues follow-up drafts for a run", async () => {
    queueMock.mockResolvedValue({
      runId: "run-1",
      created: 2,
      existing: 1,
      skippedNoEmail: 0,
      skippedNoOutreach: 1,
      dueAtMs: Date.now() + 48 * 60 * 60 * 1000,
    });

    const req = new Request("http://localhost/api/outreach/followups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runId: "run-1", delayHours: 48, maxLeads: 25 }),
    });
    const res = await POST(
      req as unknown as Parameters<typeof POST>[0],
      createContext() as unknown as Parameters<typeof POST>[1]
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.orgId).toBe("org-1");
    expect(data.created).toBe(2);
    expect(queueMock).toHaveBeenCalledOnce();
  });

  it("processes due tasks (draft-only)", async () => {
    processMock.mockResolvedValue({
      runId: "run-1",
      processed: 2,
      completed: 2,
      skipped: 0,
      failed: 0,
    });

    const req = new Request("http://localhost/api/outreach/followups/worker", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runId: "run-1", maxTasks: 5, dryRun: true }),
    });
    const res = await WORKER_POST(
      req as unknown as Parameters<typeof WORKER_POST>[0],
      createContext() as unknown as Parameters<typeof WORKER_POST>[1]
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.orgId).toBe("org-1");
    expect(data.processed).toBe(2);
    expect(processMock).toHaveBeenCalledOnce();
  });
});
