import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/social/drafts/worker-task/route";
import { withIdempotency } from "@/lib/api/idempotency";
import { createSocialDraftWithApprovalDispatch } from "@/lib/social/drafts";

vi.mock("@/lib/api/idempotency", () => ({
  getIdempotencyKey: vi.fn(() => "idem-social-worker-1"),
  withIdempotency: vi.fn(async (_params: unknown, executor: () => Promise<unknown>) => ({
    data: await executor(),
    replayed: false,
  })),
}));

vi.mock("@/lib/social/drafts", () => ({
  createSocialDraftWithApprovalDispatch: vi.fn(),
}));

const withIdempotencyMock = vi.mocked(withIdempotency);
const createDraftMock = vi.mocked(createSocialDraftWithApprovalDispatch);

function createContext() {
  return { params: Promise.resolve({}) };
}

describe("social drafts worker-task route", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
    process.env.SOCIAL_DRAFT_WORKER_TOKEN = "social-token";

    createDraftMock.mockResolvedValue({
      draft: {
        draftId: "d-worker",
        uid: "uid-1",
        businessKey: "aicf",
        channels: ["facebook_post"],
        caption: "Worker generated draft",
        media: [{ type: "image", url: "https://cdn.example.com/i.jpg" }],
        status: "pending_approval",
        source: "agent_worker",
        correlationId: "corr",
        publishAt: null,
        createdAt: "2026-02-25T20:00:00.000Z",
        updatedAt: "2026-02-25T20:00:00.000Z",
        approval: {
          decision: null,
          decisionSource: null,
          decidedAt: null,
          expiresAt: "2026-03-04T20:00:00.000Z",
          requestedAt: "2026-02-25T20:00:00.000Z",
        },
      },
      approvalNotified: true,
      approvalUrls: {
        approve: "https://app.example.com/approve",
        reject: "https://app.example.com/reject",
      },
      warning: null,
    });
  });

  it("rejects requests without worker token", async () => {
    const req = new Request("http://localhost/api/social/drafts/worker-task", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        uid: "uid-1",
        channels: ["facebook_post"],
        caption: "draft",
      }),
    });

    const res = await POST(
      req as unknown as Parameters<typeof POST>[0],
      createContext() as unknown as Parameters<typeof POST>[1]
    );
    const data = await res.json();

    expect(res.status).toBe(403);
    expect(data.error).toBe("Forbidden");
  });

  it("creates drafts when worker token is valid", async () => {
    const req = new Request("http://localhost/api/social/drafts/worker-task", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer social-token",
      },
      body: JSON.stringify({
        uid: "uid-1",
        businessKey: "aicf",
        channels: ["facebook_post"],
        caption: "Worker generated draft",
        media: [{ type: "image", url: "https://cdn.example.com/i.jpg" }],
        requestApproval: true,
      }),
    });

    const res = await POST(
      req as unknown as Parameters<typeof POST>[0],
      createContext() as unknown as Parameters<typeof POST>[1]
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(withIdempotencyMock).toHaveBeenCalledOnce();
    expect(createDraftMock).toHaveBeenCalledOnce();
  });
});
