import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/firebase-admin", () => ({ getAdminAuth: vi.fn(), getAdminDb: vi.fn() }));
vi.mock("@/lib/google/oauth", () => ({ getAccessTokenForUser: vi.fn() }));
vi.mock("@/lib/google/gmail", () => ({ searchEmails: vi.fn(), sendEmail: vi.fn() }));
vi.mock("@/lib/second-brain", () => ({
  createSecondBrainEmailAction: vi.fn(),
  getSecondBrainCandidates: vi.fn(),
  recordSecondBrainNotification: vi.fn(),
}));

import {
  dispatchSecondBrainDigest,
  dispatchSecondBrainUrgent,
  escapeSecondBrainEmailHtml,
  resolveSecondBrainReviewRecipients,
  renderSecondBrainDigestEmail,
  renderSecondBrainUrgentEmail,
} from "@/lib/second-brain-email";

const originalEnv = process.env;

const candidate = {
  candidateId: "candidate_123",
  candidateHash: "b".repeat(64),
  skillName: "memory-router",
  purpose: "Use <verified> patterns & fewer tokens.",
  status: "reviewable" as const,
  generatedAt: "2026-08-30T12:00:00Z",
  evaluatorVersion: "fixed-v1",
  caseCount: 30,
  qualityDeltaPoints: 3,
  efficiencyImprovement: 0.14,
  evidenceCount: 6,
  riskFlags: ["trigger breadth"],
  safeDiffSummary: "One safe diff.",
  correlationId: "cid-1",
};

describe("second-brain email templates", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("requires both reviewer identity allowlists before resolving recipients", async () => {
    process.env = { ...originalEnv, SECOND_BRAIN_REVIEW_EMAILS: "ops@example.com" };
    delete process.env.SECOND_BRAIN_REVIEW_ALLOWED_UIDS;
    await expect(resolveSecondBrainReviewRecipients()).rejects.toThrow(/ALLOWED_UIDS/i);
  });

  it("escapes untrusted candidate content", () => {
    expect(escapeSecondBrainEmailHtml('<img src=x onerror="boom">')).not.toContain("<img");
    const email = renderSecondBrainDigestEmail({
      digestDate: "2026-08-30",
      dashboardUrl: "https://example.com/dashboard",
      candidates: [{
        ...candidate,
        actions: {
          approve: "https://example.com/review?token=approve",
          reject: "https://example.com/review?token=reject",
          defer: "https://example.com/review?token=defer",
        },
      }],
    });
    expect(email.html).toContain("Approve");
    expect(email.html).toContain("authenticated confirmation page");
    expect(email.html).toContain("Use &lt;verified&gt; patterns &amp; fewer tokens.");
    expect(email.html).not.toContain("<verified>");
  });

  it("renders urgent alerts without action tokens", () => {
    const email = renderSecondBrainUrgentEmail({
      event: {
        uid: "user-1",
        eventId: "event-1",
        eventType: "automatic-rollback",
        severity: "critical",
        summary: "Restored the last verified skill version.",
        detectedAt: "2026-08-30T12:00:00Z",
        dryRun: false,
      },
      dashboardUrl: "https://example.com/dashboard",
    });
    expect(email.subject).toContain("CRITICAL");
    expect(email.html).toContain("Restored the last verified skill version.");
    expect(email.html).not.toContain("token=");
  });

  it("hard-disables live digest and urgent delivery before shadow graduation", async () => {
    await expect(dispatchSecondBrainDigest({
      request: { uid: "operator-1", dryRun: false },
      correlationId: "cid-live-digest",
      idempotencyKey: "digest-key",
    })).rejects.toThrow(/hard-disabled/i);
    await expect(dispatchSecondBrainUrgent({
      request: {
        uid: "operator-1",
        eventId: "event-live",
        eventType: "automatic-rollback",
        severity: "critical",
        summary: "Rollback completed.",
        detectedAt: "2026-09-01T00:00:00.000Z",
        dryRun: false,
      },
      correlationId: "cid-live-urgent",
      idempotencyKey: "urgent-key",
    })).rejects.toThrow(/hard-disabled/i);
  });
});
