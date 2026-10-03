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
  it("keeps the legacy multipart output when artwork mode is explicit", () => {
    expect(
      buildWarmReconnectCampaignMime({ ...message, contentMode: "artwork_html" })
    ).toBe(buildWarmReconnectCampaignMime(message));
  });

  it.each([undefined, "artwork_html"] as const)(
    "requires the HTML alternative in artwork mode: %s",
    (contentMode) => {
      expect(() =>
        buildWarmReconnectCampaignMime({ ...message, contentMode, html: "" })
      ).toThrow("Campaign message requires plain-text and HTML alternatives");
    }
  );

  it("builds a single plain-text part with the exact footer and preference controls", () => {
    const plainText = [
      "Hi Alex,",
      "A quick hello from Marcus.",
      "Marcus Rosser",
      "RT Solutions LLC | 123 Example Street, New Orleans, LA 70112",
      `Update preferences: ${preferencesUrl}`,
      `Unsubscribe from all messages: ${preferencesUrl}`,
    ].join("\n\n");
    const mime = buildWarmReconnectCampaignMime({
      ...message,
      contentMode: "plain_text",
      plainText,
      html: "",
    });
    const [headers, encodedBody] = mime.split("\r\n\r\n");
    const decodedBody = Buffer.from(encodedBody, "base64").toString("utf8");

    expect(headers).toContain("Content-Type: text/plain; charset=utf-8");
    expect(headers).toContain("Content-Transfer-Encoding: base64");
    expect(headers).toContain(`List-Unsubscribe: <${oneClickUnsubscribeUrl}>`);
    expect(headers).toContain("List-Unsubscribe-Post: List-Unsubscribe=One-Click");
    expect(headers).toContain("To: friend@example.com\r\n");
    expect(headers).toContain("Reply-To: reply@example.org\r\n");
    expect(headers).not.toContain(preferencesUrl);
    expect(mime).not.toContain("multipart/");
    expect(mime).not.toContain("text/html");
    expect(mime).not.toContain("boundary=");
    expect(decodedBody).toBe(plainText);
    expect(decodedBody).not.toContain(oneClickUnsubscribeUrl);
    expect(decodedBody).not.toContain("<img");
  });

  it.each(["<p>Injected HTML</p>", " ", undefined])(
    "rejects HTML or an omitted HTML field in explicit plain-text mode: %s",
    (html) => {
      expect(() =>
        buildWarmReconnectCampaignMime({
          ...message,
          contentMode: "plain_text",
          html: html as string,
        })
      ).toThrow("Plain-text campaign message must not contain HTML");
    }
  );

  it.each(["", "  \n", undefined])(
    "rejects empty plain-text content: %s",
    (plainText) => {
      expect(() =>
        buildWarmReconnectCampaignMime({
          ...message,
          contentMode: "plain_text",
          html: "",
          plainText: plainText as string,
        })
      ).toThrow("Campaign message requires nonempty plain text");
    }
  );

  it.each(["plain", "", null])("rejects an unknown content mode: %s", (contentMode) => {
    expect(() =>
      buildWarmReconnectCampaignMime({ ...message, contentMode: contentMode as never })
    ).toThrow("Invalid campaign content mode");
  });

  it("requires the human preference link and hides the one-click capability in plain-text mode", () => {
    for (const plainText of [
      "No preference link here.",
      `Preferences: ${preferencesUrl}\nUnsubscribe: ${oneClickUnsubscribeUrl}`,
    ]) {
      expect(() =>
        buildWarmReconnectCampaignMime({
          ...message,
          contentMode: "plain_text",
          html: "",
          plainText,
        })
      ).toThrow("Visible unsubscribe must use the human preference URL");
    }
  });

  it.each([
    `http://leadflow-review.web.app/preferences#token=${preferenceToken}`,
    `https://leadflow-review.web.app/preferences?token=${preferenceToken}`,
    "https://leadflow-review.web.app/preferences#token=short",
  ])("rejects a malformed preference URL in plain-text mode: %s", (invalidUrl) => {
    expect(() =>
      buildWarmReconnectCampaignMime({
        ...message,
        contentMode: "plain_text",
        html: "",
        preferencesUrl: invalidUrl,
        plainText: `Preferences: ${invalidUrl}`,
      })
    ).toThrow("Invalid preferences URL");
  });

  it.each([
    `http://leadflow-review.web.app/api/crm/warm-reconnect/unsubscribe/${unsubscribeOnlyToken}`,
    `${oneClickUnsubscribeUrl}#token=unexpected`,
    `https://other.example/api/crm/warm-reconnect/unsubscribe/${unsubscribeOnlyToken}`,
    "https://leadflow-review.web.app/api/crm/warm-reconnect/unsubscribe/short",
  ])("rejects an unsafe one-click URL in plain-text mode: %s", (invalidUrl) => {
    expect(() =>
      buildWarmReconnectCampaignMime({
        ...message,
        contentMode: "plain_text",
        html: "",
        oneClickUnsubscribeUrl: invalidUrl,
      })
    ).toThrow("Invalid one-click unsubscribe URL");
  });

  it("rejects reused capabilities in plain-text mode", () => {
    expect(() =>
      buildWarmReconnectCampaignMime({
        ...message,
        contentMode: "plain_text",
        html: "",
        oneClickUnsubscribeUrl:
          `https://leadflow-review.web.app/api/crm/warm-reconnect/unsubscribe/${preferenceToken}`,
      })
    ).toThrow("must be distinct");
  });

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
