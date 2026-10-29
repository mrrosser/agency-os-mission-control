import { ApiError } from "@/lib/api/handler";

const RECIPIENT_ID = /^[A-Za-z0-9_.:-]{1,160}$/;

/** Validate the finite stored queue before deriving any receipt-query bound.
 * A lock's numeric count alone is never authority for a database read. This
 * helper is not part of the historical approval fingerprint contract. */
export function assertWarmReconnectRecipientQueue(input: {
  recipientCap?: unknown;
  recipients?: unknown;
}): number {
  const count = input.recipientCap;
  const recipients = input.recipients;
  if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 1 ||
      !Number.isSafeInteger(count + 1) || !Array.isArray(recipients) || recipients.length !== count) {
    throw new ApiError(409, "The frozen recipient queue does not match its exact count.");
  }
  const ids = new Set<string>();
  for (const recipient of recipients) {
    if (!recipient || typeof recipient !== "object" || Array.isArray(recipient) ||
        typeof recipient.recipientId !== "string" || !RECIPIENT_ID.test(recipient.recipientId) ||
        ids.has(recipient.recipientId)) {
      throw new ApiError(409, "The frozen recipient queue needs distinct valid recipient identities.");
    }
    ids.add(recipient.recipientId);
  }
  return count;
}
