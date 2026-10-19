import "server-only";

import { z } from "zod";
import { ApiError } from "@/lib/api/handler";
import { warmReconnectFingerprint } from "@/lib/crm/warm-reconnect-dedupe";
import type { WarmReconnectPilotRecipient, WarmReconnectRecipientCopyInput } from "@/lib/crm/warm-reconnect-activation-types";
import type { WarmReconnectCampaignRenderedEmail } from "@/lib/crm/warm-reconnect-campaign-design";

export const WARM_RECONNECT_RECIPIENT_COPY_VERSION = "warm-reconnect-recipient-copy.v1" as const;
export const WARM_RECONNECT_BASE_OPENING = "It's Marcus Rosser. I wanted to say hello and share a simple way to stay connected with my work.";
const BASE_OPENING_HTML = 'It\'s Marcus Rosser. I wanted to say hello and share a simple way to <strong style="color:#774359">stay connected with my work.</strong>';
const sha256 = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const identifier = z.string().min(1).max(200).regex(/^[A-Za-z0-9_.:-]+$/);
// Reject, rather than silently normalize, control characters, markup and link text.
const copyText = (max: number) => z.string().min(1).max(max).refine(value =>
  value === value.trim() && value === value.normalize("NFC") &&
  !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}<>\[\]{}]|(?:https?:|www\.|mailto:|\b[a-z0-9-]+\.[a-z]{2,}\b)/iu.test(value));
const fields = {
  version: z.literal(WARM_RECONNECT_RECIPIENT_COPY_VERSION),
  recipientId: identifier, personId: identifier, contactPointId: identifier,
  emailKey: sha256, expectedCandidateFingerprint: sha256,
  greetingName: copyText(80), openingParagraph: copyText(600),
};
export const warmReconnectRecipientCopyInputSchema = z.object({
  ...fields, expectedContentFingerprint: sha256,
}).strict();
const frozenSchema = z.object({
  ...fields, contentFingerprint: sha256, implementationFingerprint: sha256,
  renderedOutputFingerprint: sha256,
}).strict();

/** Candidate identity is not evidence that the proposed contextual facts are true. */
export function warmReconnectRecipientCopyContentFingerprint(input: Omit<WarmReconnectRecipientCopyInput, "expectedContentFingerprint">): string {
  const parsed = z.object(fields).strict().safeParse(input);
  if (!parsed.success) throw new ApiError(400, "Invalid recipient copy. Use bounded plain text and an exact identity.");
  return warmReconnectFingerprint(parsed.data);
}

