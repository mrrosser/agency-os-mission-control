import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { createTaskMock, queuePathMock } = vi.hoisted(() => ({
  createTaskMock: vi.fn(),
  queuePathMock: vi.fn(() => "projects/project/locations/location/queues/queue"),
}));

vi.mock("@google-cloud/tasks", () => ({
  CloudTasksClient: class {
    createTask = createTaskMock;
    queuePath = queuePathMock;
  },
}));

import {
  resolveLeadRunGoogleProfileId,
  triggerLeadRunWorker,
} from "@/lib/lead-runs/jobs";
import { triggerFollowupsWorker } from "@/lib/outreach/followups-jobs";

describe("triggerLeadRunWorker", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.LEAD_RUNS_TASK_QUEUE;
    delete process.env.LEAD_RUNS_TASK_LOCATION;
    delete process.env.LEAD_RUNS_WORKER_ORIGIN;
    delete process.env.LEAD_RUNS_TASK_SERVICE_ACCOUNT;
    delete process.env.LEAD_RUNS_GOOGLE_PROFILE_RT;
    delete process.env.LEAD_RUNS_GOOGLE_PROFILE_RTS;
    delete process.env.LEAD_RUNS_GOOGLE_PROFILE_RNG;
    delete process.env.LEAD_RUNS_GOOGLE_PROFILE_AICF;
    delete process.env.FOLLOWUPS_TASK_QUEUE;
    delete process.env.FOLLOWUPS_TASK_LOCATION;
    delete process.env.FOLLOWUPS_TASK_SERVICE_ACCOUNT;
    delete process.env.VERCEL_URL;
    process.env.GOOGLE_CLOUD_PROJECT = "leadflow-review";
    process.env.FUNCTION_REGION = "us-central1";
    createTaskMock.mockResolvedValue([{}]);
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it("falls back to cloudfunctions origin when primary origin fetch fails", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.startsWith("https://leadflow-review.web.app")) {
        throw new Error("primary origin failed");
      }
      if (url.startsWith("https://us-central1-leadflow-review.cloudfunctions.net/ssrleadflowreview")) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: false }), { status: 503 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const log = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    await triggerLeadRunWorker(
      "https://leadflow-review.web.app",
      "run-1",
      "worker-token-1",
      "cid-1",
      log
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(log.info).toHaveBeenCalledWith(
      "lead_runs.job.worker_triggered",
      expect.objectContaining({
        runId: "run-1",
        origin: "https://us-central1-leadflow-review.cloudfunctions.net/ssrleadflowreview",
      })
    );
  });

  it("skips bind-all origins and calls only the deployable worker origin", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ ok: true }), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);

    await triggerLeadRunWorker(
      "https://0.0.0.0:8080",
      "run-2",
      "worker-token-2",
      "cid-2"
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://us-central1-leadflow-review.cloudfunctions.net/ssrleadflowreview/api/lead-runs/run-2/jobs/worker"
    );
  });

  it("never creates a Cloud Task targeting a bind-all origin", async () => {
    process.env.LEAD_RUNS_TASK_QUEUE = "lead-runs";
    process.env.LEAD_RUNS_TASK_LOCATION = "us-central1";
    process.env.LEAD_RUNS_TASK_SERVICE_ACCOUNT = "worker@example.iam.gserviceaccount.com";
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    await triggerLeadRunWorker(
      "https://0.0.0.0:8080",
      "run-3",
      "worker-token-3",
      "cid-3"
    );

    expect(createTaskMock).toHaveBeenCalledOnce();
    expect(createTaskMock.mock.calls[0]?.[0]).toMatchObject({
      task: {
        httpRequest: {
          url: "https://us-central1-leadflow-review.cloudfunctions.net/ssrleadflowreview/api/lead-runs/run-3/jobs/worker",
          oidcToken: {
            serviceAccountEmail: "worker@example.iam.gserviceaccount.com",
            audience:
              "https://us-central1-leadflow-review.cloudfunctions.net/ssrleadflowreview",
          },
        },
      },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("selects the Google work profile for each revenue lane", () => {
    expect(resolveLeadRunGoogleProfileId("rts")).toBe("rt_solutions_work");
    expect(resolveLeadRunGoogleProfileId("rt")).toBe("rt_solutions_work");
    expect(resolveLeadRunGoogleProfileId("rng")).toBe("rosser_gallery_work");
  });

  it("allows a lane-specific profile override", () => {
    process.env.LEAD_RUNS_GOOGLE_PROFILE_RTS = "rt_backup_work";
    expect(resolveLeadRunGoogleProfileId("rts")).toBe("rt_backup_work");
  });

  it("marks a non-2xx follow-up HTTP fallback as skipped", async () => {
    delete process.env.LEAD_RUNS_TASK_QUEUE;
    delete process.env.LEAD_RUNS_TASK_LOCATION;
    const fetchMock = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ ok: false }), { status: 503 })
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await triggerFollowupsWorker({
      origin: "https://leadflow-review.web.app",
      runId: "run-followups-1",
      workerToken: "worker-token-1",
      correlationId: "cid-followups-1",
      scheduleAtMs: Date.now(),
    });

    expect(result).toBe("skipped");
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
