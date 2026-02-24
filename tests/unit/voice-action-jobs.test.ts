import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { triggerVoiceActionsWorker } from "@/lib/voice/action-jobs";

describe("voice action jobs", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    delete process.env.VOICE_ACTIONS_TASK_QUEUE;
    delete process.env.FOLLOWUPS_TASK_QUEUE;
    delete process.env.LEAD_RUNS_TASK_QUEUE;
    delete process.env.GOOGLE_CLOUD_PROJECT;
    delete process.env.GCLOUD_PROJECT;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("skips when worker token is empty", async () => {
    const result = await triggerVoiceActionsWorker({
      origin: "http://localhost:3000",
      workerToken: "   ",
      correlationId: "cid-1",
    });

    expect(result).toBe("skipped");
  });

  it("falls back to direct HTTP trigger when Cloud Tasks is not configured", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await triggerVoiceActionsWorker({
      origin: "http://localhost:3000",
      workerToken: "worker-token",
      correlationId: "cid-2",
      requestId: "req-123",
    });

    expect(result).toBe("http");
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:3000/api/twilio/voice-actions/worker-task");
    expect(options).toMatchObject({
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Correlation-Id": "cid-2",
      },
      cache: "no-store",
    });
    const payload = JSON.parse(String(options?.body || "{}")) as Record<string, unknown>;
    expect(payload.workerToken).toBe("worker-token");
  });
});