export function assertWarmReconnectRecipientCopyIdentity(recipient: WarmReconnectPilotRecipient): void {
  if (recipient.recipientCopy === undefined) return;
  const parsed = frozenSchema.safeParse(recipient.recipientCopy);
  if (!parsed.success) throw new ApiError(409, "The frozen recipient copy contract is invalid.");
  const { contentFingerprint, implementationFingerprint: _implementation, renderedOutputFingerprint: _output, ...copy } = parsed.data;
  void _implementation; void _output;
  if (copy.recipientId !== recipient.recipientId || copy.personId !== recipient.personId ||
      copy.contactPointId !== recipient.contactPointId || copy.emailKey !== recipient.emailKey ||
      copy.expectedCandidateFingerprint !== recipient.candidateFingerprint ||
      contentFingerprint !== warmReconnectRecipientCopyContentFingerprint(copy)) {
    throw new ApiError(409, "The recipient identity or exact copy changed. Return to review.");
  }
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function replaceOnce(value: string, before: string, after: string): string {
  if (!before || value.split(before).length !== 2) throw new ApiError(409, "The exact base copy changed.");
  return value.replace(before, () => after);
}

function openingHtml(opening: string): string {
  if (opening === WARM_RECONNECT_BASE_OPENING) return BASE_OPENING_HTML;
  const ending = "stay connected with my work.";
  return opening.endsWith(ending)
    ? `${escapeHtml(opening.slice(0, -ending.length))}<strong style="color:#774359">${ending}</strong>`
    : escapeHtml(opening);
}

/** Only greeting and first paragraph may vary; the historical renderer stays intact. */
export function applyWarmReconnectRecipientCopy(base: WarmReconnectCampaignRenderedEmail, recipient: WarmReconnectPilotRecipient): WarmReconnectCampaignRenderedEmail {
  if (recipient.recipientCopy === undefined) return base;
  assertWarmReconnectRecipientCopyIdentity(recipient);
  const copy = recipient.recipientCopy;
  if (base.contentMode !== "approved_design_v2") throw new ApiError(409, "Recipient copy requires the reviewed campaign design.");
  const plainText = replaceOnce(replaceOnce(base.plainText, `Hi ${recipient.greetingName},`, `Hi ${copy.greetingName},`), WARM_RECONNECT_BASE_OPENING, copy.openingParagraph);
  const html = replaceOnce(replaceOnce(base.html, `Hi ${escapeHtml(recipient.greetingName)},`, `Hi ${escapeHtml(copy.greetingName)},`), BASE_OPENING_HTML, openingHtml(copy.openingParagraph));
  return { ...base, plainText, html, contractFingerprint: warmReconnectFingerprint({
    contract: WARM_RECONNECT_RECIPIENT_COPY_VERSION, base: base.contractFingerprint,
    contentFingerprint: copy.contentFingerprint, plainText, html,
  }) };
}

/** Normalize only this delivery's two capability URLs, never arbitrary text. */
export function warmReconnectRecipientRenderedOutputFingerprint(rendered: WarmReconnectCampaignRenderedEmail, preferencesUrl: string, unsubscribeUrl: string): string {
  const normalize = (value: string) => value
    .replaceAll(preferencesUrl, "[RECIPIENT_PREFERENCES]")
    .replaceAll(unsubscribeUrl, "[RECIPIENT_UNSUBSCRIBE]");
  return warmReconnectFingerprint({
    contract: "warm-reconnect-recipient-rendered-output.v1",
    contentMode: rendered.contentMode, subject: rendered.subject,
    plainText: normalize(rendered.plainText), html: normalize(rendered.html),
    artworkUrl: rendered.artworkUrl,
  });
}

export function warmReconnectRecipientCopyImplementationFingerprint(): string {
  return warmReconnectFingerprint({
    contract: WARM_RECONNECT_RECIPIENT_COPY_VERSION, baseOpening: WARM_RECONNECT_BASE_OPENING, baseOpeningHtml: BASE_OPENING_HTML,
    implementation: [copyText, warmReconnectRecipientCopyContentFingerprint,
      assertWarmReconnectRecipientCopyIdentity, escapeHtml, replaceOnce, openingHtml,
      applyWarmReconnectRecipientCopy, warmReconnectRecipientRenderedOutputFingerprint].map(fn => fn.toString()),
  });
}

/** Creation replay binding is independent of later relationship decisions. */
export function warmReconnectRecipientCreationIdentity(recipient: WarmReconnectPilotRecipient) {
  assertWarmReconnectRecipientCopyIdentity(recipient);
  return { recipientId: recipient.recipientId, candidateFingerprint: recipient.candidateFingerprint,
    ...(recipient.recipientCopy === undefined ? {} : { recipientCopy: recipient.recipientCopy }) };
}

export function warmReconnectRecipientCopyReviewFingerprint(recipients: WarmReconnectPilotRecipient[]): string | undefined {
  const copies = recipients.filter(recipient => recipient.recipientCopy !== undefined);
  if (!copies.length) return undefined;
  copies.forEach(assertWarmReconnectRecipientCopyIdentity);
  return warmReconnectFingerprint({ contract: "warm-reconnect-exact-recipient-copy-review.v1",
    recipients: copies.map(warmReconnectRecipientCreationIdentity) });
}
