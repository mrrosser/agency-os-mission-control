import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/social/drafts/route";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { withIdempotency } from "@/lib/api/idempotency";
import { createSocialDraftWithApprovalDispatch, listSocialDrafts } from "@/lib/social/drafts";

vi.mock("@/lib/api/auth", () => ({
  requireFirebaseAuth: vi.fn(),
}));

vi.mock("@/lib/api/idempotency", () => ({
  getIdempotencyKey: vi.fn(() => "idem-social-1"),
  withIdempotency: vi.fn(async (_params: unknown, executor: () => Promise<unknown>) => ({
    data: await executor(),
    replayed: false,
  })),
}));

vi.mock("@/lib/social/drafts", () => ({
  createSocialDraftWithApprovalDispatch: vi.fn(),
  listSocialDrafts: vi.fn(),
}));

const requireAuthMock = vi.mocked(requireFirebaseAuth);
const withIdempotencyMock = vi.mocked(withIdempotency);
const createDraftMock = vi.mocked(createSocialDraftWithApprovalDispatch);
const listDraftsMock = vi.mocked(listSocialDrafts);

function createContext() {
  return { params: Promise.resolve({}) };
}

describe("social drafts route", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    requireAuthMock.mockResolvedValue({ uid: "user-1" } as unknown as Awaited<ReturnType<typeof requireFirebaseAuth>>);
  });

  it("lists social drafts for an authenticated user", async () => {
    listDraftsMock.mockResolvedValue([
      {
        draftId: "d-1",
        uid: "user-1",
        businessKey: "rts",
        channels: ["instagram_story"],
        caption: "Draft caption",
        media: [],
        status: "pending_approval",
        source: "agent_worker",
        correlationId: "corr",
        publishAt: null,
        createdAt: "2026-02-25T20:00:00.000Z",
        updatedAt: "2026-02-25T20:00:00.000Z",
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
          expiresAt: "2026-03-04T20:00:00.000Z",
          requestedAt: "2026-02-25T20:00:00.000Z",
        },
      },
    ]);

    const req = new Request("http://localhost/api/social/drafts?status=pending_approval&limit=10", {
      method: "GET",
      headers: { Authorization: "Bearer token" },
    });
    const res = await GET(
      req as unknown as Parameters<typeof GET>[0],
      createContext() as unknown as Parameters<typeof GET>[1]
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(Array.isArray(data.drafts)).toBe(true);
    expect(listDraftsMock).toHaveBeenCalledWith({
      uid: "user-1",
      status: "pending_approval",
      limit: 10,
    });
  });

  it("creates and dispatches social draft approvals", async () => {
    createDraftMock.mockResolvedValue({
      draft: {
        draftId: "d-2",
        uid: "user-1",
        businessKey: "rng",
        channels: ["instagram_story", "facebook_post"],
        caption: "Video-first story draft",
        media: [{ type: "video", url: "https://cdn.example.com/v.mp4" }],
        status: "pending_approval",
        source: "agent_worker",
        correlationId: "corr-2",
        publishAt: null,
        createdAt: "2026-02-25T20:00:00.000Z",
        updatedAt: "2026-02-25T20:00:00.000Z",
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

    const req = new Request("http://localhost/api/social/drafts", {
      method: "POST",
      headers: {
        Authorization: "Bearer token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        businessKey: "rng",
        channels: ["instagram_story", "facebook_post"],
        caption: "Video-first story draft",
        media: [{ type: "video", url: "https://cdn.example.com/v.mp4" }],
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
    expect(data.approvalNotified).toBe(true);
    expect(withIdempotencyMock).toHaveBeenCalledOnce();
    expect(createDraftMock).toHaveBeenCalledOnce();
  });
});
