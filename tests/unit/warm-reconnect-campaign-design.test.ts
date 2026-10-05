import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
const { provider } = vi.hoisted(() => ({ provider: vi.fn() }));
vi.mock("@/lib/google/tokens", () => ({ callGoogleAPI: provider }));

import { buildWarmReconnectCampaignDraft } from "@/lib/crm/warm-reconnect";
import {
  renderWarmReconnectCampaignEmail, warmReconnectCampaignAssetManifest, warmReconnectCampaignInlineAssets,
  warmReconnectCampaignRendererImplementationFingerprint, warmReconnectCampaignPreviewHtml,
  WARM_RECONNECT_CAMPAIGN_RENDERER_VERSION, isWarmReconnectCampaignArtworkMode,
} from "@/lib/crm/warm-reconnect-campaign-design";
import { renderWarmReconnectEmail, warmReconnectRendererImplementationFingerprint } from "@/lib/crm/warm-reconnect-email-renderer";
import { renderWarmReconnectQaDesign } from "@/lib/crm/warm-reconnect-qa-design";
import { OWNER_QA_DESIGN_KIT } from "@/lib/crm/warm-reconnect-qa-design-kit";
import { WARM_RECONNECT_QA_REVISED_TEST_ID } from "@/lib/crm/warm-reconnect-qa-version";
import {
  buildWarmReconnectCampaignDeliveryMime, warmReconnectCampaignMimeImplementationFingerprint,
  type WarmReconnectCampaignDeliveryMessage,
} from "@/lib/google/gmail-campaign-design";
import { buildWarmReconnectCampaignMime, warmReconnectMimeImplementationFingerprint } from "@/lib/google/gmail-campaign";
import { sendWarmReconnectCampaignEmail } from "@/lib/google/gmail-campaign-sender";

const campaign = buildWarmReconnectCampaignDraft({
  schemaVersion: 1, sourceOfTruth: "firestore_portfolio_registry", dataClassification: "aggregate_only", readOnly: true,
  outreach: { status: "blocked", eligibleContacts: 0 }, permissions: { contactPointStates: { unknown: 0 }, sourceRecordsWithNoPermissionBasis: 0 },
  totals: { people: 0, contactPoints: 0, emailContactPoints: 0 }, brands: { unassigned: 0 }, freshness: { observedAt: "2026-10-05T00:00:00Z" },
} as never);
const origin = "https://leadflow-review.web.app";
const input = {
  contentMode: "approved_design_v2" as const, campaign, firstName: "Marcus", senderName: "Marcus Rosser",
  legalEntity: "Marcus Rosser / Rosser Gallery", physicalPostalAddress: "2505 N Tonti St, New Orleans, LA 70117",
  publicOrigin: origin, preferencesUrl: `${origin}/preferences#token=${"p".repeat(43)}`,
  unsubscribeUrl: `${origin}/api/crm/warm-reconnect/unsubscribe/${"u".repeat(43)}`,
};
const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
function message(overrides: Partial<typeof input> = {}): WarmReconnectCampaignDeliveryMessage {
  const rendered = renderWarmReconnectCampaignEmail({ ...input, ...overrides });
  return {
    contentMode: "approved_design_v2", to: "friend@example.test", from: "mrosser@rossergallery.com", replyTo: "mrosser@rossergallery.com",
    senderName: input.senderName, subject: rendered.subject, plainText: rendered.plainText, html: rendered.html,
    messageId: "<approved-campaign@example.test>", preferencesUrl: overrides.preferencesUrl || input.preferencesUrl,
    oneClickUnsubscribeUrl: overrides.unsubscribeUrl || input.unsubscribeUrl, inlineAssets: warmReconnectCampaignInlineAssets(),
  };
}
function decodeParts(mime: string) {
  return [...mime.matchAll(/Content-Type: ([^\r\n]+)\r\nContent-Transfer-Encoding: base64\r\n((?:(?!\r\n\r\n)[\s\S])*?)\r\n([A-Za-z0-9+/=\r\n]+?)(?=\r\n--)/g)]
    .map((part) => ({ type: part[1], headers: part[2], bytes: Buffer.from(part[3].replace(/\r\n/g, ""), "base64") }));
}

