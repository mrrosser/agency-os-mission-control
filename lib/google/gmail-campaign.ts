import "server-only";

import { createHash } from "node:crypto";

const EMAIL_PATTERN = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const MESSAGE_ID_PATTERN = /^<[a-z0-9._-]+@[a-z0-9.-]+>$/i;
const CAPABILITY_PATTERN = /^[A-Za-z0-9_-]{43,128}$/;

export const WARM_RECONNECT_MIME_VERSION = "warm-reconnect-mime.v2" as const;

export function warmReconnectMimeImplementationFingerprint(): string {
  return `sha256:${createHash("sha256")
    .update(
      [
        WARM_RECONNECT_MIME_VERSION,
        resolveContentMode.toString(),
        assertHeaderValue.toString(),
        assertEmail.toString(),
        assertHttpsUrl.toString(),
        assertCapabilityBoundary.toString(),
        encodedHeader.toString(),
        encodedPhrase.toString(),
        base64Lines.toString(),
        encodeWarmReconnectMimeForGmail.toString(),
        buildWarmReconnectCampaignMime.toString(),
      ].join("\n---\n")
    )
    .digest("hex")}`;
}

export interface WarmReconnectCampaignMessage {
  purpose?: "campaign" | "owner_qa";
  contentMode?: "artwork_html" | "plain_text" | "preference_buttons";
  to: string;
  from: string;
  senderName: string;
  replyTo: string;
  subject: string;
  plainText: string;
  html: string;
  messageId: string;
  preferencesUrl: string;
  oneClickUnsubscribeUrl: string;
}

function resolveContentMode(
  value: WarmReconnectCampaignMessage["contentMode"]
): "artwork_html" | "plain_text" | "preference_buttons" {
  if (value === undefined) return "artwork_html";
  if (value === "artwork_html" || value === "plain_text" || value === "preference_buttons") return value;
  throw new Error("Invalid campaign content mode");
}

function assertHeaderValue(label: string, value: string): string {
  const normalized = String(value || "").trim();
  if (!normalized || /[\r\n\0]/.test(normalized)) {
    throw new Error(`Invalid ${label}`);
  }
  return normalized;
}

function assertEmail(label: string, value: string): string {
  const normalized = assertHeaderValue(label, value).toLowerCase();
  if (!EMAIL_PATTERN.test(normalized)) throw new Error(`Invalid ${label}`);
  return normalized;
}

function assertHttpsUrl(
  label: string,
  value: string,
  options: { allowHash?: boolean } = {}
): string {
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
    (!options.allowHash && url.hash) ||
    !url.hostname
  ) {
    throw new Error(`Invalid ${label}`);
  }
  return url.toString();
}

function assertCapabilityBoundary(
  preferencesValue: string,
  oneClickValue: string,
  purpose?: "campaign" | "owner_qa"
): void {
  const preferences = new URL(preferencesValue);
  const oneClick = new URL(oneClickValue);
  const preferenceParams = new URLSearchParams(preferences.hash.slice(1));
  const preferenceToken = preferenceParams.get("token");
  const ownerQa = purpose === "owner_qa";
  if (purpose !== undefined && purpose !== "campaign" && !ownerQa) {
    throw new Error("Invalid email purpose");
  }
  const oneClickMatch = oneClick.pathname.match(ownerQa
    ? /^\/api\/crm\/warm-reconnect\/qa\/unsubscribe\/([A-Za-z0-9_-]{43,128})$/
    : /^\/api\/crm\/warm-reconnect\/unsubscribe\/([A-Za-z0-9_-]{43,128})$/);
  if (
    preferences.pathname !== "/preferences" ||
    preferences.search ||
    [...preferenceParams.keys()].length !== (ownerQa ? 2 : 1) ||
    (ownerQa && preferenceParams.get("mode") !== "qa") ||
    !preferenceToken ||
    !CAPABILITY_PATTERN.test(preferenceToken)
  ) {
    throw new Error("Invalid preferences URL");
  }
  if (preferences.origin !== oneClick.origin || oneClick.search || !oneClickMatch) {
    throw new Error("Invalid one-click unsubscribe URL");
  }
  if (preferenceToken === oneClickMatch[1]) {
    throw new Error("Preference and unsubscribe capabilities must be distinct");
  }
}

