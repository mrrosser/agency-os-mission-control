import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/agents/second-brain/review/route";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { getIdempotencyKey, withIdempotency } from "@/lib/api/idempotency";
import { assertSecondBrainReviewerAllowed, requireSecondBrainOperatorUid } from "@/lib/second-brain-auth";
import { recordSecondBrainReview } from "@/lib/second-brain";

vi.mock("@/lib/api/auth", () => ({ requireFirebaseAuth: vi.fn() }));
vi.mock("@/lib/api/idempotency", () => ({ getIdempotencyKey: vi.fn(), withIdempotency: vi.fn() }));
vi.mock("@/lib/second-brain-auth", () => ({
  assertSecondBrainReviewerAllowed: vi.fn(),
  requireSecondBrainOperatorUid: vi.fn(),
}));
vi.mock("@/lib/second-brain", () => ({ recordSecondBrainReview: vi.fn() }));

const requireAuthMock = vi.mocked(requireFirebaseAuth);
const withIdempotencyMock = vi.mocked(withIdempotency);
const getIdempotencyKeyMock = vi.mocked(getIdempotencyKey);
const requireOperatorUidMock = vi.mocked(requireSecondBrainOperatorUid);
const recordReviewMock = vi.mocked(recordSecondBrainReview);

function context() {
  return { params: Promise.resolve({}) };
}

describe("second-brain review route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthMock.mockResolvedValue({ uid: "reviewer-2", email: "reviewer@example.com" } as Awaited<ReturnType<typeof requireFirebaseAuth>>);
    requireOperatorUidMock.mockReturnValue("operator-1");
    getIdempotencyKeyMock.mockReturnValue("review-key");
    withIdempotencyMock.mockImplementation(async (_params, executor) => ({ data: await executor(), replayed: false }));
    recordReviewMock.mockResolvedValue({
      candidateId: "candidate-1",
      candidateHash: "a".repeat(64),
      decision: "approve",
      reasonCode: "verified-improvement",
      notes: "",
      reviewerUid: "reviewer-2",
      reviewerEmail: "reviewer@example.com",
      reviewedAt: "2026-08-30T12:00:00Z",
      correlationId: "cid-1",
      idempotencyKey: "review-key",
      source: "mission-control",
    });
  });

  it("records an authenticated, hash-bound review", async () => {
    const request = new Request("http://localhost/api/agents/second-brain/review", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        candidateId: "candidate-1",
        candidateHash: "a".repeat(64),
        decision: "approve",
        reasonCode: "verified-improvement",
      }),
    });
    const response = await POST(request as Parameters<typeof POST>[0], context() as Parameters<typeof POST>[1]);
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload.review.decision).toBe("approve");
    expect(assertSecondBrainReviewerAllowed).toHaveBeenCalled();
    expect(requireOperatorUidMock).toHaveBeenCalled();
    expect(recordReviewMock).toHaveBeenCalledWith(expect.objectContaining({
      uid: "operator-1",
      candidateHash: "a".repeat(64),
      reviewerUid: "reviewer-2",
    }));
  });

  it("rejects malformed candidate hashes", async () => {
    const request = new Request("http://localhost/api/agents/second-brain/review", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ candidateId: "candidate-1", candidateHash: "bad", decision: "approve", reasonCode: "verified" }),
    });
    const response = await POST(request as Parameters<typeof POST>[0], context() as Parameters<typeof POST>[1]);
    expect(response.status).toBe(400);
  });
});