describe("approved production design boundary", () => {
  beforeEach(() => { provider.mockReset(); });

  it.each([undefined, "artwork_html", "plain_text", "preference_buttons"] as const)("preserves legacy %s rendering and fingerprints exactly", (contentMode) => {
    expect(renderWarmReconnectCampaignEmail({ ...input, contentMode })).toEqual(renderWarmReconnectEmail({ ...input, contentMode }));
    expect(warmReconnectCampaignRendererImplementationFingerprint(contentMode)).toBe(warmReconnectRendererImplementationFingerprint());
    expect(warmReconnectCampaignMimeImplementationFingerprint(contentMode)).toBe(warmReconnectMimeImplementationFingerprint());
  });

  it("matches the approved owner v2 design exactly except the production links", () => {
    const qa = renderWarmReconnectQaDesign(WARM_RECONNECT_QA_REVISED_TEST_ID, {
      ...input, contentMode: "preference_buttons", purpose: "owner_qa",
      preferencesUrl: `${input.preferencesUrl}&mode=qa`,
      unsubscribeUrl: input.unsubscribeUrl.replace("/unsubscribe/", "/qa/unsubscribe/"),
    });
    const rendered = renderWarmReconnectCampaignEmail(input);
    expect(rendered.html).toBe(qa.html.replaceAll("&amp;mode=qa", ""));
    expect(rendered.plainText).toBe(qa.plainText.replaceAll("&mode=qa", ""));
    expect(rendered.rendererVersion).toBe(WARM_RECONNECT_CAMPAIGN_RENDERER_VERSION);
    expect(rendered.subject).toBe("A quick hello from Marcus");
    expect(rendered.html).not.toMatch(/mode=qa|\/qa\/|\[TEST/);
    expect(warmReconnectCampaignPreviewHtml(rendered.html).match(/src="data:image\//g)).toHaveLength(3);
    expect(isWarmReconnectCampaignArtworkMode("approved_design_v2")).toBe(true);
    expect(isWarmReconnectCampaignArtworkMode("preference_buttons")).toBe(false);
  });

  it("renders five distinct frozen greetings and production capability pairs without crossing recipients", () => {
    const names = ["Avery", "Blake", "Cameron", "Devon", "Emery"];
    const fingerprints = new Set<string>();
    for (const [index, firstName] of names.entries()) {
      const preferenceToken = "p".repeat(42) + index;
      const unsubscribeToken = "u".repeat(42) + index;
      const preferencesUrl = `${origin}/preferences#token=${preferenceToken}`;
      const unsubscribeUrl = `${origin}/api/crm/warm-reconnect/unsubscribe/${unsubscribeToken}`;
      const rendered = renderWarmReconnectCampaignEmail({ ...input, firstName, preferencesUrl, unsubscribeUrl });
      expect(rendered.plainText).toMatch(new RegExp(`^Hi ${firstName},`));
      expect(rendered.html).toContain(`Hi ${firstName},`);
      for (const choice of ["rosser_gallery", "rt_solutions", "both"]) expect(rendered.html).toContain(`${preferenceToken}&amp;choice=${choice}`);
      expect(rendered.html).not.toContain(unsubscribeToken);
      expect(rendered.plainText).not.toContain(unsubscribeToken);
      const mime = buildWarmReconnectCampaignDeliveryMime(message({ firstName, preferencesUrl, unsubscribeUrl }));
      expect(mime).toContain(`List-Unsubscribe: <${unsubscribeUrl}>`);
      expect(decodeParts(mime)[1].bytes.toString("utf8")).toBe(rendered.html);
      fingerprints.add(rendered.contractFingerprint);
    }
    expect(fingerprints.size).toBe(5);
  });

  it("escapes the frozen name in HTML while keeping the reviewed plain text", () => {
    const rendered = renderWarmReconnectCampaignEmail({ ...input, firstName: 'Avery <&"' });
    expect(rendered.html).toContain("Avery &lt;&amp;&quot;");
    expect(rendered.plainText).toContain('Hi Avery <&",');
  });

  it.each([
    { purpose: "owner_qa" as const },
    { preferencesUrl: `${input.preferencesUrl}&mode=qa` },
    { unsubscribeUrl: input.unsubscribeUrl.replace("/unsubscribe/", "/qa/unsubscribe/") },
    { legalEntity: "Different identity" },
  ])("rejects wrong audience/link/identity authority: %j", (change) => {
    expect(() => renderWarmReconnectCampaignEmail({ ...input, ...change })).toThrow();
  });

  it("round-trips exactly the three approved CID byte streams and standard production headers", async () => {
    provider.mockResolvedValue({ id: "fixture-message", threadId: "fixture-thread" });
    const outbound = message();
    await sendWarmReconnectCampaignEmail("fixture-access", outbound);
    expect(provider).toHaveBeenCalledTimes(1);
    const mime = Buffer.from(JSON.parse(provider.mock.calls[0][2].body).raw, "base64url").toString("utf8");
    expect(mime).toBe(buildWarmReconnectCampaignDeliveryMime(outbound));
    expect(mime).toContain("Content-Type: multipart/alternative;");
    expect(mime).toContain("Content-Type: multipart/related;");
    expect(mime).not.toMatch(/(?:^|\r\n)(?:Cc|Bcc):/);
    expect(mime).toContain("Subject: A quick hello from Marcus\r\n");
    const parts = decodeParts(mime);
    expect(parts).toHaveLength(5);
    expect(parts[0].bytes.toString("utf8")).toBe(outbound.plainText);
    expect(parts[1].bytes.toString("utf8")).toBe(outbound.html);
    const manifest = warmReconnectCampaignAssetManifest();
    for (const part of parts.slice(2)) {
      const id = part.headers.match(/Content-ID: <([^>]+)>/)?.[1];
      const expected = manifest.find((entry) => entry.contentId === id)!;
      expect(expected).toBeDefined(); expect(hash(part.bytes)).toBe(expected.sha256); expect(part.bytes.byteLength).toBe(expected.sizeBytes);
    }
  });

  it.each(["missing", "changed-bytes", "duplicate", "wrong-filename", "unknown-cid", "qa-purpose", "qa-link", "wrong-from", "wrong-reply-to", "wrong-name", "test-subject"])("rejects %s before a provider request", async (fault) => {
    const outbound = message();
    const assets = [...outbound.inlineAssets!];
    if (fault === "missing") assets.pop();
    if (fault === "changed-bytes") assets[0] = { ...assets[0], bytes: Buffer.from("changed") };
    if (fault === "duplicate") assets[1] = assets[0];
    if (fault === "wrong-filename") assets[0] = { ...assets[0], filename: "other.jpg" };
    if (fault === "unknown-cid") outbound.html = outbound.html.replace("cid:nurturer-v1@rosser-owner-qa", "cid:unapproved@example.test");
    if (fault === "qa-purpose") outbound.purpose = "owner_qa";
    if (fault === "qa-link") outbound.preferencesUrl += "&mode=qa";
    if (fault === "wrong-from") outbound.from = "other@example.test";
    if (fault === "wrong-reply-to") outbound.replyTo = "other@example.test";
    if (fault === "wrong-name") outbound.senderName = "Other Person";
    if (fault === "test-subject") outbound.subject = "[TEST] A quick hello from Marcus";
    await expect(sendWarmReconnectCampaignEmail("fixture-access", { ...outbound, inlineAssets: assets })).rejects.toThrow();
    expect(provider).not.toHaveBeenCalled();
  });

  it("fails closed on kit drift and keeps legacy artifacts usable", () => {
    const asset = OWNER_QA_DESIGN_KIT.assets[0] as unknown as { base64: string };
    const original = asset.base64;
    try {
      asset.base64 = "";
      expect(() => renderWarmReconnectCampaignEmail(input)).toThrow();
      expect(() => warmReconnectCampaignRendererImplementationFingerprint("approved_design_v2")).toThrow();
      expect(() => warmReconnectCampaignMimeImplementationFingerprint("approved_design_v2")).toThrow();
      expect(warmReconnectCampaignMimeImplementationFingerprint("plain_text")).toBe(warmReconnectMimeImplementationFingerprint());
    } finally { asset.base64 = original; }
  });

  it("preserves legacy no-attachment MIME and never retries an ambiguous new-mode provider response", async () => {
    const rendered = renderWarmReconnectCampaignEmail({ ...input, contentMode: "preference_buttons" });
    const { inlineAssets: _ignored, ...base } = message(); void _ignored;
    const legacy = { ...base, contentMode: "preference_buttons" as const, plainText: rendered.plainText, html: rendered.html };
    expect(buildWarmReconnectCampaignDeliveryMime(legacy)).toBe(buildWarmReconnectCampaignMime(legacy));
    provider.mockRejectedValue(new Error("ambiguous outcome"));
    await expect(sendWarmReconnectCampaignEmail("fixture-access", message())).rejects.toThrow("ambiguous outcome");
    expect(provider).toHaveBeenCalledTimes(1);
  });
});
