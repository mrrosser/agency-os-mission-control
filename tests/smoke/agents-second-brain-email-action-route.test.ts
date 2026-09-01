import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET as INSPECT } from "@/app/api/agents/second-brain/email-action/inspect/route";
import { POST as CONFIRM } from "@/app/api/agents/second-brain/email-action/confirm/route";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { getIdempotencyKey, withIdempotency } from "@/lib/api/idempotency";
import { confirmSecondBrainEmailAction, inspectSecondBrainEmailAction } from "@/lib/second-brain";

vi.mock("@/lib/api/auth", () => ({ requireFirebaseAuth: vi.fn() }));
vi.mock("@/lib/api/idempotency", () => ({ getIdempotencyKey: vi.fn(), withIdempotency: vi.fn() }));
vi.mock("@/lib/second-brain-auth", () => ({ assertSecondBrainReviewerAllowed: vi.fn() }));
vi.mock("@/lib/second-brain", () => ({ confirmSecondBrainEmailAction: vi.fn(), inspectSecondBrainEmailAction: vi.fn() }));

const requireAuthMock = vi.mocked(requireFirebaseAuth);
const inspectMock = vi.mocked(inspectSecondBrainEmailAction);
const confirmMock = vi.mocked(confirmSecondBrainEmailAction);
const withIdempotencyMock = vi.mocked(withIdempotency);
const getIdempotencyKeyMock = vi.mocked(getIdempotencyKey);

const candidate = {
  candidateId: "candidate-1",
  candidateHash: "a".repeat(64),
  skillName: "memory-router",
  purpose: "Improve retrieval.",
  status: "reviewable" as const,
  generatedAt: "2026-08-30T12:00:00Z",
  evaluatorVersion: "fixed-v1",
  caseCount: 24,
  qualityDeltaPoints: 2,
  efficiencyImprovement: 0.1,
  evidenceCount: 4,
  riskFlags: [],
  safeDiffSummary: "Atomic patch.",
  correlationId: "cid-1",
};

function context() {
  return { params: Promise.resolve({}) };
}

describe("second-brain email action routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthMock.mockResolvedValue({ uid: "reviewer-1", email: "ops@example.com" } as Awaited<ReturnType<typeof requireFirebaseAuth>>);
    inspectMock.mockResolvedValue({ candidate, decision: "approve", expiresAt: "2026-09-01T00:00:00Z" });
    confirmMock.mockResolvedValue({
      candidateId: candidate.candidateId,
      candidateHash: candidate.candidateHash,
      decision: "approve",
      reasonCode: "verified-improvement",
      notes: "",
      reviewerUid: "reviewer-1",
      reviewerEmail: "ops@example.com",
      reviewedAt: "2026-08-30T12:30:00Z",
      correlationId: "cid-2",
      idempotencyKey: "email-review",
      source: "email-action",
    });
    getIdempotencyKeyMock.mockReturnValue("email-review");
    withIdempotencyMock.mockImplementation(async (_params, executor) => ({ data: await executor(), replayed: false }));
  });

  it("inspects without consuming the email action", async () => {
    const request = new Request(`http://localhost/api/agents/second-brain/email-action/inspect?token=${"t".repeat(48)}`);
    const response = await INSPECT(request as Parameters<typeof INSPECT>[0], context() as Parameters<typeof INSPECT>[1]);
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload.decision).toBe("approve");
    expect(confirmMock).not.toHaveBeenCalled();
  });

  it("consumes the action only through authenticated POST confirmation", async () => {
    const request = new Request("http://localhost/api/agents/second-brain/email-action/confirm", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: "t".repeat(48), reasonCode: "verified-improvement" }),
    });
    const response = await CONFIRM(request as Parameters<typeof CONFIRM>[0], context() as Parameters<typeof CONFIRM>[1]);
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload.review.source).toBe("email-action");
    expect(confirmMock).toHaveBeenCalledWith(expect.objectContaining({ reviewerUid: "reviewer-1" }));
  });
});
