/** Pure, bounded classifier for separately threaded Gmail DSNs.
 * Call only with an original message already verified against a frozen delivery receipt.
 * A report is evidence of what the mail system reported, not consent or send authority.
 * No network, persistence, address correction, retry or suppression mutations occur here.
 */
export interface VerifiedSentNoticeTarget {
  providerMessageId: string;
  providerThreadId: string;
  rfcMessageId: string;
  senderEmail: string;
  recipientEmail: string;
  sentAt: string;
}
type Part = { mimeType?: string; headers?: { name?: string; value?: string }[]; body?: { data?: string }; parts?: Part[] };
export interface SeparateNoticeMessage { id?: string; threadId?: string; internalDate?: string; labelIds?: string[]; payload?: Part }
export interface AttributedSeparateNotice {
  providerMessageId: string;
  providerThreadId: string;
  originalProviderMessageId: string;
  originalProviderThreadId: string;
  kind: "separate_delivery_notice";
  reportedAction: "failed" | "delayed" | "delivered" | "relayed" | "expanded";
  enhancedStatus: string;
  occurredAt: string;
  attribution: "attached_original_message_id_and_recipient";
}
const ID = /^[a-f0-9]{1,64}$/;
const MAX_PARTS = 40;
const MAX_DEPTH = 6;
const MAX_DATA = 64 * 1024;
function address(value: string): string | null {
  if (/[,;\r\n]/.test(value)) return null;
  const email = (value.match(/<([^<>]+)>/)?.[1] || value).trim().toLowerCase();
  return /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(email) ? email : null;
}
function header(part: Part, name: string): string {
  const matches = (part.headers || []).filter(h => h.name?.toLowerCase() === name.toLowerCase());
  return matches.length === 1 ? matches[0].value || "" : "";
}
function fields(text: string): Map<string, string[]> | null {
  // Reject folded/ambiguous fields rather than guessing an identity.
  if (/\r?\n[ \t]/.test(text)) return null;
  const result = new Map<string, string[]>();
  for (const line of text.split(/\r?\n/)) {
    const match = /^([A-Za-z-]+):[ \t]*(.*)$/.exec(line);
    if (!match) { if (line.trim()) return null; continue; }
    const name = match[1].toLowerCase();
    result.set(name, [...(result.get(name) || []), match[2].trim()]);
  }
  return result;
}
function one(map: Map<string, string[]>, name: string) { const values = map.get(name); return values?.length === 1 ? values[0] : ""; }
export function attributeSeparateDeliveryNotice(message: SeparateNoticeMessage, target: VerifiedSentNoticeTarget): AttributedSeparateNotice | null {
  if (!ID.test(message.id || "") || !ID.test(message.threadId || "") || !ID.test(target.providerMessageId) || !ID.test(target.providerThreadId) || message.threadId === target.providerThreadId || message.labelIds?.includes("SENT")) return null;
  if (!/^<[^\s<>]{1,500}>$/.test(target.rfcMessageId)) return null;
  const sender = address(target.senderEmail), recipient = address(target.recipientEmail);
  const sent = Date.parse(target.sentAt), occurred = Number(message.internalDate);
  if (!sender || !recipient || !Number.isFinite(sent) || !Number.isSafeInteger(occurred) || occurred < sent || occurred > sent + 30 * 86400_000) return null;
  const root = message.payload;
  if (!root || address(header(root, "From")) !== "mailer-daemon@googlemail.com" || address(header(root, "To")) !== sender || root.mimeType?.toLowerCase() !== "multipart/report" || !/report-type\s*=\s*"?delivery-status(?:[";\s]|$)/i.test(header(root, "Content-Type"))) return null;
  const parts: Part[] = []; let bytes = 0;
  const walk = (part: Part, depth: number): boolean => {
    if (depth > MAX_DEPTH || parts.length >= MAX_PARTS) return false;
    parts.push(part); bytes += part.body?.data?.length || 0;
    return bytes <= MAX_DATA && (part.parts || []).every(child => walk(child, depth + 1));
  };
  if (!walk(root, 0)) return null;
  const decode = (part: Part): string | null => {
    const data = part.body?.data;
    if (!data || !/^[A-Za-z0-9_-]+={0,2}$/.test(data)) return null;
    const text = Buffer.from(data, "base64url").toString("utf8");
    return text.includes("\ufffd") ? null : text;
  };
  const originals = parts.filter(p => ["message/rfc822", "text/rfc822-headers"].includes(p.mimeType?.toLowerCase() || ""));
  if (originals.length !== 1) return null;
  const originalText = decode(originals[0]);
  let originalFields = originalText ? fields(originalText.split(/\r?\n\r?\n/)[0]) : null;
  // Gmail may expose attached RFC822 headers structurally instead of inline data.
  // Accept exactly one structural header source; never use arbitrary descendant headers.
  if (!originalText) {
    const source = originals[0];
    const sources = [source, ...(source.parts || [])].filter(p => p.headers?.some(h => h.name?.toLowerCase() === "message-id"));
    if (sources.length === 1) {
      originalFields = new Map<string,string[]>();
      for (const h of sources[0].headers || []) {
        if (!h.name || !h.value || /[\r\n]/.test(h.value)) return null;
        const key = h.name.toLowerCase();
        originalFields.set(key,[...(originalFields.get(key)||[]),h.value.trim()]);
      }
    }
  }
  if (!originalFields || one(originalFields,"message-id") !== target.rfcMessageId || address(one(originalFields,"from")) !== sender || address(one(originalFields,"to")) !== recipient) return null;
  const statuses = parts.filter(p => p.mimeType?.toLowerCase() === "message/delivery-status");
  if (statuses.length !== 1) return null;
  const statusText = decode(statuses[0]); if (!statusText) return null;
  const blocks = statusText.split(/\r?\n\r?\n/).filter(block => block.trim()).map(fields);
  if (blocks.some(block => !block)) return null;
  const recipients = blocks.filter(block => block!.has("final-recipient"));
  if (recipients.length !== 1) return null;
  const report = recipients[0]!;
  const finalRecipient = /^rfc822;\s*(.+)$/i.exec(one(report,"final-recipient"));
  if (!finalRecipient || address(finalRecipient[1]) !== recipient) return null;
  const action = one(report,"action"), status = one(report,"status");
  if (!["failed","delayed","delivered","relayed","expanded"].includes(action) || !/^[245]\.\d{1,3}\.\d{1,3}$/.test(status)) return null;
  if ((action === "failed" && !status.startsWith("5.")) || (action === "delayed" && !status.startsWith("4.")) || (["delivered","relayed","expanded"].includes(action) && !status.startsWith("2."))) return null;
  return { providerMessageId: message.id!, providerThreadId: message.threadId!, originalProviderMessageId: target.providerMessageId, originalProviderThreadId: target.providerThreadId, kind: "separate_delivery_notice", reportedAction: action as AttributedSeparateNotice["reportedAction"], enhancedStatus: status, occurredAt: new Date(occurred).toISOString(), attribution: "attached_original_message_id_and_recipient" };
}
