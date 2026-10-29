import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api/handler";
import { assertWarmReconnectRecipientQueue } from "@/lib/crm/warm-reconnect-recipient-queue";

function recipients(count: number) {
  return Array.from({ length: count }, (_, index) => ({ recipientId: `recipient-${index}` }));
}

function expectInvalid(input: { recipientCap?: unknown; recipients?: unknown }) {
  try {
    assertWarmReconnectRecipientQueue(input);
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toHaveProperty("status", 409);
    return;
  }
  expect.fail("An invalid frozen recipient queue must be rejected before its count can be used.");
}

describe("frozen recipient queue read bound", () => {
  it.each([1, 5, 20, 100, 101, 346])("uses the exact stored queue length for %i recipients", (count) => {
    const queue = Object.freeze(recipients(count).map(row => Object.freeze(row)));
    const input = Object.freeze({ recipientCap: count, recipients: queue });
    expect(assertWarmReconnectRecipientQueue(input)).toBe(count);
    expect(input.recipients).toBe(queue);
  });

  it("accepts the documented identifier character set and maximum length", () => {
    const queue = [
      { recipientId: "recipient_1:group.example-name" },
      { recipientId: "r".repeat(160) },
    ];
    expect(assertWarmReconnectRecipientQueue({ recipientCap: 2, recipients: queue })).toBe(2);
  });

  it.each([
    undefined, null, "1", 0, -1, 1.5, Number.NaN,
    Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1,
  ])("rejects a non-positive or non-safe count %s", (recipientCap) => {
    expectInvalid({ recipientCap, recipients: recipients(1) });
  });

  it("rejects a count whose sentinel query limit would not be a safe integer", () => {
    expectInvalid({ recipientCap: Number.MAX_SAFE_INTEGER, recipients: recipients(1) });
  });

  it.each([undefined, null, {}, "recipients", 1])("rejects a missing or non-array queue %s", (queue) => {
    expectInvalid({ recipientCap: Number.MAX_SAFE_INTEGER - 1, recipients: queue });
  });

  it("does not trust a giant numeric count backed by only one stored row", () => {
    expectInvalid({ recipientCap: Number.MAX_SAFE_INTEGER - 1, recipients: recipients(1) });
  });

  it("rejects an empty queue", () => {
    expectInvalid({ recipientCap: 1, recipients: [] });
  });

  it.each([
    { recipientCap: 1, recipients: recipients(2) },
    { recipientCap: 2, recipients: recipients(1) },
    { recipientCap: 346, recipients: recipients(345) },
  ])("rejects a count that does not match its actual queue", (input) => {
    expectInvalid(input);
  });

  it("rejects duplicate recipient identities even when the count matches", () => {
    expectInvalid({ recipientCap: 2, recipients: [{ recipientId: "same" }, { recipientId: "same" }] });
  });

  it.each([null, undefined, [], ["recipient-1"], "recipient-1", 1, {}])("rejects a malformed row %s", (row) => {
    expectInvalid({ recipientCap: 1, recipients: [row] });
  });

  it.each([undefined, null, 1, "", "recipient/1", "recipient 1", "recipient\n1", "ré cipient", "r".repeat(161)])(
    "rejects a malformed recipient identifier %s", (recipientId) => {
      expectInvalid({ recipientCap: 1, recipients: [{ recipientId }] });
    }
  );
});
