import { describe, expect, it, vi } from "vitest";

const { callGoogleAPIMock } = vi.hoisted(() => ({
  callGoogleAPIMock: vi.fn(),
}));

vi.mock("@/lib/google/tokens", () => ({
  callGoogleAPI: callGoogleAPIMock,
}));

import {
  buildWarmReconnectCampaignMime,
} from "@/lib/google/gmail-campaign";
import { sendWarmReconnectCampaignEmail } from "@/lib/google/gmail-campaign-sender";

const preferenceToken = "p".repeat(43);
const unsubscribeOnlyToken = "u".repeat(43);
const preferencesUrl =
  `https://leadflow-review.web.app/preferences#token=${preferenceToken}`;
const oneClickUnsubscribeUrl =
  `https://leadflow-review.web.app/api/crm/warm-reconnect/unsubscribe/${unsubscribeOnlyToken}`;

const message = {
  to: "friend@example.com",
  from: "marcus@example.org",
  senderName: "Marcus Rosser",
  replyTo: "reply@example.org",
  subject: "A quick hello from Marcus",
  plainText: `Hello there.\n\nUpdate preferences or unsubscribe: ${preferencesUrl}`,
  html: `<p>Hello there.</p><p><a href="${preferencesUrl}">Update preferences or unsubscribe</a></p>`,
  messageId: "<pilot_recipient_action@example.org>",
  preferencesUrl,
  oneClickUnsubscribeUrl,
};

describe("warm reconnect campaign Gmail MIME", () => {
  it("builds one-recipient multipart mail with visible preference and one-click headers", () => {
    const mime = buildWarmReconnectCampaignMime(message);

    expect(mime).toContain("To: friend@example.com\r\n");
    expect(mime).toContain(
      "From: =?UTF-8?B?TWFyY3VzIFJvc3Nlcg==?= <marcus@example.org>\r\n"
    );
    expect(mime).toContain("Reply-To: reply@example.org\r\n");
    expect(mime).toContain("Content-Type: multipart/alternative;");
    expect(mime).toContain("Content-Type: text/plain; charset=utf-8");
    expect(mime).toContain("Content-Type: text/html; charset=utf-8");
    expect(mime).toContain(
      "List-Unsubscribe-Post: List-Unsubscribe=One-Click"
    );
    const headerBlock = mime.slice(0, mime.indexOf("\r\n\r\n"));
    expect(headerBlock).toContain(
      `List-Unsubscribe: <${message.oneClickUnsubscribeUrl}>\r\n`
    );
    expect(headerBlock).not.toContain(message.preferencesUrl);
    expect(
      headerBlock.match(/^List-Unsubscribe:.*$/m)?.[0]
    ).toBe(`List-Unsubscribe: <${message.oneClickUnsubscribeUrl}>`);
    expect(mime).not.toContain("Cc:");
    expect(mime).not.toContain("Bcc:");
  });

  it.each(["bad\r\nBcc: victim@example.com", "", "not-an-email"])(
    "rejects an unsafe recipient: %s",
    (to) => {
      expect(() => buildWarmReconnectCampaignMime({ ...message, to })).toThrow();
    }
  );

  it("encodes the sender display name as a safe MIME phrase", () => {
    const mime = buildWarmReconnectCampaignMime({
      ...message,
      senderName: "Marcus <not-an-address>",
    });
    expect(mime).not.toContain("Marcus <not-an-address>");
    expect(mime).toContain("From: =?UTF-8?B?");
  });

  it("rejects non-HTTPS and fragment-bearing one-click URLs", () => {
    expect(() =>
      buildWarmReconnectCampaignMime({
        ...message,
        oneClickUnsubscribeUrl: "http://example.com/unsubscribe#token",
      })
    ).toThrow("Invalid one-click unsubscribe URL");
  });

  it("rejects a visible one-click link or a missing human preference link", () => {
    expect(() =>
      buildWarmReconnectCampaignMime({
        ...message,
        plainText: `Unsubscribe: ${oneClickUnsubscribeUrl}`,
      })
    ).toThrow("Visible unsubscribe must use the human preference URL");
    expect(() =>
      buildWarmReconnectCampaignMime({
        ...message,
        html: "<p>No preference control here.</p>",
      })
    ).toThrow("Visible unsubscribe must use the human preference URL");
  });

  it("rejects reused, cross-origin, or malformed capability URLs", () => {
    expect(() =>
      buildWarmReconnectCampaignMime({
        ...message,
        oneClickUnsubscribeUrl:
          `https://leadflow-review.web.app/api/crm/warm-reconnect/unsubscribe/${preferenceToken}`,
      })
    ).toThrow("must be distinct");
    expect(() =>
      buildWarmReconnectCampaignMime({
        ...message,
        preferencesUrl: `https://other.example/preferences#token=${preferenceToken}`,
        plainText: `Preferences: https://other.example/preferences#token=${preferenceToken}`,
        html: `<a href="https://other.example/preferences#token=${preferenceToken}">Preferences</a>`,
      })
    ).toThrow("Invalid one-click unsubscribe URL");
  });

  it("sends the exact built MIME through Gmail without exposing another recipient field", async () => {
    callGoogleAPIMock.mockResolvedValue({ id: "m1", threadId: "t1" });

    await expect(
      sendWarmReconnectCampaignEmail("access-token", message)
    ).resolves.toEqual({ id: "m1", threadId: "t1" });
    expect(callGoogleAPIMock).toHaveBeenCalledWith(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
      "access-token",
      expect.objectContaining({ method: "POST" }),
      undefined
    );
    const requestBody = JSON.parse(callGoogleAPIMock.mock.calls[0]?.[2]?.body);
    const decoded = Buffer.from(
      requestBody.raw.replace(/-/g, "+").replace(/_/g, "/"),
      "base64"
    ).toString("utf8");
    expect(decoded).toContain("To: friend@example.com");
    expect(decoded).toContain("Message-ID: <pilot_recipient_action@example.org>");
  });
});
