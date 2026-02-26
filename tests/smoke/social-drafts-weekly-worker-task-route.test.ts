import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/social/drafts/weekly/worker-task/route";
import { withIdempotency } from "@/lib/api/idempotency";
import { createSocialDraftWithApprovalDispatch } from "@/lib/social/drafts";

vi.mock("@/lib/api/idempotency", () => ({
  getIdempotencyKey: vi.fn(() => ""),
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

describe("social drafts weekly worker-task route", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
    process.env.SOCIAL_DRAFT_WORKER_TOKEN = "social-token";
    process.env.SOCIAL_DRAFT_APPROVAL_BASE_URL = "https://leadflow-review.web.app";
    process.env.SOCIAL_DRAFT_UID = "uid-weekly";
    process.env.SOCIAL_DRAFT_WEEKLY_TIMEZONE = "America/Chicago";

    createDraftMock.mockResolvedValue({
      draft: {
        draftId: "d-weekly",
        uid: "uid-weekly",
        businessKey: "rts",
        channels: ["instagram_post", "facebook_post"],
        caption: "RTS Weekly Build Highlight (2026-W09)",
        media: [],
        status: "pending_approval",
        source: "openclaw_social_orchestrator",
        correlationId: "corr",
        publishAt: null,
        createdAt: "2026-02-26T05:10:00.000Z",
        updatedAt: "2026-02-26T05:10:00.000Z",
        dispatch: {
          status: null,
          queueDocId: null,
          queuedAt: null,
          externalTool: null,
          lastError: null,
        },
        approval: {
          decision: null,
          decisionSource: null,
          decidedAt: null,
          expiresAt: "2026-03-05T05:10:00.000Z",
          requestedAt: "2026-02-26T05:10:00.000Z",
        },
      },
      approvalNotified: true,
      approvalUrls: {
        approve: "https://leadflow-review.web.app/api/social/drafts/d-weekly/decision",
        reject: "https://leadflow-review.web.app/api/social/drafts/d-weekly/decision",
      },
      warning: null,
    });
  });

  it("rejects requests without worker token", async () => {
    const req = new Request("http://localhost/api/social/drafts/weekly/worker-task", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ businessKey: "rts" }),
    });

    const res = await POST(
      req as unknown as Parameters<typeof POST>[0],
      createContext() as unknown as Parameters<typeof POST>[1]
    );
    const data = await res.json();

    expect(res.status).toBe(403);
    expect(data.error).toBe("Forbidden");
  });

  it("creates a weekly business draft with deterministic weekly idempotency", async () => {
    const req = new Request("http://localhost/api/social/drafts/weekly/worker-task", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer social-token",
      },
      body: JSON.stringify({ businessKey: "rts" }),
    });

    const res = await POST(
      req as unknown as Parameters<typeof POST>[0],
      createContext() as unknown as Parameters<typeof POST>[1]
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.weekKey).toMatch(/^\d{4}-W\d{2}$/);
    expect(withIdempotencyMock).toHaveBeenCalledOnce();
    expect(createDraftMock).toHaveBeenCalledOnce();
    expect(createDraftMock.mock.calls[0]?.[0]).toMatchObject({
      businessKey: "rts",
      uid: "uid-weekly",
      channels: ["instagram_post", "facebook_post"],
    });
  });
});
