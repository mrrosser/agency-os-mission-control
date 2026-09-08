import { describe, expect, it } from "vitest";
import {
  SecondBrainCandidateSchema,
  SecondBrainCandidateSyncRequestSchema,
  SecondBrainEmailActionConfirmSchema,
  SecondBrainHealthSchema,
  SecondBrainReviewRequestSchema,
} from "@/lib/second-brain-contract";

const candidate = {
  candidateId: "candidate_123",
  candidateHash: "a".repeat(64),
  skillName: "second-brain-control-plane",
  purpose: "Improve bounded retrieval without lowering correctness.",
  status: "reviewable",
  generatedAt: "2026-08-30T12:00:00Z",
  evaluatorVersion: "fixed-v1",
  caseCount: 24,
  qualityDeltaPoints: 2.5,
  efficiencyImprovement: 0.12,
  evidenceCount: 4,
  riskFlags: [],
  safeDiffSummary: "One atomic SKILL.md edit.",
  correlationId: "correlation-1",
};

describe("second-brain contracts", () => {
  it("accepts an evaluator-gated candidate", () => {
    expect(SecondBrainCandidateSchema.parse(candidate)).toMatchObject({ status: "reviewable", evidenceCount: 4 });
  });

  it("rejects malformed hashes and unknown statuses", () => {
    expect(() => SecondBrainCandidateSchema.parse({ ...candidate, candidateHash: "bad" })).toThrow();
    expect(() => SecondBrainCandidateSchema.parse({ ...candidate, status: "auto-shipped" })).toThrow();
  });

  it("requires Firestore-safe candidate IDs", () => {
    expect(() => SecondBrainCandidateSchema.parse({ ...candidate, candidateId: "nested/candidate" })).toThrow(/Firestore/i);
    expect(() => SecondBrainCandidateSchema.parse({ ...candidate, candidateId: " candidate 123 " })).toThrow(/Firestore/i);
  });

  it("rejects duplicate candidate IDs within one sync request", () => {
    expect(() => SecondBrainCandidateSyncRequestSchema.parse({
      uid: "operator-1",
      generatedAt: "2026-08-30T12:00:00Z",
      candidates: [candidate, { ...candidate, candidateHash: "b".repeat(64) }],
    })).toThrow(/unique/i);
  });

  it("rejects credentials and email addresses at the cloud boundary", () => {
    expect(() => SecondBrainCandidateSchema.parse({ ...candidate, purpose: "Send to owner@example.com" })).toThrow(/sensitive/i);
    expect(() => SecondBrainCandidateSchema.parse({ ...candidate, safeDiffSummary: "api_key=super-secret-value" })).toThrow(/sensitive/i);
    expect(() => SecondBrainCandidateSchema.parse({ ...candidate, purpose: "Call 312-555-1212" })).toThrow(/sensitive/i);
    expect(() => SecondBrainCandidateSchema.parse({ ...candidate, purpose: "SSN 123-45-6789" })).toThrow(/sensitive/i);
    expect(() => SecondBrainCandidateSchema.parse({ ...candidate, purpose: "Card 4111 1111 1111 1111" })).toThrow(/sensitive/i);
  });

  it("requires explicit review reasons and long action tokens", () => {
    expect(() => SecondBrainReviewRequestSchema.parse({
      candidateId: candidate.candidateId,
      candidateHash: candidate.candidateHash,
      decision: "approve",
      reasonCode: "",
    })).toThrow();
    expect(() => SecondBrainEmailActionConfirmSchema.parse({ token: "short", reasonCode: "verified" })).toThrow();
  });

  it("models storage and retrieval readiness independently", () => {
    const health = SecondBrainHealthSchema.parse({
      generatedAt: "2026-08-30T12:00:00Z",
      sourceCount: 89,
      healthySourceCount: 82,
      traceCount: 120,
      patternCount: 18,
      pendingReviewCount: 2,
      storageStatus: "healthy",
      keyReady: true,
      qmdReady: true,
      shadowCyclesPassed: 7,
    });
    expect(health.lastCaptureAt).toBeNull();
    expect(health.qmdReady).toBe(true);
  });
});
