import { describe, expect, it } from "vitest";
import {
  buildGoogleChatSocialDraftCard,
  buildSocialDraftDecisionUrl,
  hashSocialDraftApprovalToken,
  type SocialDraftRecord,
} from "@/lib/social/drafts";

describe("social drafts helpers", () => {
  it("hashes approval tokens deterministically", () => {
    const token = "abc123tokenvalue";
    const first = hashSocialDraftApprovalToken(token);
    const second = hashSocialDraftApprovalToken(token);

    expect(first).toBe(second);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
  });

  it("builds signed decision urls for approvals", () => {
    const approveUrl = buildSocialDraftDecisionUrl({
      baseUrl: "https://app.example.com",
      uid: "uid-1",
      draftId: "draft-1",
      token: "token-1",
      decision: "approve",
    });

    expect(approveUrl).toContain("/api/social/drafts/draft-1/decision");
    expect(approveUrl).toContain("uid=uid-1");
    expect(approveUrl).toContain("decision=approve");
    expect(approveUrl).toContain("token=token-1");
  });

  it("renders media-aware Google Chat cards with approval buttons", () => {
    const draft: SocialDraftRecord = {
      draftId: "draft-9",
      uid: "uid-1",
      businessKey: "rts",
      channels: ["instagram_story", "facebook_post"],
      caption: "Fresh story draft with CTA",
      media: [
        { type: "image", url: "https://cdn.example.com/img1.jpg", title: "cover" },
        { type: "video", url: "https://cdn.example.com/video1.mp4", title: "story clip" },
      ],
      status: "pending_approval",
      source: "agent_worker",
      correlationId: "corr-1",
      publishAt: null,
      createdAt: "2026-02-25T21:00:00.000Z",
      updatedAt: "2026-02-25T21:00:00.000Z",
      approval: {
        decision: null,
        decisionSource: null,
        decidedAt: null,
        expiresAt: "2026-03-04T21:00:00.000Z",
        requestedAt: "2026-02-25T21:00:00.000Z",
      },
    };

    const payload = buildGoogleChatSocialDraftCard({
      draft,
      approveUrl: "https://app.example.com/approve",
      rejectUrl: "https://app.example.com/reject",
    });

    expect(payload.text).toContain("Social draft ready for approval");
    expect(payload.cardsV2[0]?.card?.sections?.length).toBeGreaterThanOrEqual(3);
    const serialized = JSON.stringify(payload);
    expect(serialized).toContain("Approve Draft");
    expect(serialized).toContain("Reject Draft");
    expect(serialized).toContain("story clip");
    expect(serialized).toContain("img1.jpg");
  });
});
