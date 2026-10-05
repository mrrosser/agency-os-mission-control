import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { callGoogleAPIMock } = vi.hoisted(() => ({ callGoogleAPIMock: vi.fn() }));
vi.mock("@/lib/google/tokens", () => ({ callGoogleAPI: callGoogleAPIMock }));

import {
  buildWarmReconnectCampaignMime,
  buildWarmReconnectCampaignMimeWithInlineAssets,
  warmReconnectInlineMimeImplementationFingerprint,
  type WarmReconnectInlineAsset,
  type WarmReconnectInlineMessage,
} from "@/lib/google/gmail-campaign";
import { sendWarmReconnectCampaignEmail } from "@/lib/google/gmail-campaign-sender";

const preferencesUrl = `https://leadflow-review.web.app/preferences#token=${"p".repeat(43)}&mode=qa`;
const oneClickUnsubscribeUrl = `https://leadflow-review.web.app/api/crm/warm-reconnect/qa/unsubscribe/${"u".repeat(43)}`;
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/wokAAAAASUVORK5CYII=", "base64");
const asset: WarmReconnectInlineAsset = {
  contentId: "art-v1@rosser-owner-qa", filename: "art.png", contentType: "image/png", bytes: png,
  sha256: createHash("sha256").update(png).digest("hex"),
};
const message: WarmReconnectInlineMessage = {
  purpose: "owner_qa", contentMode: "preference_buttons", to: "owner@example.com", from: "gallery@example.com",
  senderName: "Marcus Rosser", replyTo: "gallery@example.com", subject: "Owner design test",
  plainText: `Hello. Preferences: ${preferencesUrl}`,
  html: `<p>Hello.</p><img src="cid:${asset.contentId}" alt="Art"><a href="${preferencesUrl.replaceAll("&", "&amp;")}">Preferences</a>`,
  preferencesUrl, oneClickUnsubscribeUrl, messageId: "<owner_design_v2@example.com>", inlineAssets: [asset],
};

function decodedParts(raw: string) {
  return [...raw.matchAll(/Content-Type: ([^\r\n]+)\r\nContent-Transfer-Encoding: base64\r\n((?:(?!\r\n\r\n)[\s\S])*?)\r\n([A-Za-z0-9+/=\r\n]+?)(?=\r\n--)/g)]
    .map((part) => ({ type: part[1], headers: part[2], bytes: Buffer.from(part[3].replace(/\r\n/g, ""), "base64") }));
}

