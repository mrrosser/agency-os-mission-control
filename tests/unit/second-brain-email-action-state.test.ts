import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/firebase-admin", () => ({ getAdminDb: vi.fn() }));

import {
  hashSecondBrainEmailActionToken,
  parseSecondBrainCandidateDocument,
  validateSecondBrainEmailActionState,
} from "@/lib/second-brain";

const originalEnv = process.env;

function action(overrides: Record<string, unknown> = {}) {
  return {
    recipientUid: "reviewer-1",
    recipientEmail: "ops@example.com",
    candidateId: "candidate-1",
    candidateHash: "a".repeat(64),
    decision: "approve",
    uid: "operator-1",
    expiresAt: "2026-09-01T00:00:00Z",
    usedAt: null,
    ...overrides,
  };
}

describe("second-brain email action state", () => {
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("hashes opaque tokens with the configured action secret", () => {
    process.env = { ...originalEnv, SECOND_BRAIN_EMAIL_ACTION_SECRET: "x".repeat(48) };
    expect(hashSecondBrainEmailActionToken("opaque-token-value")).toMatch(/^[a-f0-9]{64}$/);
    expect(hashSecondBrainEmailActionToken("opaque-token-value")).toBe(hashSecondBrainEmailActionToken("opaque-token-value"));
  });

  it("accepts an unused identity-, candidate-, and decision-bound action", () => {
    expect(() => validateSecondBrainEmailActionState(action(), {
      reviewerUid: "reviewer-1",
      reviewerEmail: "ops@example.com",
      candidateId: "candidate-1",
      candidateHash: "a".repeat(64),
      decision: "approve",
      operatorUid: "operator-1",
      nowMs: Date.parse("2026-08-30T00:00:00Z"),
    })).not.toThrow();
  });

  it("rejects replay, expiry, recipient mismatch, and candidate mismatch", () => {
    const expected = {
      reviewerUid: "reviewer-1",
      reviewerEmail: "ops@example.com",
      candidateId: "candidate-1",
      candidateHash: "a".repeat(64),
      decision: "approve" as const,
      operatorUid: "operator-1",
      nowMs: Date.parse("2026-08-30T00:00:00Z"),
    };
    expect(() => validateSecondBrainEmailActionState(action({ usedAt: "2026-08-29T00:00:00Z" }), expected)).toThrow(/already been used/i);
    expect(() => validateSecondBrainEmailActionState(action({ expiresAt: "2026-08-01T00:00:00Z" }), expected)).toThrow(/expired/i);
    expect(() => validateSecondBrainEmailActionState(action(), { ...expected, reviewerUid: "other" })).toThrow(/another reviewer/i);
    expect(() => validateSecondBrainEmailActionState(action(), { ...expected, candidateHash: "b".repeat(64) })).toThrow(/no longer matches/i);
    expect(() => validateSecondBrainEmailActionState(action({ uid: "other-operator" }), expected)).toThrow(/another operator/i);
    expect(() => validateSecondBrainEmailActionState(action({ expiresAt: "not-a-timestamp" }), expected)).toThrow(/expired/i);
  });

  it("maps stored candidate documents without leaking storage metadata into strict parsing", () => {
    const stored = {
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
      safeDiffSummary: "One atomic update.",
      correlationId: "correlation-1",
      firstSeenAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T01:00:00.000Z",
      review: null,
    };

    expect(parseSecondBrainCandidateDocument(stored)).toEqual({
      candidateId: stored.candidateId,
      candidateHash: stored.candidateHash,
      skillName: stored.skillName,
      purpose: stored.purpose,
      status: stored.status,
      generatedAt: stored.generatedAt,
      evaluatorVersion: stored.evaluatorVersion,
      caseCount: stored.caseCount,
      qualityDeltaPoints: stored.qualityDeltaPoints,
      efficiencyImprovement: stored.efficiencyImprovement,
      evidenceCount: stored.evidenceCount,
      riskFlags: stored.riskFlags,
      safeDiffSummary: stored.safeDiffSummary,
      correlationId: stored.correlationId,
    });
  });
});
