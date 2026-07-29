import { afterEach, describe, expect, it, vi } from "vitest";
import { sendEmail } from "@/lib/google/gmail";

function decodeBase64Url(value: string): string {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(padded, "base64").toString("utf8");
}

describe("Gmail multipart delivery", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends deterministic Message-ID with plain-text and HTML alternatives", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "gmail-id", threadId: "thread-id" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      sendEmail("access-token", {
        to: ["visitor@example.com"],
        subject: "Thank you",
        body: "Plain thank-you",
        htmlBody: "<p>HTML thank-you</p>",
        messageId:
          "<intake.0123456789abcdef0123456789abcdef0123456789abcdef@rossergallery.com>",
      })
    ).resolves.toEqual({ id: "gmail-id", threadId: "thread-id" });

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const encoded = JSON.parse(String(init.body)) as { raw: string };
    const raw = decodeBase64Url(encoded.raw);
    expect(raw).toContain(
      "Message-ID: <intake.0123456789abcdef0123456789abcdef0123456789abcdef@rossergallery.com>"
    );
    expect(raw).toContain("Content-Type: multipart/alternative");
    expect(raw).toContain("Content-Type: text/plain; charset=utf-8");
    expect(raw).toContain("Plain thank-you");
    expect(raw).toContain("Content-Type: text/html; charset=utf-8");
    expect(raw).toContain("<p>HTML thank-you</p>");
  });

  it("rejects an unsafe Message-ID before provider dispatch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      sendEmail("access-token", {
        to: ["visitor@example.com"],
        subject: "Thank you",
        body: "Body",
        messageId: "unsafe\r\nBcc: attacker@example.com",
      })
    ).rejects.toThrow("Invalid RFC 5322 Message-ID");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