describe("owner inline artwork MIME", () => {
  beforeEach(() => { callGoogleAPIMock.mockReset(); });

  it("nests HTML and exact CID image bytes under related while preserving plain text and owner headers", () => {
    const mime = buildWarmReconnectCampaignMimeWithInlineAssets(message);
    expect(mime).toContain("Content-Type: multipart/alternative;");
    expect(mime).toContain("Content-Type: multipart/related;");
    expect(mime).toContain(`Content-ID: <${asset.contentId}>`);
    expect(mime).toContain('Content-Disposition: inline; filename="art.png"');
    expect(mime).toContain(`List-Unsubscribe: <${oneClickUnsubscribeUrl}>`);
    expect(mime).not.toMatch(/(?:^|\r\n)(?:Cc|Bcc):/);
    const parts = decodedParts(mime);
    expect(parts).toHaveLength(3);
    expect(parts[0].bytes.toString("utf8")).toBe(message.plainText);
    expect(parts[1].bytes.toString("utf8")).toBe(message.html);
    expect(parts[2].type).toBe('image/png; name="art.png"');
    expect(parts[2].bytes).toEqual(png);
    expect(createHash("sha256").update(parts[2].bytes).digest("hex")).toBe(asset.sha256);
  });

  it("is deterministic across asset input order and binds assets in its fingerprint", () => {
    const second = { ...asset, contentId: "brand-v1@rosser-owner-qa", filename: "brand.png" };
    const input = { ...message, html: message.html + `<img src="cid:${second.contentId}">`, inlineAssets: [asset, second] };
    expect(buildWarmReconnectCampaignMimeWithInlineAssets(input)).toBe(buildWarmReconnectCampaignMimeWithInlineAssets({ ...input, inlineAssets: [second, asset] }));
    expect(warmReconnectInlineMimeImplementationFingerprint()).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it.each([
    { contentId: "art\r\nBcc:victim@example.org" },
    { filename: 'art.png"\r\nBcc: victim@example.org' },
    { filename: "../art.png" },
    { filename: "art.jpg" },
    { contentType: "image/jpeg" },
    { contentType: "text/html" },
    { sha256: "0".repeat(64) },
    { sha256: asset.sha256.toUpperCase() },
    { bytes: new Uint8Array(0) },
    { bytes: Buffer.from("not an image") },
    { bytes: Buffer.alloc(2 * 1024 * 1024 + 1) },
  ])("rejects unsafe or mutated frozen artwork: %j", (change) => {
    expect(() => buildWarmReconnectCampaignMimeWithInlineAssets({ ...message, inlineAssets: [{ ...asset, ...change } as WarmReconnectInlineAsset] })).toThrow();
  });

  it.each([
    { inlineAssets: [], error: "count" },
    { inlineAssets: [asset, asset], error: "Duplicate" },
    { inlineAssets: Array.from({ length: 9 }, () => asset), error: "count" },
  ])("rejects absent, duplicate, or excessive attachments: $error", ({ inlineAssets, error }) => {
    expect(() => buildWarmReconnectCampaignMimeWithInlineAssets({ ...message, inlineAssets })).toThrow(error);
  });

  it("rejects aggregate inline artwork larger than four MiB", () => {
    const bytes = Buffer.alloc(2 * 1024 * 1024);
    png.subarray(0, 8).copy(bytes);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const inlineAssets = [0, 1, 2].map((n) => ({ ...asset, contentId: `art-${n}@rosser-owner-qa`, filename: `art-${n}.png`, bytes, sha256 }));
    expect(() => buildWarmReconnectCampaignMimeWithInlineAssets({ ...message, inlineAssets })).toThrow("total limit");
  });

  it("rejects missing/unused CID resources and campaign use", () => {
    expect(() => buildWarmReconnectCampaignMimeWithInlineAssets({ ...message, html: message.html.replace(asset.contentId, "missing@rosser-owner-qa") })).toThrow("references");
    expect(() => buildWarmReconnectCampaignMimeWithInlineAssets({ ...message, html: message.html.replace(`cid:${asset.contentId}`, "https://example.org/art.png") })).toThrow("references");
    expect(() => buildWarmReconnectCampaignMimeWithInlineAssets({ ...message, purpose: "campaign" })).toThrow();
    expect(() => buildWarmReconnectCampaignMimeWithInlineAssets({ ...message, contentMode: "plain_text", html: "" })).toThrow("restricted");
  });

  it("preserves the original sender's no-attachment MIME exactly", async () => {
    callGoogleAPIMock.mockResolvedValue({ id: "original", threadId: "original" });
    const { inlineAssets: ignored, ...original } = message;
    void ignored;
    await sendWarmReconnectCampaignEmail("test-access", original);
    const body = JSON.parse(callGoogleAPIMock.mock.calls[0][2].body);
    expect(Buffer.from(body.raw, "base64url").toString("utf8")).toBe(buildWarmReconnectCampaignMime(original));
    expect(callGoogleAPIMock).toHaveBeenCalledTimes(1);
  });

  it("makes exactly one provider attempt and does not retry an ambiguous result", async () => {
    callGoogleAPIMock.mockRejectedValue(new Error("connection lost"));
    await expect(sendWarmReconnectCampaignEmail("test-access", message)).rejects.toThrow("connection lost");
    expect(callGoogleAPIMock).toHaveBeenCalledTimes(1);
    const sent = Buffer.from(JSON.parse(callGoogleAPIMock.mock.calls[0][2].body).raw, "base64url").toString("utf8");
    expect(sent).toBe(buildWarmReconnectCampaignMimeWithInlineAssets(message));
  });

  it("rejects invalid inline assets before provider access", async () => {
    await expect(sendWarmReconnectCampaignEmail("test-access", { ...message, inlineAssets: [] })).rejects.toThrow();
    expect(callGoogleAPIMock).not.toHaveBeenCalled();
  });
});
