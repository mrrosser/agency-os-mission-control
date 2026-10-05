import "server-only";

import { createHash } from "node:crypto";
import { ApiError } from "@/lib/api/handler";
import {
  renderWarmReconnectEmail, warmReconnectRendererImplementationFingerprint, warmReconnectRenderedContractFingerprint,
  type WarmReconnectEmailRenderInput,
} from "@/lib/crm/warm-reconnect-email-renderer";
import { WARM_RECONNECT_QA_ORIGINAL_TEST_ID, WARM_RECONNECT_QA_REVISED_TEST_ID, type WarmReconnectQaTestId } from "@/lib/crm/warm-reconnect-qa-version";
import { OWNER_QA_DESIGN_KIT } from "@/lib/crm/warm-reconnect-qa-design-kit";
import { warmReconnectChoiceUrl } from "@/lib/crm/warm-reconnect-preference-choice";
import type { WarmReconnectInlineAsset } from "@/lib/google/gmail-campaign";

/**
 * Exact user-supplied Library kit v1. Three unmodified images travel as CID MIME
 * parts, never public uploads. The owner preview resolves the same bytes locally.
 * A missing/changed template or asset fails closed. No request/env override.
 */
export function warmReconnectQaDesignReady(testId: WarmReconnectQaTestId): boolean {
  if (testId === WARM_RECONNECT_QA_ORIGINAL_TEST_ID) return true;
  if (testId !== WARM_RECONNECT_QA_REVISED_TEST_ID) return false;
  try { verifyKit(); return true; } catch { return false; }
}

const sha256 = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");

function verifyKit() {
  if (OWNER_QA_DESIGN_KIT.templateSha256 !== "e0e81491918ca8339f3fa0e0ee04348b0654825b864cad6b1bc7f18b690122ae" ||
      sha256(OWNER_QA_DESIGN_KIT.template) !== OWNER_QA_DESIGN_KIT.templateSha256 ||
      OWNER_QA_DESIGN_KIT.zipSha256 !== "d986a979c872c00d242e1a9a9ef15b5d65d63c84b3d75ec6cbdc2e3686dd57fc") throw new Error("Design kit mismatch");
  const expectedAssets = [
    ["nurturer-v1@rosser-owner-qa", "nurturer.jpg", "image/jpeg", "e99e2aad1099e98a829ec0ed1cc99eeabf65b5564b462f90797ff9c0de31e505"],
    ["gallery-crest-v1@rosser-owner-qa", "gallery-crest.png", "image/png", "3e1cfe02176b2c3dfaaaeb6bf5f308ceb68f92cf704c4f8074ea27aa582d1bc9"],
    ["rt-logo-v1@rosser-owner-qa", "rt-solutions-logo.png", "image/png", "b83227e9b5e8059d3a8cab89c7b94d8a953f435aa72e30f3c9c7ba7b8a8b5eae"],
  ];
  if (OWNER_QA_DESIGN_KIT.assets.length !== expectedAssets.length) throw new Error("Design asset mismatch");
  for (const [index, asset] of OWNER_QA_DESIGN_KIT.assets.entries()) {
    if (JSON.stringify([asset.contentId, asset.filename, asset.contentType, asset.sha256]) !== JSON.stringify(expectedAssets[index])) throw new Error("Design asset mismatch");
    const bytes = Buffer.from(asset.base64, "base64");
    if (bytes.length !== asset.sizeBytes || sha256(bytes) !== asset.sha256) throw new Error("Design asset mismatch");
  }
}

export function warmReconnectQaAssetManifest() {
  verifyKit();
  return OWNER_QA_DESIGN_KIT.assets.map(({ contentId, filename, contentType, sha256, sizeBytes }) => ({ contentId, filename, contentType, sha256, sizeBytes }));
}

export function warmReconnectQaInlineAssets(): readonly WarmReconnectInlineAsset[] {
  verifyKit();
  return OWNER_QA_DESIGN_KIT.assets.map(({ contentId, filename, contentType, sha256, base64 }) => ({ contentId, filename, contentType, sha256, bytes: Buffer.from(base64, "base64") }));
}

export function warmReconnectQaPreviewHtml(html: string): string {
  verifyKit();
  let preview = html;
  for (const asset of OWNER_QA_DESIGN_KIT.assets) preview = preview.replaceAll(`cid:${asset.contentId}`, `data:${asset.contentType};base64,${asset.base64}`);
  return preview;
}

