import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { triggerLeadRunWorker } from "@/lib/lead-runs/jobs";

describe("triggerLeadRunWorker", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.LEAD_RUNS_TASK_QUEUE;
    delete process.env.LEAD_RUNS_TASK_LOCATION;
    process.env.GOOGLE_CLOUD_PROJECT = "leadflow-review";
    process.env.FUNCTION_REGION = "us-central1";
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
});
