import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  assertSecondBrainOperatorUid,
  assertSecondBrainReviewerAllowed,
  configuredReviewEmails,
  requireSecondBrainOperatorUid,
  secureTokenEqual,
} from "@/lib/second-brain-auth";

describe("second-brain authorization helpers", () => {
  const originalEnv = process.env;
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("uses constant-length token comparison semantics", () => {
    expect(secureTokenEqual("same-token", "same-token")).toBe(true);
    expect(secureTokenEqual("wrong-token", "same-token")).toBe(false);
    expect(secureTokenEqual("short", "much-longer-token")).toBe(false);
  });

  it("normalizes and deduplicates review recipients", () => {
    process.env = { ...originalEnv, SECOND_BRAIN_REVIEW_EMAILS: "Ops@Example.com, ops@example.com, owner@example.com" };
    expect(configuredReviewEmails()).toEqual(["ops@example.com", "owner@example.com"]);
  });

  it("requires and binds the configured operator UID", () => {
    process.env = { ...originalEnv };
    delete process.env.SECOND_BRAIN_OPERATOR_UID;
    expect(() => requireSecondBrainOperatorUid()).toThrow(/not configured/i);

    process.env.SECOND_BRAIN_OPERATOR_UID = "operator-1";
    expect(requireSecondBrainOperatorUid()).toBe("operator-1");
    expect(assertSecondBrainOperatorUid("operator-1")).toBe("operator-1");
    expect(() => assertSecondBrainOperatorUid("other-operator")).toThrow(/mismatch/i);
  });

  it("fails closed until both reviewer allowlists are configured", () => {
    process.env = { ...originalEnv };
    delete process.env.SECOND_BRAIN_REVIEW_ALLOWED_UIDS;
    delete process.env.SECOND_BRAIN_REVIEW_EMAILS;
    expect(() => assertSecondBrainReviewerAllowed({ uid: "reviewer-1", email: "ops@example.com" })).toThrow(/not configured/i);

    process.env.SECOND_BRAIN_REVIEW_ALLOWED_UIDS = "reviewer-1";
    expect(() => assertSecondBrainReviewerAllowed({ uid: "reviewer-1", email: "ops@example.com" })).toThrow(/not configured/i);

    delete process.env.SECOND_BRAIN_REVIEW_ALLOWED_UIDS;
    process.env.SECOND_BRAIN_REVIEW_EMAILS = "ops@example.com";
    expect(() => assertSecondBrainReviewerAllowed({ uid: "reviewer-1", email: "ops@example.com" })).toThrow(/not configured/i);
  });

  it("requires both UID and email membership when configured", () => {
    process.env = {
      ...originalEnv,
      SECOND_BRAIN_REVIEW_ALLOWED_UIDS: "allowed-1",
      SECOND_BRAIN_REVIEW_EMAILS: "ops@example.com",
    };
    expect(() => assertSecondBrainReviewerAllowed({ uid: "allowed-1", email: "ops@example.com" })).not.toThrow();
    expect(() => assertSecondBrainReviewerAllowed({ uid: "other", email: "ops@example.com" })).toThrow(/UID|allowlisted|Reviewer/i);
    expect(() => assertSecondBrainReviewerAllowed({ uid: "allowed-1", email: "other@example.com" })).toThrow(/email/i);
    expect(() => assertSecondBrainReviewerAllowed({ uid: "allowed-1" })).toThrow(/email/i);
  });
});