export function assertWarmReconnectQaDesignReady(testId: WarmReconnectQaTestId): void {
  if (testId !== WARM_RECONNECT_QA_ORIGINAL_TEST_ID && testId !== WARM_RECONNECT_QA_REVISED_TEST_ID) {
    throw new ApiError(400, "Unknown owner test version.");
  }
  if (!warmReconnectQaDesignReady(testId)) throw new ApiError(409, "The exact revised design kit is not integrated. This version cannot be prepared or sent.");
}

export function warmReconnectQaRendererFingerprint(testId: WarmReconnectQaTestId): string {
  assertWarmReconnectQaDesignReady(testId);
  if (testId === WARM_RECONNECT_QA_ORIGINAL_TEST_ID) return warmReconnectRendererImplementationFingerprint();
  return `sha256:${sha256([
    "owner-qa-library-kit-v1-renderer.1", OWNER_QA_DESIGN_KIT.templateSha256, OWNER_QA_DESIGN_KIT.zipSha256,
    JSON.stringify(warmReconnectQaAssetManifest()), warmReconnectRendererImplementationFingerprint(),
    escapeHtml.toString(), renderWarmReconnectQaDesign.toString(), warmReconnectChoiceUrl.toString(),
  ].join("\n---\n"))}`;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export function renderWarmReconnectQaDesign(testId: WarmReconnectQaTestId, input: WarmReconnectEmailRenderInput) {
  assertWarmReconnectQaDesignReady(testId);
  if (testId === WARM_RECONNECT_QA_ORIGINAL_TEST_ID) return renderWarmReconnectEmail(input);
  if (input.purpose !== "owner_qa" || input.contentMode !== "preference_buttons" || input.firstName !== "Marcus" ||
      input.senderName !== "Marcus Rosser" || input.legalEntity !== "Marcus Rosser / Rosser Gallery" ||
      input.physicalPostalAddress !== "2505 N Tonti St, New Orleans, LA 70117") throw new ApiError(409, "The revised design is fixed to this owner test.");
  // Reuse existing strict QA URL checks and exactly the original plain-text copy.
  const original = renderWarmReconnectEmail(input);
  const replacements: Record<string, string> = {
    campaign_art_https_url: "cid:nurturer-v1@rosser-owner-qa",
    campaign_art_alt: "The Nurturer — sculpture by Marcus Rosser", campaign_art_title: "The Nurturer",
    first_name_or_there: "Marcus",
    gallery_choice_url: warmReconnectChoiceUrl(input.preferencesUrl, "rosser_gallery"),
    rt_choice_url: warmReconnectChoiceUrl(input.preferencesUrl, "rt_solutions"),
    both_choice_url: warmReconnectChoiceUrl(input.preferencesUrl, "both"),
    preferences_url: input.preferencesUrl, unsubscribe_url: input.preferencesUrl,
  };
  let html = OWNER_QA_DESIGN_KIT.template
    .replace(/^<!-- REVIEW ONLY\.[\s\S]*?-->\s*/, "")
    // Optional webfonts have no approved public URL. Preserve the kit's declared
    // Georgia/Arial fallback stacks; do not ship relative font paths or fetches.
    .replace(/@font-face\{[^}]*\}/g, "")
    // Align all three underlines when the Gallery label wraps on a 320px phone.
    .replace(/<td width="(43|36|21)%"/g, '<td valign="bottom" width="$1%"')
    .replace('src="assets/gallery-crest.png"', 'src="cid:gallery-crest-v1@rosser-owner-qa"')
    .replace('src="assets/rt-solutions-logo.png"', 'src="cid:rt-logo-v1@rosser-owner-qa"');
  for (const [field, value] of Object.entries(replacements)) html = html.replaceAll(`{{${field}}}`, escapeHtml(value));
  if (/\{\{|preview\.invalid|\bassets\/|\b(?:file|data):|<script|@font-face/i.test(html)) throw new ApiError(409, "Unresolved revised email content.");
  const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  for (const paragraph of [...input.campaign.copy.paragraphs, ...input.campaign.copy.postCtaParagraphs]) {
    if (!text.includes(paragraph.replace(/\s+/g, " "))) throw new ApiError(409, "The approved introduction or footer copy changed.");
  }
  const rendered = { ...original, html, artworkUrl: "cid:nurturer-v1@rosser-owner-qa" };
  return { ...rendered, contractFingerprint: warmReconnectRenderedContractFingerprint(rendered) };
}
