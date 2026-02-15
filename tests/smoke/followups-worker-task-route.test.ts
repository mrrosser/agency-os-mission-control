import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/outreach/followups/worker-task/route";
import { getAdminDb } from "@/lib/firebase-admin";
import { resolveLeadRunOrgId } from "@/lib/lead-runs/quotas";
import { processDueFollowupDraftTasks } from "@/lib/outreach/followups";
import { findNextPendingFollowupDueAtMs, triggerFollowupsWorker } from "@/lib/outreach/followups-jobs";
import { getFollowupsOrgSettings } from "@/lib/outreach/followups-settings";

vi.mock("@/lib/firebase-admin", () => ({
  getAdminDb: vi.fn(),
}));

vi.mock("@/lib/lead-runs/quotas", () => ({
  resolveLeadRunOrgId: vi.fn(async () => "org-1"),
}));

vi.mock("@/lib/outreach/followups", async () => {
  const actual = await vi.importActual<typeof import("@/lib/outreach/followups")>(
    "@/lib/outreach/followups"
  );
  return {
    ...actual,
    processDueFollowupDraftTasks: vi.fn(async () => ({
      runId: "run-1",
      processed: 1,
      completed: 1,
      skipped: 0,
      failed: 0,
    })),
  };
});

vi.mock("@/lib/outreach/followups-jobs", async () => {
  const actual = await vi.importActual<typeof import("@/lib/outreach/followups-jobs")>(
    "@/lib/outreach/followups-jobs"
  );
  return {
    ...actual,
    findNextPendingFollowupDueAtMs: vi.fn(async () => null),
    triggerFollowupsWorker: vi.fn(async () => "cloud_tasks"),
  };
});

vi.mock("@/lib/outreach/followups-settings", async () => {
  const actual = await vi.importActual<typeof import("@/lib/outreach/followups-settings")>(
    "@/lib/outreach/followups-settings"
  );
  return {
    ...actual,
    getFollowupsOrgSettings: vi.fn(async () => ({
      orgId: "org-1",
      autoEnabled: true,
      maxTasksPerInvocation: 5,
      drainDelaySeconds: 30,
    })),
  };
});

const getAdminDbMock = vi.mocked(getAdminDb);
const resolveLeadRunOrgIdMock = vi.mocked(resolveLeadRunOrgId);
const processDueFollowupDraftTasksMock = vi.mocked(processDueFollowupDraftTasks);
const findNextPendingFollowupDueAtMsMock = vi.mocked(findNextPendingFollowupDueAtMs);
const triggerFollowupsWorkerMock = vi.mocked(triggerFollowupsWorker);
const getFollowupsOrgSettingsMock = vi.mocked(getFollowupsOrgSettings);

function createContext() {
  return { params: Promise.resolve({}) };
}

describe("followups worker-task route", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-15T00:00:00.000Z"));

    getAdminDbMock.mockReturnValue({
      collection: vi.fn(() => ({
        doc: vi.fn(() => ({
          get: vi.fn(async () => ({
            exists: true,
            data: () => ({ userId: "user-1", followupsWorkerToken: "good-token" }),
          })),
        })),
      })),
    } as unknown as ReturnType<typeof getAdminDb>);

    resolveLeadRunOrgIdMock.mockResolvedValue("org-1");
    getFollowupsOrgSettingsMock.mockResolvedValue({
      orgId: "org-1",
      autoEnabled: true,
      maxTasksPerInvocation: 5,
      drainDelaySeconds: 30,
    });
    findNextPendingFollowupDueAtMsMock.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("rejects invalid worker token", async () => {
    const req = new Request("http://localhost/api/outreach/followups/worker-task", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Correlation-Id": "cid-1" },
      body: JSON.stringify({ runId: "run-1", workerToken: "bad-token" }),
    });

    const res = await POST(
      req as unknown as Parameters<typeof POST>[0],
      createContext() as unknown as Parameters<typeof POST>[1]
    );
    const data = await res.json();

    expect(res.status).toBe(403);
    expect(String(data.error || "")).toContain("Forbidden");
    expect(processDueFollowupDraftTasksMock).not.toHaveBeenCalled();
  });

  it("no-ops when auto follow-ups are disabled", async () => {
    getFollowupsOrgSettingsMock.mockResolvedValueOnce({
      orgId: "org-1",
      autoEnabled: false,
      maxTasksPerInvocation: 5,
      drainDelaySeconds: 30,
    });

    const req = new Request("http://localhost/api/outreach/followups/worker-task", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Correlation-Id": "cid-2" },
      body: JSON.stringify({ runId: "run-1", workerToken: "good-token" }),
    });

    const res = await POST(
      req as unknown as Parameters<typeof POST>[0],
      createContext() as unknown as Parameters<typeof POST>[1]
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.disabled).toBe(true);
    expect(processDueFollowupDraftTasksMock).not.toHaveBeenCalled();
    expect(triggerFollowupsWorkerMock).not.toHaveBeenCalled();
  });

  it("processes due tasks and schedules next run when pending tasks remain", async () => {
    const nextDueAtMs = Date.now() + 60_000;
    findNextPendingFollowupDueAtMsMock.mockResolvedValueOnce(nextDueAtMs);

    const req = new Request("http://localhost/api/outreach/followups/worker-task", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Correlation-Id": "cid-3" },
      body: JSON.stringify({ runId: "run-1", workerToken: "good-token" }),
    });

    const res = await POST(
      req as unknown as Parameters<typeof POST>[0],
      createContext() as unknown as Parameters<typeof POST>[1]
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.scheduledNextAtMs).toBe(nextDueAtMs);
    expect(processDueFollowupDraftTasksMock).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1", uid: "user-1", orgId: "org-1" })
    );
    expect(triggerFollowupsWorkerMock).toHaveBeenCalledWith(
      expect.objectContaining({
        origin: "http://localhost",
        runId: "run-1",
        workerToken: "good-token",
        correlationId: "cid-3",
        scheduleAtMs: nextDueAtMs,
      })
    );
  });
});

