import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/outreach/followups/route";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { resolveLeadRunOrgId } from "@/lib/lead-runs/quotas";
import { queueFollowupDraftTasksForRun } from "@/lib/outreach/followups";
import { findNextPendingFollowupDueAtMs, getOrCreateFollowupsWorkerToken, triggerFollowupsWorker } from "@/lib/outreach/followups-jobs";
import { getFollowupsOrgSettings } from "@/lib/outreach/followups-settings";

vi.mock("@/lib/api/auth", () => ({
  requireFirebaseAuth: vi.fn(),
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
    queueFollowupDraftTasksForRun: vi.fn(async () => ({
      runId: "run-1",
      created: 2,
      existing: 0,
      skippedNoEmail: 0,
      skippedNoOutreach: 0,
      dueAtMs: Date.now() + 60_000,
    })),
  };
});

vi.mock("@/lib/outreach/followups-jobs", async () => {
  const actual = await vi.importActual<typeof import("@/lib/outreach/followups-jobs")>(
    "@/lib/outreach/followups-jobs"
  );
  return {
    ...actual,
    getOrCreateFollowupsWorkerToken: vi.fn(async () => "tok-1"),
    findNextPendingFollowupDueAtMs: vi.fn(async () => Date.now() + 60_000),
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

const requireAuthMock = vi.mocked(requireFirebaseAuth);
const resolveLeadRunOrgIdMock = vi.mocked(resolveLeadRunOrgId);
const queueFollowupDraftTasksForRunMock = vi.mocked(queueFollowupDraftTasksForRun);
const getOrCreateFollowupsWorkerTokenMock = vi.mocked(getOrCreateFollowupsWorkerToken);
const findNextPendingFollowupDueAtMsMock = vi.mocked(findNextPendingFollowupDueAtMs);
const triggerFollowupsWorkerMock = vi.mocked(triggerFollowupsWorker);
const getFollowupsOrgSettingsMock = vi.mocked(getFollowupsOrgSettings);

function createContext() {
  return { params: Promise.resolve({}) };
}

describe("followups queue route", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-15T00:00:00.000Z"));
    requireAuthMock.mockResolvedValue({ uid: "user-1" } as unknown as { uid: string });
    resolveLeadRunOrgIdMock.mockResolvedValue("org-1");
    getFollowupsOrgSettingsMock.mockResolvedValue({
      orgId: "org-1",
      autoEnabled: true,
      maxTasksPerInvocation: 5,
      drainDelaySeconds: 30,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("schedules the worker when auto follow-ups are enabled", async () => {
    const dueAtMs = Date.now() + 60_000;
    findNextPendingFollowupDueAtMsMock.mockResolvedValueOnce(dueAtMs);

    const req = new Request("http://localhost/api/outreach/followups", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Correlation-Id": "cid-1" },
      body: JSON.stringify({ runId: "run-1", delayHours: 48, maxLeads: 25, sequence: 1 }),
    });

    const res = await POST(
      req as unknown as Parameters<typeof POST>[0],
      createContext() as unknown as Parameters<typeof POST>[1]
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.autoEnabled).toBe(true);
    expect(data.scheduledNextAtMs).toBe(dueAtMs);
    expect(queueFollowupDraftTasksForRunMock).toHaveBeenCalledOnce();
    expect(getOrCreateFollowupsWorkerTokenMock).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1", uid: "user-1" })
    );
    expect(triggerFollowupsWorkerMock).toHaveBeenCalledWith(
      expect.objectContaining({
        origin: "http://localhost",
        runId: "run-1",
        workerToken: "tok-1",
        correlationId: "cid-1",
        scheduleAtMs: dueAtMs,
      })
    );
  });

  it("does not schedule when auto follow-ups are disabled", async () => {
    getFollowupsOrgSettingsMock.mockResolvedValueOnce({
      orgId: "org-1",
      autoEnabled: false,
      maxTasksPerInvocation: 5,
      drainDelaySeconds: 30,
    });

    const req = new Request("http://localhost/api/outreach/followups", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Correlation-Id": "cid-2" },
      body: JSON.stringify({ runId: "run-1" }),
    });

    const res = await POST(
      req as unknown as Parameters<typeof POST>[0],
      createContext() as unknown as Parameters<typeof POST>[1]
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.autoEnabled).toBe(false);
    expect(data.scheduledNextAtMs).toBe(null);
    expect(triggerFollowupsWorkerMock).not.toHaveBeenCalled();
  });
});

