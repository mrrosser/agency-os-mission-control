import { describe, expect, it } from "vitest";
import { isWarmReconnectQaRecipient } from "@/lib/crm/warm-reconnect-qa-recipient";

describe("private fixed QA recipient allowlist", () => {
  it.each([
    undefined, null, "", "   ", "missing-at", "owner-qa@", "@example.test",
    "owner-qa@example.test", "another@example.test", "owner-qa+alias@example.test",
    "Name <owner-qa@example.test>", "owner-qa@example.test\r\nBcc: another@example.test",
  ])("rejects missing, malformed or unauthorized input: %j", (input) => {
    expect(isWarmReconnectQaRecipient(input as string)).toBe(false);
  });
});
