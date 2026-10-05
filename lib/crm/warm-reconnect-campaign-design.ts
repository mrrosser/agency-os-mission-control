import "server-only";

import { ApiError } from "@/lib/api/handler";
import type { WarmReconnectContentMode } from "@/lib/crm/warm-reconnect-activation-types";
import {
  renderWarmReconnectEmail,
  resolveWarmReconnectContentMode,
  warmReconnectRendererImplementationFingerprint,
  type WarmReconnectEmailRenderInput,
  type WarmReconnectRenderedEmail,
} from "@/lib/crm/warm-reconnect-email-renderer";
import { warmReconnectFingerprint } from "@/lib/crm/warm-reconnect-dedupe";
import { warmReconnectChoiceUrl } from "@/lib/crm/warm-reconnect-preference-choice";
import { OWNER_QA_DESIGN_KIT } from "@/lib/crm/warm-reconnect-qa-design-kit";
import {
  warmReconnectQaAssetManifest,
  warmReconnectQaInlineAssets,
  warmReconnectQaPreviewHtml,
} from "@/lib/crm/warm-reconnect-qa-design";

export const WARM_RECONNECT_CAMPAIGN_DESIGN_VERSION = "rosser-rt-library-kit-v1" as const;
export const WARM_RECONNECT_CAMPAIGN_RENDERER_VERSION = "warm-reconnect-approved-design-renderer.v1" as const;
export type WarmReconnectCampaignRenderedEmail = Omit<WarmReconnectRenderedEmail, "rendererVersion"> & {
  rendererVersion: WarmReconnectRenderedEmail["rendererVersion"] | typeof WARM_RECONNECT_CAMPAIGN_RENDERER_VERSION;
};

export function resolveWarmReconnectCampaignContentMode(value: unknown): WarmReconnectContentMode {
  return value === "approved_design_v2" ? value : resolveWarmReconnectContentMode(value);
}

export function isWarmReconnectCampaignArtworkMode(value: unknown): boolean {
  const mode = resolveWarmReconnectCampaignContentMode(value);
  return mode === "artwork_html" || mode === "approved_design_v2";
}

/** Reuse the verified, immutable template/asset pin; never fetch remote artwork. */
export function warmReconnectCampaignAssetManifest() {
  return warmReconnectQaAssetManifest();
}
export function warmReconnectCampaignInlineAssets() {
  return warmReconnectQaInlineAssets();
}
export function warmReconnectCampaignPreviewHtml(html: string): string {
  return warmReconnectQaPreviewHtml(html);
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export function warmReconnectCampaignRendererImplementationFingerprint(contentMode?: unknown): string {
  if (resolveWarmReconnectCampaignContentMode(contentMode) !== "approved_design_v2") {
    return warmReconnectRendererImplementationFingerprint();
  }
  return warmReconnectFingerprint({
    contract: WARM_RECONNECT_CAMPAIGN_RENDERER_VERSION,
    designVersion: WARM_RECONNECT_CAMPAIGN_DESIGN_VERSION,
    templateSha256: OWNER_QA_DESIGN_KIT.templateSha256,
    zipSha256: OWNER_QA_DESIGN_KIT.zipSha256,
    assets: warmReconnectCampaignAssetManifest(),
    baseRenderer: warmReconnectRendererImplementationFingerprint(),
    implementation: [escapeHtml, renderWarmReconnectCampaignEmail, warmReconnectChoiceUrl].map((fn) => fn.toString()),
  });
}

export function renderWarmReconnectCampaignEmail(input: WarmReconnectEmailRenderInput): WarmReconnectCampaignRenderedEmail {
  const contentMode = resolveWarmReconnectCampaignContentMode(input.contentMode);
  if (contentMode !== "approved_design_v2") return renderWarmReconnectEmail(input);
  const assets = warmReconnectCampaignAssetManifest(); // validates every exact byte and the template
  if ((input.purpose !== undefined && input.purpose !== "campaign") ||
      input.senderName !== "Marcus Rosser" || input.legalEntity !== "Marcus Rosser / Rosser Gallery" ||
      input.physicalPostalAddress !== "2505 N Tonti St, New Orleans, LA 70117" ||
      input.campaign.copy.subject !== "A quick hello from Marcus") {
    throw new ApiError(409, "The approved campaign design requires its reviewed sender and subject.");
  }
  // This retains strict production capability URLs and the exact approved plain text.
  const original = renderWarmReconnectEmail({ ...input, purpose: "campaign", contentMode: "preference_buttons" });
  const firstName = String(input.firstName || "").trim().slice(0, 80) || "there";
  const replacements: Record<string, string> = {
    campaign_art_https_url: "cid:nurturer-v1@rosser-owner-qa",
    campaign_art_alt: "The Nurturer \u2014 sculpture by Marcus Rosser", campaign_art_title: "The Nurturer",
    first_name_or_there: firstName,
    gallery_choice_url: warmReconnectChoiceUrl(input.preferencesUrl, "rosser_gallery"),
    rt_choice_url: warmReconnectChoiceUrl(input.preferencesUrl, "rt_solutions"),
    both_choice_url: warmReconnectChoiceUrl(input.preferencesUrl, "both"),
    preferences_url: input.preferencesUrl, unsubscribe_url: input.preferencesUrl,
  };
  let html = OWNER_QA_DESIGN_KIT.template
    .replace(/^<!-- REVIEW ONLY\.[\s\S]*?-->\s*/, "")
    .replace(/@font-face\{[^}]*\}/g, "")
    .replace(/<td width="(43|36|21)%"/g, '<td valign="bottom" width="$1%"')
    .replace('src="assets/gallery-crest.png"', 'src="cid:gallery-crest-v1@rosser-owner-qa"')
    .replace('src="assets/rt-solutions-logo.png"', 'src="cid:rt-logo-v1@rosser-owner-qa"');
  for (const [field, value] of Object.entries(replacements)) html = html.replaceAll(`{{${field}}}`, escapeHtml(value));
  if (/\{\{|preview\.invalid|\bassets\/|\b(?:file|data):|<script|@font-face/i.test(html)) throw new ApiError(409, "Unresolved campaign design content.");
  const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  for (const paragraph of [...input.campaign.copy.paragraphs, ...input.campaign.copy.postCtaParagraphs]) {
    if (!text.includes(paragraph.replace(/\s+/g, " "))) throw new ApiError(409, "The approved campaign copy changed.");
  }
  const rendered = { ...original, rendererVersion: WARM_RECONNECT_CAMPAIGN_RENDERER_VERSION, contentMode, html, artworkUrl: "cid:nurturer-v1@rosser-owner-qa" };
  return {
    ...rendered,
    contractFingerprint: warmReconnectFingerprint({
      contract: "warm-reconnect-approved-design-delivery.v1",
      designVersion: WARM_RECONNECT_CAMPAIGN_DESIGN_VERSION, assets,
      contentMode, subject: rendered.subject, plainText: rendered.plainText,
      html: rendered.html, artworkUrl: rendered.artworkUrl,
    }),
  };
}