function encodedHeader(value: string): string {
  const safe = assertHeaderValue("subject", value);
  if (/^[\x20-\x7e]+$/.test(safe)) return safe;
  return `=?UTF-8?B?${Buffer.from(safe, "utf8").toString("base64")}?=`;
}

function encodedPhrase(value: string): string {
  const safe = assertHeaderValue("sender name", value);
  return `=?UTF-8?B?${Buffer.from(safe, "utf8").toString("base64")}?=`;
}

function base64Lines(value: string): string {
  const encoded = Buffer.from(value.replace(/\r\n/g, "\n"), "utf8").toString("base64");
  return encoded.match(/.{1,76}/g)?.join("\r\n") || "";
}

export function encodeWarmReconnectMimeForGmail(value: string): string {
  return Buffer.from(value, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function buildWarmReconnectCampaignMime(
  input: WarmReconnectCampaignMessage
): string {
  const contentMode = resolveContentMode(input.contentMode);
  const to = assertEmail("recipient", input.to);
  const from = assertEmail("sender", input.from);
  const senderName = encodedPhrase(input.senderName);
  const replyTo = assertEmail("reply-to", input.replyTo);
  const subject = encodedHeader(input.subject);
  const messageId = assertHeaderValue("message id", input.messageId);
  if (!MESSAGE_ID_PATTERN.test(messageId)) throw new Error("Invalid message id");
  const preferencesUrl = assertHttpsUrl(
    "preferences URL",
    input.preferencesUrl,
    { allowHash: true }
  );
  const oneClickUrl = assertHttpsUrl(
    "one-click unsubscribe URL",
    input.oneClickUnsubscribeUrl
  );
  assertCapabilityBoundary(preferencesUrl, oneClickUrl, input.purpose);
  if (contentMode === "plain_text" && input.html !== "") {
    throw new Error("Plain-text campaign message must not contain HTML");
  }
  if (typeof input.plainText !== "string" || !input.plainText.trim()) {
    throw new Error("Campaign message requires nonempty plain text");
  }
  if (contentMode !== "plain_text" && !String(input.html || "").trim()) {
    throw new Error("Campaign message requires plain-text and HTML alternatives");
  }
  if (
    !input.plainText.includes(preferencesUrl) ||
    (contentMode !== "plain_text" && !input.html.includes(preferencesUrl.replace(/&/g, "&amp;"))) ||
    input.plainText.includes(oneClickUrl) ||
    (contentMode !== "plain_text" && input.html.includes(oneClickUrl))
  ) {
    throw new Error("Visible unsubscribe must use the human preference URL");
  }

  const headers = [
    `From: ${senderName} <${from}>`,
    `To: ${to}`,
    `Reply-To: ${replyTo}`,
    `Subject: ${subject}`,
    `Message-ID: ${messageId}`,
    "MIME-Version: 1.0",
    `List-Unsubscribe: <${oneClickUrl}>`,
    "List-Unsubscribe-Post: List-Unsubscribe=One-Click",
  ];
  if (contentMode === "plain_text") {
    return [
      ...headers,
      "Content-Type: text/plain; charset=utf-8",
      "Content-Transfer-Encoding: base64",
      "",
      base64Lines(input.plainText),
      "",
    ].join("\r\n");
  }

  const boundary = `warm_${createHash("sha256")
    .update(`${messageId}|${to}|${WARM_RECONNECT_MIME_VERSION}`)
    .digest("hex")
    .slice(0, 32)}`;
  headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
  const body = [
    `--${boundary}`,
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    base64Lines(input.plainText),
    `--${boundary}`,
    "Content-Type: text/html; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    base64Lines(input.html),
    `--${boundary}--`,
    "",
  ];
  return [...headers, "", ...body].join("\r\n");
}
