import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildWarmReconnectCampaignDraft } from "@/lib/crm/warm-reconnect";
import { renderWarmReconnectEmail, warmReconnectRendererImplementationFingerprint } from "@/lib/crm/warm-reconnect-email-renderer";
import { renderWarmReconnectQaDesign, warmReconnectQaAssetManifest, warmReconnectQaDesignReady, warmReconnectQaInlineAssets, warmReconnectQaPreviewHtml, warmReconnectQaRendererFingerprint } from "@/lib/crm/warm-reconnect-qa-design";
import { OWNER_QA_DESIGN_KIT } from "@/lib/crm/warm-reconnect-qa-design-kit";
import { WARM_RECONNECT_QA_ORIGINAL_TEST_ID as ORIGINAL, WARM_RECONNECT_QA_REVISED_TEST_ID as REVISED, warmReconnectQaVersion } from "@/lib/crm/warm-reconnect-qa-version";
import { buildWarmReconnectCampaignMimeWithInlineAssets } from "@/lib/google/gmail-campaign";

const summary = {
  schemaVersion: 1, sourceOfTruth: "firestore_portfolio_registry", dataClassification: "aggregate_only", readOnly: true,
  outreach: { status: "blocked", eligibleContacts: 0 }, permissions: { contactPointStates: { unknown: 0 }, sourceRecordsWithNoPermissionBasis: 0 },
  totals: { people: 0, contactPoints: 0, emailContactPoints: 0 }, brands: { unassigned: 0 }, freshness: { observedAt: "2026-10-05T00:00:00Z" },
} as never;
const input = {
  purpose: "owner_qa" as const, contentMode: "preference_buttons" as const,
  campaign: buildWarmReconnectCampaignDraft(summary), firstName: "Marcus", senderName: "Marcus Rosser",
  legalEntity: "Marcus Rosser / Rosser Gallery", physicalPostalAddress: "2505 N Tonti St, New Orleans, LA 70117",
  publicOrigin: "https://leadflow-review.web.app",
  preferencesUrl: `https://leadflow-review.web.app/preferences#token=${"p".repeat(43)}&mode=qa`,
  unsubscribeUrl: `https://leadflow-review.web.app/api/crm/warm-reconnect/qa/unsubscribe/${"u".repeat(43)}`,
};
const sha = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");

describe("exact version-1 Library design integration", () => {
  it("retains the original rendering and implementation fingerprint byte for byte", () => {
    expect(renderWarmReconnectQaDesign(ORIGINAL, input)).toEqual(renderWarmReconnectEmail(input));
    expect(warmReconnectQaRendererFingerprint(ORIGINAL)).toBe(warmReconnectRendererImplementationFingerprint());
  });

  it("renders the exact template with three exact assets and inert synthetic QA links for review", () => {
    const rendered = renderWarmReconnectQaDesign(REVISED, input);
    const preview = warmReconnectQaPreviewHtml(rendered.html);
    const assets = warmReconnectQaInlineAssets();
    expect(rendered.plainText).toBe(renderWarmReconnectEmail(input).plainText);
    expect(rendered.html).toContain("The Nurturer");
    expect(rendered.html).toContain("#fff9f0");
    expect(rendered.html).toContain("Georgia,'Times New Roman',serif");
    expect(rendered.html).not.toMatch(/\{\{|preview\.invalid|assets\/|@font-face|\bdata:|<script|<form|<iframe/);
    for (const choice of ["rosser_gallery", "rt_solutions", "both"]) expect(rendered.html).toContain(`mode=qa&amp;choice=${choice}`);
    expect(rendered.html.match(/src="cid:/g)).toHaveLength(3);
    expect(preview.match(/src="data:image\//g)).toHaveLength(3);
    expect(assets.map(asset => sha(asset.bytes))).toEqual(warmReconnectQaAssetManifest().map(asset => asset.sha256));
    const message = {
      purpose: "owner_qa" as const, contentMode: "preference_buttons" as const, to: "owner-qa@example.test",
      from: "mrosser@rossergallery.com", senderName: "Marcus Rosser", replyTo: "mrosser@rossergallery.com",
      subject: warmReconnectQaVersion(REVISED).subject, plainText: rendered.plainText, html: rendered.html,
      messageId: "<qa-design-v2-preview@rossergallery.com>", preferencesUrl: input.preferencesUrl,
      oneClickUnsubscribeUrl: input.unsubscribeUrl, inlineAssets: assets,
    };
    const mime = buildWarmReconnectCampaignMimeWithInlineAssets(message);
    expect(mime.match(/Content-ID:/g)).toHaveLength(3);
    expect(mime).toContain("List-Unsubscribe-Post: List-Unsubscribe=One-Click");
    // Explicit opt-in local evidence export; never invokes a provider or issues a capability.
    if (process.env.OWNER_QA_PREVIEW_EXPORT === "1") {
      const output = resolve("../output/owner-email-v2-20261005"); mkdirSync(output, { recursive: true });
      const files = { "revised-owner.html": rendered.html, "revised-owner-preview.html": preview, "revised-owner.txt": rendered.plainText, "revised-owner.eml": mime };
      for (const [name, contents] of Object.entries(files)) writeFileSync(resolve(output, name), contents);
      writeFileSync(resolve(output, "manifest.json"), JSON.stringify({
        syntheticOnly: true, providerActions: 0, capabilitiesIssued: 0, recipient: "owner-qa@example.test", testId: REVISED,
        libraryId: OWNER_QA_DESIGN_KIT.libraryId, libraryVersion: 1, zipSha256: OWNER_QA_DESIGN_KIT.zipSha256,
        templateSha256: OWNER_QA_DESIGN_KIT.templateSha256, assets: warmReconnectQaAssetManifest(),
        rendererFingerprint: warmReconnectQaRendererFingerprint(REVISED), files: Object.fromEntries(Object.entries(files).map(([name, content]) => [name, { bytes: Buffer.byteLength(content), sha256: sha(content) }])),
        notice: "Synthetic p/u capabilities were never issued. Preview resolves the exact CID bytes as data URIs for local inspection only. No delivery or inbox certification.",
      }, null, 2));
    }
  });

  it("fails closed when the bundled asset bytes change or go missing", () => {
    const asset = OWNER_QA_DESIGN_KIT.assets[0] as unknown as { base64: string };
    const before = asset.base64;
    try {
      asset.base64 = "";
      expect(warmReconnectQaDesignReady(REVISED)).toBe(false);
      expect(() => renderWarmReconnectQaDesign(REVISED, input)).toThrow("cannot be prepared or sent");
      expect(() => warmReconnectQaInlineAssets()).toThrow("asset mismatch");
      expect(warmReconnectQaDesignReady(ORIGINAL)).toBe(true);
    } finally { asset.base64 = before; }
  });

  it("rejects production preference URLs, changed copy and nonowner content", () => {
    expect(() => renderWarmReconnectQaDesign(REVISED, { ...input, preferencesUrl: input.preferencesUrl.replace("&mode=qa", "") })).toThrow("Invalid preferences URL");
    expect(() => renderWarmReconnectQaDesign(REVISED, { ...input, purpose: "campaign" })).toThrow("fixed to this owner test");
    expect(() => renderWarmReconnectQaDesign(REVISED, { ...input, campaign: { ...input.campaign, copy: { ...input.campaign.copy, paragraphs: ["Different introduction", input.campaign.copy.paragraphs[1], input.campaign.copy.paragraphs[2]] } } })).toThrow("copy changed");
  });
});
