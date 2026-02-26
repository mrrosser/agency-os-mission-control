import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/social/drafts/dispatch/worker-task/route";
import { runSocialDispatchWorker } from "@/lib/social/dispatch";

vi.mock("@/lib/social/dispatch", () => ({
  runSocialDispatchWorker: vi.fn(),
}));

const runSocialDispatchWorkerMock = vi.mocked(runSocialDispatchWorker);

function createContext() {
  return { params: Promise.resolve({}) };
}

describe("social drafts dispatch worker-task route", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
    process.env.SOCIAL_DRAFT_WORKER_TOKEN = "social-token";

    runSocialDispatchWorkerMock.mockResolvedValue({
      uid: "uid-1",
      dryRun: false,
      retryFailed: false,
      scanned: 1,
      attempted: 1,
      dispatched: 1,
      failed: 0,
      skipped: 0,
      items: [
        {
          queueId: "draft_abc",
          draftId: "abc",
          status: "dispatched",
          transport: "mcp_tools_call",
          error: null,
        },
      ],
    });
  });

  it("rejects requests without worker auth", async () => {
    const req = new Request("http://localhost/api/social/drafts/dispatch/worker-task", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uid: "uid-1" }),
    });

    const res = await POST(
      req as unknown as Parameters<typeof POST>[0],
      createContext() as unknown as Parameters<typeof POST>[1]
    );
    const data = await res.json();

    expect(res.status).toBe(403);
    expect(data.error).toBe("Forbidden");
  });

  it("runs social dispatch queue drain when worker auth is valid", async () => {
    const req = new Request("http://localhost/api/social/drafts/dispatch/worker-task", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer social-token",
      },
      body: JSON.stringify({
        uid: "uid-1",
        maxTasks: 5,
        retryFailed: true,
      }),
    });

    const res = await POST(
      req as unknown as Parameters<typeof POST>[0],
      createContext() as unknown as Parameters<typeof POST>[1]
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(runSocialDispatchWorkerMock).toHaveBeenCalledOnce();
    expect(runSocialDispatchWorkerMock).toHaveBeenCalledWith(
      expect.objectContaining({
        uid: "uid-1",
        maxTasks: 5,
        retryFailed: true,
        dryRun: undefined,
      })
    );
  });
});
