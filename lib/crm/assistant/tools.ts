import "server-only";

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ApiError } from "@/lib/api/handler";
import { loadPortfolioCrmSummaryForUid } from "@/lib/crm/portfolio-registry";
import { buildWarmReconnectCampaignDraft } from "@/lib/crm/warm-reconnect";
import { FIRST_PARTY_SHARE_CARDS, buildFirstPartyShareActionData } from "@/lib/crm/share-cards";
import type { Logger } from "@/lib/logging";
import type { AssistantToolResult } from "./contracts";

const empty = z.object({}).strict();
const draftSchema = z.object({
  format: z.enum(["newsletter", "reply", "survey", "intake"]),
  subject: z.string().trim().min(1).max(160),
  body: z.string().trim().min(1).max(6000),
}).strict();
export const assistantToolInputSchema = z.discriminatedUnion("name", [
  z.object({ name: z.literal("get_crm_summary"), arguments: empty }).strict(),
  z.object({ name: z.literal("get_outreach_review"), arguments: empty }).strict(),
  z.object({ name: z.literal("get_share_cards"), arguments: empty }).strict(),
  z.object({ name: z.literal("prepare_draft"), arguments: draftSchema }).strict(),
]);

/** Caller must establish Firebase UID/workspace access first; no caller-owned identity arguments exist. */
export async function executeAssistantTool(
  uid: string,
  input: unknown,
  log: Logger,
): Promise<AssistantToolResult> {
  const parsed = assistantToolInputSchema.safeParse(input);
  if (!parsed.success) throw new ApiError(400, "Unsupported assistant tool or invalid arguments.");
  const tool = parsed.data;
  log.info("crm.assistant.tool", { name: tool.name });

  if (tool.name === "prepare_draft") {
    return {
      ok: true,
      summary: "Editable local proposal prepared. Nothing was saved, sent, published, or approved.",
      cards: [{ id: randomUUID(), kind: "draft", title: "Review your draft", body: "Session-local proposal. Check all details before using it.", draft: tool.arguments }],
      data: { persistence: "session_local_only", externalSideEffects: false },
    };
  }
  if (tool.name === "get_share_cards") {
    const cards = FIRST_PARTY_SHARE_CARDS.map(buildFirstPartyShareActionData);
    return {
      ok: true,
      summary: "Existing public contact cards. Sharing is not a subscription or a verified CRM ingestion receipt.",
      cards: cards.map((card) => ({ id: `share-${card.brand}`, kind: "navigation", title: card.name, body: card.liveUrl, destination: "share" })),
      data: { cards, automaticIntakeVerified: false },
    };
  }
  try {
    const summary = await loadPortfolioCrmSummaryForUid(uid, log);
    if (tool.name === "get_crm_summary") {
      return {
        ok: true,
        summary: `${summary.totals.people} registry people and ${summary.totals.emailContactPoints} email contact points. These are not verified newsletter audience counts.`,
        cards: [{
          id: "registry-summary", kind: "evidence", title: "CRM registry snapshot",
          body: `${summary.totals.people} people · ${summary.totals.emailContactPoints} email contact points · ${summary.permissions.suppressions} suppression records. Observed ${summary.freshness.observedAt}. No inbox, reply, open, or click analytics were checked.`,
          destination: "people",
        }],
        data: { totals: summary.totals, brands: summary.brands, sources: summary.sources, permissions: summary.permissions, freshness: summary.freshness, newsletterAudienceComputed: false },
      };
    }
    const preview = buildWarmReconnectCampaignDraft(summary);
    return {
      ok: true,
      summary: "Existing warm-reconnection copy preview. This is not live sending readiness, approval, or a scheduled campaign.",
      cards: [{
        id: "outreach-review", kind: "evidence", title: preview.copy.subject,
        body: preview.copy.plainText,
        destination: "outreach",
      }],
      data: { mode: "review_only", liveSendingReadinessChecked: false, subject: preview.copy.subject, body: preview.copy.plainText, observedAt: summary.freshness.observedAt },
    };
  } catch {
    // Do not turn an inaccessible/unavailable registry into fabricated zero counts, or log contact content.
    log.warn("crm.assistant.tool_unavailable", { name: tool.name });
    return { ok: false, summary: "The CRM source is unavailable for this account right now. No counts, audience eligibility, or sending readiness could be verified.", cards: [] };
  }
}
