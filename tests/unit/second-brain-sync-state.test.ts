import { describe, expect, it } from "vitest";
import { resolveSecondBrainCandidateSyncState } from "@/lib/second-brain";
import type { SecondBrainCandidate, SecondBrainReviewRecord } from "@/lib/second-brain-contract";

const candidate: SecondBrainCandidate = {
  candidateId: "candidate-1",
  candidateHash: "a".repeat(64),
  skillName: "memory-router",
  purpose: "Improve bounded retrieval.",
  status: "reviewable",
  generatedAt: "2026-09-01T00:00:00.000Z",
  evaluatorVersion: "fixed-v1",
  caseCount: 20,
  qualityDeltaPoints: 2,
  efficiencyImprovement: 0.1,
  evidenceCount: 4,
  riskFlags: [],
  safeDiffSummary: "One atomic skill update.",
  correlationId: "correlation-1",
};

const approval: SecondBrainReviewRecord = {
  candidateId: candidate.candidateId,
  candidateHash: candidate.candidateHash,
  decision: "approve",
  reasonCode: "verified-improvement",
  notes: "",
  reviewerUid: "reviewer-1",
  reviewerEmail: "reviewer@example.com",
  reviewedAt: "2026-09-01T01:00:00.000Z",
  correlationId: "review-1",
  idempotencyKey: "review-key",
  source: "mission-control",
};

describe("second-brain candidate sync state", () => {
  it("derives approved status only from the authoritative decision", () => {
    expect(resolveSecondBrainCandidateSyncState({ incoming: { ...candidate, status: "approved" } })).toMatchObject({
      status: "reviewable",
      review: null,
    });
    expect(resolveSecondBrainCandidateSyncState({ incoming: candidate, decision: approval })).toMatchObject({
      status: "approved",
      review: approval,
    });
  });

  it("rejects candidate ID reuse and terminal runtime status without approval", () => {
    expect(() => resolveSecondBrainCandidateSyncState({
      incoming: candidate,
      existing: { candidateHash: "b".repeat(64), status: "approved" },
    })).toThrow(/different hash/i);
    expect(() => resolveSecondBrainCandidateSyncState({ incoming: { ...candidate, status: "promoted" } })).toThrow(/approval/i);
  });

  it("preserves a terminal runtime status only with the matching approval", () => {
    expect(resolveSecondBrainCandidateSyncState({
      incoming: candidate,
      existing: { candidateHash: candidate.candidateHash, status: "promoted" },
      decision: approval,
    })).toMatchObject({ status: "promoted", preservedTerminal: true });
  });

  it("allows promoted to revert but never re-promotes a reverted candidate", () => {
    expect(resolveSecondBrainCandidateSyncState({
      incoming: { ...candidate, status: "reverted" },
      existing: { candidateHash: candidate.candidateHash, status: "promoted" },
      decision: approval,
    })).toMatchObject({ status: "reverted", preservedTerminal: false });
    expect(resolveSecondBrainCandidateSyncState({
      incoming: { ...candidate, status: "promoted" },
      existing: { candidateHash: candidate.candidateHash, status: "reverted" },
      decision: approval,
    })).toMatchObject({ status: "reverted", preservedTerminal: true });
  });
});
