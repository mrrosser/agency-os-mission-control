import { describe, expect, it } from "vitest";
import { scoreInboxMessage, summarizeInboxTriage, triageInboxMessages } from "@/lib/inbox/triage";
import type { GmailMessage } from "@/lib/google/gmail";

function buildMessage(args: { id: string; subject: string; from?: string; snippet: string }): GmailMessage {
  return {
    id: args.id,
    threadId: `thread-${args.id}`,
    snippet: args.snippet,
    payload: {
      headers: [
        { name: "Subject", value: args.subject },
        { name: "From", value: args.from || "lead@example.com" },
      ],
    },
  };
}

describe("inbox triage rubric", () => {
  it("classifies high-intent commercial replies with rubric v2 fields", () => {
    const message = buildMessage({
      id: "m-hot",
      subject: "Re: proposal and pricing",
      snippet: "Looks good. Can we schedule a call this week?",
    });

    const triage = scoreInboxMessage(message);
    expect(triage.rubricVersion).toBe("v2");
    expect(triage.bucket).toBe("hot");
    expect(["high", "exceptional"]).toContain(triage.sponsorBucket);
    expect(triage.score).toBeGreaterThanOrEqual(75);
    expect(triage.confidence).toBeGreaterThan(0.6);
    expect(triage.lowConfidence).toBe(false);
    expect(typeof triage.dimensions.fit).toBe("number");
    expect(typeof triage.dimensions.clarity).toBe("number");
    expect(typeof triage.dimensions.budget).toBe("number");
    expect(typeof triage.dimensions.seriousness).toBe("number");
    expect(typeof triage.dimensions.companyTrust).toBe("number");
    expect(typeof triage.dimensions.closeLikelihood).toBe("number");
    expect(triage.suggestedAction.escalate).toBe(true);
    expect(triage.reasons).toContain("commercial_intent");
    expect(triage.reasons).toContain("meeting_intent");
  });

  it("calculates weighted score from v2 dimensions", () => {
    const message = buildMessage({
      id: "m-weighted",
      subject: "Re: proposal",
      snippet: "Can we review pricing and book a meeting tomorrow?",
    });

    const triage = scoreInboxMessage(message);
    const weighted =
      triage.dimensions.fit * 0.2 +
      triage.dimensions.clarity * 0.15 +
      triage.dimensions.budget * 0.15 +
      triage.dimensions.seriousness * 0.15 +
      triage.dimensions.companyTrust * 0.2 +
      triage.dimensions.closeLikelihood * 0.15;
    const roundedWeighted = Math.round(weighted * 100) / 100;

    expect(triage.score).toBeCloseTo(roundedWeighted, 2);
  });

  it("suppresses unsubscribe or bounce-like messages as spam/ignore", () => {
    const unsubscribe = buildMessage({
      id: "m-unsub",
      subject: "Please remove me",
      snippet: "Not interested. Stop emailing this address.",
    });
    const bounce = buildMessage({
      id: "m-bounce",
      subject: "Delivery Status Notification (Failure)",
      from: "mailer-daemon@googlemail.com",
      snippet: "Automatic reply from mail server.",
    });

    const unsubTriage = scoreInboxMessage(unsubscribe);
    const bounceTriage = scoreInboxMessage(bounce);

    expect(unsubTriage.sponsorBucket).toBe("spam");
    expect(unsubTriage.bucket).toBe("ignore");
    expect(unsubTriage.suggestedAction.suppress).toBe(true);
    expect(bounceTriage.sponsorBucket).toBe("spam");
    expect(bounceTriage.bucket).toBe("ignore");
  });

  it("marks ambiguous messages as low confidence", () => {
    const message = buildMessage({
      id: "m-low-confidence",
      subject: "Hello",
      snippet: "Checking in.",
    });
    const triage = scoreInboxMessage(message);

    expect(triage.confidenceThreshold).toBe(0.65);
    expect(triage.lowConfidence).toBe(true);
  });

  it("maps sponsor buckets to legacy buckets deterministically", () => {
    const triaged = triageInboxMessages([
      buildMessage({
        id: "m-hot",
        subject: "Re: proposal and pricing",
        snippet: "Looks good. Can we schedule a call this week?",
      }),
      buildMessage({
        id: "m-med",
        subject: "Question",
        snippet: "What are your implementation timelines?",
      }),
      buildMessage({
        id: "m-low",
        subject: "Hello",
        snippet: "Checking in.",
      }),
      buildMessage({
        id: "m-spam",
        subject: "Unsubscribe",
        snippet: "Please remove me from this list.",
      }),
    ]);

    const map = {
      exceptional: "hot",
      high: "hot",
      medium: "follow_up",
      low: "nurture",
      spam: "ignore",
    } as const;

    for (const message of triaged) {
      expect(message.triage.bucket).toBe(map[message.triage.sponsorBucket]);
    }
  });

  it("summarizes legacy and sponsor buckets with confidence totals", () => {
    const triaged = triageInboxMessages([
      buildMessage({
        id: "m1",
        subject: "Re: call",
        snippet: "Interested in your quote, can we book a meeting?",
      }),
      buildMessage({
        id: "m2",
        subject: "Quick question",
        snippet: "What does implementation include?",
      }),
      buildMessage({
        id: "m3",
        subject: "Out of office",
        snippet: "Automatic reply while I am away.",
      }),
    ]);

    const summary = summarizeInboxTriage(triaged);
    expect(summary.total).toBe(3);
    expect(summary.bucketCounts.hot + summary.bucketCounts.follow_up + summary.bucketCounts.nurture + summary.bucketCounts.ignore).toBe(3);
    expect(
      summary.sponsorBucketCounts.exceptional +
        summary.sponsorBucketCounts.high +
        summary.sponsorBucketCounts.medium +
        summary.sponsorBucketCounts.low +
        summary.sponsorBucketCounts.spam
    ).toBe(3);
    expect(summary.averageConfidence).toBeGreaterThan(0);
    expect(summary.averageScore).toBeGreaterThanOrEqual(0);
    expect(summary.lowConfidenceCount).toBeGreaterThanOrEqual(0);
  });
});
