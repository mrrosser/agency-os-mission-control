import "server-only";

import { createHash } from "node:crypto";
import type { WarmReconnectCampaignDraft } from "@/lib/crm/warm-reconnect-types";
import type { WarmReconnectContentMode } from "@/lib/crm/warm-reconnect-activation-types";
import {
  WARM_RECONNECT_CHOICES,
  warmReconnectChoiceUrl,
} from "@/lib/crm/warm-reconnect-preference-choice";

export const WARM_RECONNECT_EMAIL_RENDERER_VERSION =
  "warm-reconnect-email-renderer.v2" as const;
export const WARM_RECONNECT_RENDERER_CONTRACT_VERSION =
  "warm-reconnect-renderer-contract.v1" as const;

export interface WarmReconnectEmailRenderInput {
  purpose?: "campaign" | "owner_qa";
  campaign: WarmReconnectCampaignDraft;
  contentMode?: WarmReconnectContentMode;
  firstName: string | null;
  senderName: string;
  legalEntity: string;
  physicalPostalAddress: string;
  preferencesUrl: string;
  unsubscribeUrl: string;
  publicOrigin: string;
}

export interface WarmReconnectRenderedEmail {
  rendererVersion: typeof WARM_RECONNECT_EMAIL_RENDERER_VERSION;
  contentMode: WarmReconnectContentMode;
  subject: string;
  plainText: string;
  html: string;
  artworkUrl: string;
  contractFingerprint: string;
}

export function warmReconnectRenderedContractFingerprint(input: {
  contentMode?: WarmReconnectContentMode;
  subject: string;
  plainText: string;
  html: string;
  artworkUrl: string;
}): string {
  return `sha256:${createHash("sha256")
    .update(
      JSON.stringify({
        contract: WARM_RECONNECT_RENDERER_CONTRACT_VERSION,
        rendererVersion: WARM_RECONNECT_EMAIL_RENDERER_VERSION,
        contentMode: resolveWarmReconnectContentMode(input.contentMode),
        subject: input.subject,
        plainText: input.plainText,
        html: input.html,
        artworkUrl: input.artworkUrl,
      })
    )
    .digest("hex")}`;
}

export function warmReconnectRendererImplementationFingerprint(): string {
  return `sha256:${createHash("sha256")
    .update(
      [
        WARM_RECONNECT_RENDERER_CONTRACT_VERSION,
        WARM_RECONNECT_EMAIL_RENDERER_VERSION,
        resolveWarmReconnectContentMode.toString(),
        cleanText.toString(),
        httpsUrl.toString(),
        assertPreferenceAndUnsubscribeUrls.toString(),
        escapeHtml.toString(),
        JSON.stringify(WARM_RECONNECT_CHOICES),
        warmReconnectChoiceUrl.toString(),
        renderWarmReconnectEmail.toString(),
      ].join("\n---\n")
    )
    .digest("hex")}`;
}

/** Stored pilots without a mode retain their original artwork approval boundary. */
export function resolveWarmReconnectContentMode(value: unknown): WarmReconnectContentMode {
  if (value === undefined || value === "artwork_html") return "artwork_html";
  if (value === "plain_text" || value === "preference_buttons") return value;
  throw new Error("Invalid warm reconnect content mode");
}

function cleanText(label: string, value: string, maxLength: number): string {
  const normalized = String(value || "").trim();
  if (!normalized || normalized.length > maxLength || /[\0]/.test(normalized)) {
    throw new Error(`Invalid ${label}`);
  }
  return normalized;
}

