import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/agents/second-brain/candidates/sync/route";
import { getIdempotencyKey, withIdempotency } from "@/lib/api/idempotency";
import { assertSecondBrainOperatorUid, authorizeSecondBrainService } from "@/lib/second-brain-auth";
import { syncSecondBrainCandidates } from "@/lib/second-brain";

vi.mock("@/lib/api/idempotency", () => ({ getIdempotencyKey: vi.fn(), withIdempotency: vi.fn() }));
vi.mock("@/lib/second-brain-auth", () => ({
  assertSecondBrainOperatorUid: vi.fn(),
  authorizeSecondBrainService: vi.fn(),
}));
vi.mock("@/lib/second-brain", () => ({ syncSecondBrainCandidates: vi.fn() }));

const withIdempotencyMock = vi.mocked(withIdempotency);
const getIdempotencyKeyMock = vi.mocked(getIdempotencyKey);
const assertOperatorUidMock = vi.mocked(assertSecondBrainOperatorUid);
const syncMock = vi.mocked(syncSecondBrainCandidates);

function context() {
  return { params: Promise.resolve({}) };
}

describe("second-brain candidate sync route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getIdempotencyKeyMock.mockReturnValue("sync-key");
    assertOperatorUidMock.mockReturnValue("operator-1");
    withIdempotencyMock.mockImplementation(async (_params, executor) => ({ data: await executor(), replayed: false }));
    syncMock.mockResolvedValue({ syncedCount: 1, preservedTerminalCount: 0 });
  });

  it("accepts only sanitized candidate metadata from the service", async () => {
    const request = new Request("http://localhost/api/agents/second-brain/candidates/sync", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        uid: "operator-1",
        generatedAt: "2026-08-30T12:00:00Z",
        candidates: [{
          candidateId: "candidate-1",
          candidateHash: "a".repeat(64),
          skillName: "memory-router",
          purpose: "Improve retrieval.",
          status: "reviewable",
          generatedAt: "2026-08-30T12:00:00Z",
          evaluatorVersion: "fixed-v1",
          caseCount: 24,
          qualityDeltaPoints: 2,
          efficiencyImprovement: 0.1,
          evidenceCount: 4,
          riskFlags: [],
          safeDiffSummary: "Atomic patch.",
          correlationId: "cid-1",
        }],
      }),
    });
    const response = await POST(request as Parameters<typeof POST>[0], context() as Parameters<typeof POST>[1]);
    expect(response.status).toBe(200);
    expect(authorizeSecondBrainService).toHaveBeenCalled();
    expect(assertOperatorUidMock).toHaveBeenCalledWith("operator-1");
    expect(syncMock).toHaveBeenCalledWith(expect.objectContaining({ uid: "operator-1" }), expect.any(Object));
  });

  it("rejects raw candidate patch bodies not described by the contract", async () => {
    const request = new Request("http://localhost/api/agents/second-brain/candidates/sync", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        uid: "operator-1",
        generatedAt: "2026-08-30T12:00:00Z",
        candidates: [{
          candidateId: "candidate-1",
          candidateHash: "a".repeat(64),
          skillName: "memory-router",
          purpose: "Improve retrieval.",
          status: "reviewable",
          generatedAt: "2026-08-30T12:00:00Z",
          evaluatorVersion: "fixed-v1",
          caseCount: 24,
          qualityDeltaPoints: 2,
          efficiencyImprovement: 0.1,
          evidenceCount: 4,
          riskFlags: [],
          safeDiffSummary: "Atomic patch.",
          correlationId: "cid-1",
          rawTrace: "secret",
        }],
      }),
    });
    const response = await POST(request as Parameters<typeof POST>[0], context() as Parameters<typeof POST>[1]);
    expect(response.status).toBe(400);
    expect(syncMock).not.toHaveBeenCalled();
  });

  it("rejects duplicate candidate IDs before writing", async () => {
    const baseCandidate = {
      candidateId: "candidate-1",
      candidateHash: "a".repeat(64),
      skillName: "memory-router",
      purpose: "Improve retrieval.",
      status: "reviewable",
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
    const request = new Request("http://localhost/api/agents/second-brain/candidates/sync", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        uid: "operator-1",
        generatedAt: "2026-08-30T12:00:00Z",
        candidates: [baseCandidate, { ...baseCandidate, candidateHash: "b".repeat(64) }],
      }),
    });

    const response = await POST(request as Parameters<typeof POST>[0], context() as Parameters<typeof POST>[1]);
    expect(response.status).toBe(400);
    expect(syncMock).not.toHaveBeenCalled();
  });
});
