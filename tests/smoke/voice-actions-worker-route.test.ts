import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/twilio/voice-actions/worker-task/route";
import { processQueuedVoiceActions } from "@/lib/voice/action-worker";
import { promises as fs } from "fs";

vi.mock("fs", () => ({
  promises: {
    readFile: vi.fn(),
  },
}));

vi.mock("@/lib/voice/action-worker", () => ({
  processQueuedVoiceActions: vi.fn(),
}));

const readFileMock = vi.mocked(fs.readFile);
const processQueuedVoiceActionsMock = vi.mocked(processQueuedVoiceActions);

function createContext() {
  return { params: Promise.resolve({}) };
}

describe("voice actions worker route", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.VOICE_ACTIONS_WORKER_TOKEN = "worker-test-token";
    readFileMock.mockResolvedValue(
      JSON.stringify({
        globalPolicies: {
          voiceOpsPolicy: { enabled: true },
        },
        businesses: [],
      })
    );
    processQueuedVoiceActionsMock.mockResolvedValue({
      scanned: 2,
      claimed: 2,
      completed: 1,
      needsInput: 1,
      failed: 0,
      dryRun: false,
    });
  });

  it("processes queued voice actions with valid worker token", async () => {
    const request = new Request("http://localhost/api/twilio/voice-actions/worker-task", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        workerToken: "worker-test-token",
        maxTasks: 5,
      }),
    });

    const response = await POST(
      request as unknown as Parameters<typeof POST>[0],
      createContext() as unknown as Parameters<typeof POST>[1]
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.completed).toBe(1);
    expect(processQueuedVoiceActionsMock).toHaveBeenCalledOnce();
  });

  it("rejects invalid worker token", async () => {
    const request = new Request("http://localhost/api/twilio/voice-actions/worker-task", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        workerToken: "wrong",
      }),
    });

    const response = await POST(
      request as unknown as Parameters<typeof POST>[0],
      createContext() as unknown as Parameters<typeof POST>[1]
    );
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(String(payload.error)).toMatch(/Forbidden/i);
    expect(processQueuedVoiceActionsMock).not.toHaveBeenCalled();
  });
});