function httpsUrl(label: string, value: string, allowHash = false): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Invalid ${label}`);
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (!allowHash && url.hash) ||
    !url.hostname
  ) {
    throw new Error(`Invalid ${label}`);
  }
  return url;
}

const CAPABILITY_PATTERN = /^[A-Za-z0-9_-]{43,128}$/;

function assertPreferenceAndUnsubscribeUrls(input: {
  preferencesUrl: URL;
  unsubscribeUrl: URL;
  publicOrigin: URL;
  purpose?: "campaign" | "owner_qa";
}): void {
  const { preferencesUrl, unsubscribeUrl, publicOrigin } = input;
  const preferenceParams = new URLSearchParams(preferencesUrl.hash.slice(1));
  const preferenceToken = preferenceParams.get("token");
  const ownerQa = input.purpose === "owner_qa";
  if (input.purpose !== undefined && input.purpose !== "campaign" && !ownerQa) {
    throw new Error("Invalid email purpose");
  }
  const oneClickMatch = unsubscribeUrl.pathname.match(ownerQa
    ? /^\/api\/crm\/warm-reconnect\/qa\/unsubscribe\/([A-Za-z0-9_-]{43,128})$/
    : /^\/api\/crm\/warm-reconnect\/unsubscribe\/([A-Za-z0-9_-]{43,128})$/);
  if (
    preferencesUrl.origin !== publicOrigin.origin ||
    preferencesUrl.pathname !== "/preferences" ||
    preferencesUrl.search ||
    [...preferenceParams.keys()].length !== (ownerQa ? 2 : 1) ||
    (ownerQa && preferenceParams.get("mode") !== "qa") ||
    !preferenceToken ||
    !CAPABILITY_PATTERN.test(preferenceToken)
  ) {
    throw new Error("Invalid preferences URL");
  }
  if (
    unsubscribeUrl.origin !== publicOrigin.origin ||
    unsubscribeUrl.search ||
    unsubscribeUrl.hash ||
    !oneClickMatch
  ) {
    throw new Error("Invalid unsubscribe URL");
  }
  if (preferenceToken === oneClickMatch[1]) {
    throw new Error("Preference and unsubscribe capabilities must be distinct");
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderWarmReconnectEmail(
  input: WarmReconnectEmailRenderInput
): WarmReconnectRenderedEmail {
  const contentMode = resolveWarmReconnectContentMode(input.contentMode);
  const senderName = cleanText("sender name", input.senderName, 120);
  const legalEntity = cleanText("legal entity", input.legalEntity, 160);
  const postalAddress = cleanText(
    "physical postal address",
    input.physicalPostalAddress,
    300
  );
  const firstName = String(input.firstName || "").trim().slice(0, 80) || "there";
  const preferencesUrl = httpsUrl("preferences URL", input.preferencesUrl, true);
  const unsubscribeUrl = httpsUrl("unsubscribe URL", input.unsubscribeUrl);
  const publicOrigin = httpsUrl("public origin", input.publicOrigin);
  if (publicOrigin.pathname !== "/" || publicOrigin.search || publicOrigin.hash) {
    throw new Error("Invalid public origin");
  }
  assertPreferenceAndUnsubscribeUrls({
    preferencesUrl,
    unsubscribeUrl,
    publicOrigin,
    purpose: input.purpose,
  });
  const artworkUrl = contentMode === "artwork_html"
    ? new URL(input.campaign.artwork.url, publicOrigin).toString()
    : "";
  const paragraphs = [...input.campaign.copy.paragraphs];
  const postCta = [...input.campaign.copy.postCtaParagraphs];
  const greeting = `Hi ${firstName},`;
  const choices = WARM_RECONNECT_CHOICES.map((choice) => ({
    ...choice,
    url: warmReconnectChoiceUrl(preferencesUrl.toString(), choice.id),
  }));
  const websiteText = "Rosser Gallery: https://rossergallery.com\nRT.Solutions: https://rt.solutions";
  const websiteHtml = '<a href="https://rossergallery.com" style="color:inherit">Rosser Gallery</a> · <a href="https://rt.solutions" style="color:inherit">RT.Solutions</a>';

  const plainText = [
    greeting,
    ...paragraphs,
    contentMode === "preference_buttons"
      ? choices.map((choice) => `${choice.label}: ${choice.url}`).join("\n")
      : `${input.campaign.primaryCta.label}: ${preferencesUrl.toString()}`,
    ...postCta,
    senderName,
    "New Orleans, Louisiana",
    websiteText,
    "",
    `${legalEntity} · ${postalAddress}`,
    `Update preferences: ${preferencesUrl.toString()}`,
    `Unsubscribe from all messages: ${preferencesUrl.toString()}`,
  ].join("\n\n");

  const paragraphHtml = paragraphs
    .map((paragraph) => `<p style="margin:0 0 18px">${escapeHtml(paragraph)}</p>`)
    .join("");
  const postCtaHtml = postCta
    .map((paragraph) => `<p style="margin:0 0 18px">${escapeHtml(paragraph)}</p>`)
    .join("");
  const html = contentMode === "plain_text" ? "" : contentMode === "preference_buttons" ? [
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>',
    '<body style="margin:0;background:#ffffff;color:#242424;font-family:Arial,sans-serif">',
    '<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td style="padding:28px 20px">',
    '<div style="max-width:600px;margin:0 auto;font-size:16px;line-height:1.6">',
    `<p style="margin:0 0 18px">${escapeHtml(greeting)}</p>${paragraphHtml}`,
    `<p style="margin:24px 0">${choices.map((choice) => `<a href="${escapeHtml(choice.url)}" style="display:inline-block;margin:0 8px 10px 0;padding:12px 18px;border-radius:6px;background:#174a47;color:#ffffff;font-weight:bold;text-decoration:none">${escapeHtml(choice.label)}</a>`).join("")}</p>`,
    `${postCtaHtml}<p>${escapeHtml(senderName)}<br>New Orleans, Louisiana</p>`,
    `<p style="font-size:13px">${websiteHtml}</p>`,
    `<p style="margin-top:28px;font-size:12px;color:#555555">${escapeHtml(legalEntity)} · ${escapeHtml(postalAddress)}<br><a href="${escapeHtml(preferencesUrl.toString())}" style="color:inherit">Update preferences</a> · <a href="${escapeHtml(preferencesUrl.toString())}" style="color:inherit">Unsubscribe from all messages</a></p>`,
    "</div></td></tr></table></body></html>",
  ].join("") : [
    "<!doctype html>",
    '<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>',
    '<body style="margin:0;background:#0b0b0a;color:#f8f1e2;font-family:Arial,sans-serif">',
    '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#0b0b0a"><tr><td align="center" style="padding:24px 12px">',
    '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;border:1px solid #5d513b;border-radius:20px;overflow:hidden;background:#151411">',
    `<tr><td><img src="${escapeHtml(artworkUrl)}" alt="${escapeHtml(input.campaign.artwork.alt)}" width="640" style="display:block;width:100%;height:auto;opacity:.48"></td></tr>`,
    '<tr><td style="padding:32px 28px">',
    `<div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#9eeaf1">${escapeHtml(senderName)} · New Orleans</div>`,
    `<h1 style="margin:16px 0 24px;font-size:34px;line-height:1.15;color:#fff8e8">${escapeHtml(input.campaign.copy.subject)}</h1>`,
    `<div style="font-size:16px;line-height:1.65;color:#eee5d2"><p style="margin:0 0 18px">${escapeHtml(greeting)}</p>${paragraphHtml}</div>`,
    `<p style="margin:26px 0"><a href="${escapeHtml(preferencesUrl.toString())}" style="display:inline-block;border-radius:999px;background:#8ee8ef;color:#071011;padding:13px 22px;font-weight:bold;text-decoration:none">${escapeHtml(input.campaign.primaryCta.label)}</a></p>`,
    `<div style="font-size:16px;line-height:1.65;color:#eee5d2">${postCtaHtml}<p style="margin:0">${escapeHtml(senderName)}<br>New Orleans, Louisiana</p></div>`,
    `<p style="font-size:13px;color:#9eeaf1">${websiteHtml}</p>`,
    '<hr style="margin:28px 0 18px;border:0;border-top:1px solid #423d32">',
    `<p style="margin:0;font-size:12px;line-height:1.6;color:#aaa18f">${escapeHtml(legalEntity)} · ${escapeHtml(postalAddress)}<br><a href="${escapeHtml(preferencesUrl.toString())}" style="color:#9eeaf1">Update preferences</a> · <a href="${escapeHtml(preferencesUrl.toString())}" style="color:#9eeaf1">Unsubscribe</a></p>`,
    "</td></tr></table></td></tr></table></body></html>",
  ].join("");

  const rendered = {
    rendererVersion: WARM_RECONNECT_EMAIL_RENDERER_VERSION,
    contentMode,
    subject: input.campaign.copy.subject,
    plainText,
    html,
    artworkUrl,
  };
  return {
    ...rendered,
    contractFingerprint: warmReconnectRenderedContractFingerprint(rendered),
  };
}
