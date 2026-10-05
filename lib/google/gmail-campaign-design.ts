import "server-only";

import { createHash } from "node:crypto";
import type { WarmReconnectContentMode } from "@/lib/crm/warm-reconnect-activation-types";
import {
  WARM_RECONNECT_CAMPAIGN_DESIGN_VERSION,
  resolveWarmReconnectCampaignContentMode,
  warmReconnectCampaignAssetManifest,
} from "@/lib/crm/warm-reconnect-campaign-design";
import { warmReconnectFingerprint } from "@/lib/crm/warm-reconnect-dedupe";
import { ROSSER_GALLERY_SENDING_EMAIL } from "@/lib/google/business-profiles";
import {
  buildWarmReconnectCampaignMime,
  buildWarmReconnectCampaignMimeWithInlineAssets,
  warmReconnectMimeImplementationFingerprint,
  type WarmReconnectCampaignMessage,
  type WarmReconnectInlineAsset,
} from "@/lib/google/gmail-campaign";

export type WarmReconnectCampaignDeliveryMessage = Omit<WarmReconnectCampaignMessage, "contentMode"> & {
  contentMode?: WarmReconnectContentMode;
  inlineAssets?: readonly WarmReconnectInlineAsset[];
};
export const WARM_RECONNECT_CAMPAIGN_INLINE_MIME_VERSION = "warm-reconnect-approved-design-mime.v1" as const;
const APPROVED_SENDER = {
  from: ROSSER_GALLERY_SENDING_EMAIL, replyTo: ROSSER_GALLERY_SENDING_EMAIL,
  senderName: "Marcus Rosser", subject: "A quick hello from Marcus",
} as const;

function base64Lines(value: string | Uint8Array): string {
  const bytes = typeof value === "string" ? Buffer.from(value.replace(/\r\n/g, "\n"), "utf8") : Buffer.from(value);
  return bytes.toString("base64").match(/.{1,76}/g)?.join("\r\n") || "";
}

function exactCampaignAssets(input: WarmReconnectCampaignDeliveryMessage) {
  if (input.purpose !== undefined && input.purpose !== "campaign") throw new Error("Approved campaign artwork cannot use owner QA authority.");
  if (input.from?.trim().toLowerCase() !== APPROVED_SENDER.from || input.replyTo?.trim().toLowerCase() !== APPROVED_SENDER.replyTo ||
      input.senderName !== APPROVED_SENDER.senderName || input.subject !== APPROVED_SENDER.subject) {
    throw new Error("The approved design requires the exact Gallery sender and subject.");
  }
  const manifest = warmReconnectCampaignAssetManifest();
  if (!Array.isArray(input.inlineAssets) || input.inlineAssets.length !== manifest.length) throw new Error("The exact approved campaign assets are required.");
  const seen = new Set<string>();
  const assets = input.inlineAssets.map((asset) => {
    if (!asset || seen.has(asset.contentId)) throw new Error("Duplicate approved campaign asset.");
    seen.add(asset.contentId);
    const expected = manifest.find((entry) => entry.contentId === asset.contentId);
    if (!expected || expected.filename !== asset.filename || expected.contentType !== asset.contentType || expected.sha256 !== asset.sha256 ||
        !(asset.bytes instanceof Uint8Array) || asset.bytes.byteLength !== expected.sizeBytes ||
        createHash("sha256").update(asset.bytes).digest("hex") !== expected.sha256) throw new Error("Approved campaign artwork changed.");
    return { ...asset, bytes: Buffer.from(asset.bytes) };
  });
  const references = [...input.html.matchAll(/\bcid:([^\s"'<>]+)/g)].map((match) => match[1]);
  if (references.length !== manifest.length || references.some((id) => !seen.has(id)) || assets.some((asset) => !references.includes(asset.contentId))) {
    throw new Error("Campaign CID references must match the exact approved images.");
  }
  return assets.sort((a, b) => a.contentId.localeCompare(b.contentId, "en"));
}

export function warmReconnectCampaignMimeImplementationFingerprint(contentMode?: unknown): string {
  if (resolveWarmReconnectCampaignContentMode(contentMode) !== "approved_design_v2") return warmReconnectMimeImplementationFingerprint();
  return warmReconnectFingerprint({
    contract: WARM_RECONNECT_CAMPAIGN_INLINE_MIME_VERSION, designVersion: WARM_RECONNECT_CAMPAIGN_DESIGN_VERSION,
    assets: warmReconnectCampaignAssetManifest(), sender: APPROVED_SENDER, baseMime: warmReconnectMimeImplementationFingerprint(),
    implementation: [base64Lines, exactCampaignAssets, buildWarmReconnectCampaignDeliveryMime].map((fn) => fn.toString()),
  });
}

export function buildWarmReconnectCampaignDeliveryMime(input: WarmReconnectCampaignDeliveryMessage): string {
  const mode = resolveWarmReconnectCampaignContentMode(input.contentMode);
  if (mode !== "approved_design_v2") {
    const legacy = { ...input, contentMode: mode as WarmReconnectCampaignMessage["contentMode"] };
    return input.inlineAssets === undefined ? buildWarmReconnectCampaignMime(legacy)
      : buildWarmReconnectCampaignMimeWithInlineAssets({ ...legacy, inlineAssets: input.inlineAssets });
  }
  const assets = exactCampaignAssets(input);
  // Reuse the complete production header/capability validation, without relaxing owner MIME.
  const original = buildWarmReconnectCampaignMime({ ...input, purpose: "campaign", contentMode: "preference_buttons" });
  const relatedBoundary = `related_${createHash("sha256").update(JSON.stringify([
    WARM_RECONNECT_CAMPAIGN_INLINE_MIME_VERSION, input.messageId, WARM_RECONNECT_CAMPAIGN_DESIGN_VERSION,
    assets.map(({ contentId, filename, contentType, sha256 }) => ({ contentId, filename, contentType, sha256 })),
  ])).digest("hex").slice(0, 32)}`;
  const htmlPart = ["Content-Type: text/html; charset=utf-8", "Content-Transfer-Encoding: base64", "", base64Lines(input.html)].join("\r\n");
  if (original.split(htmlPart).length !== 2) throw new Error("Expected one approved campaign HTML alternative.");
  const related = [
    `Content-Type: multipart/related; boundary="${relatedBoundary}"; type="text/html"`, "",
    `--${relatedBoundary}`, htmlPart,
    ...assets.flatMap((asset) => [
      `--${relatedBoundary}`, `Content-Type: ${asset.contentType}; name="${asset.filename}"`,
      "Content-Transfer-Encoding: base64", `Content-ID: <${asset.contentId}>`,
      `Content-Disposition: inline; filename="${asset.filename}"`, "", base64Lines(asset.bytes),
    ]),
    `--${relatedBoundary}--`,
  ].join("\r\n");
  return original.replace(htmlPart, related);
}
