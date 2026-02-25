import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/social/drafts/[draftId]/decision/route";
import { decideSocialDraftWithToken } from "@/lib/social/drafts";

vi.mock("@/lib/social/drafts", () => ({
  decideSocialDraftWithToken: vi.fn(),
}));

const decideMock = vi.mocked(decideSocialDraftWithToken);

function createContext(params: Record<string, string>) {
  return { params: Promise.resolve(params) };
}

describe("social draft decision route", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    decideMock.mockResolvedValue({
      draftId: "draft-1",
      status: "approved",
      decision: "approve",
      replayed: false,
      queueDocId: "draft_draft-1",
      queuedForExternalDispatch: true,
    });
  });

  it("returns json when requested", async () => {
    const req = new Request(
      "http://localhost/api/social/drafts/draft-1/decision?uid=u1&token=12345678901234567890&decision=approve",
      {
        method: "GET",
        headers: { Accept: "application/json" },
      }
    );

    const res = await GET(
      req as unknown as Parameters<typeof GET>[0],
      createContext({ draftId: "draft-1" }) as unknown as Parameters<typeof GET>[1]
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.decision).toBe("approve");
    expect(decideMock).toHaveBeenCalledOnce();
  });

  it("returns html confirmation for browser links", async () => {
    const req = new Request(
      "http://localhost/api/social/drafts/draft-1/decision?uid=u1&token=12345678901234567890&decision=approve",
      {
        method: "GET",
        headers: { Accept: "text/html" },
      }
    );

    const res = await GET(
      req as unknown as Parameters<typeof GET>[0],
      createContext({ draftId: "draft-1" }) as unknown as Parameters<typeof GET>[1]
    );
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(body).toContain("Draft approved successfully.");
    expect(body).toContain("draft-1");
  });
});
