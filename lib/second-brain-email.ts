import "server-only";

import { createHash } from "crypto";
import { ApiError } from "@/lib/api/handler";
import { getAdminAuth } from "@/lib/firebase-admin";
import { getAccessTokenForUser } from "@/lib/google/oauth";
import { searchEmails, sendEmail } from "@/lib/google/gmail";
import type { Logger } from "@/lib/logging";
import { configuredReviewEmails } from "@/lib/second-brain-auth";
import {
  createSecondBrainEmailAction,
  getSecondBrainCandidates,
  recordSecondBrainNotification,
} from "@/lib/second-brain";
import type {
  SecondBrainCandidate,
  SecondBrainDigestRequest,
  SecondBrainUrgentRequest,
} from "@/lib/second-brain-contract";

type ReviewerRecipient = { uid: string; email: string };

function parseCsv(value: string | undefined): string[] {
  return String(value || "").split(",").map((entry) => entry.trim()).filter(Boolean);
}

function publicOrigin(): string {
  const configured = String(process.env.MISSION_CONTROL_PUBLIC_ORIGIN || process.env.NEXT_PUBLIC_APP_URL || "").trim();
  if (!configured) throw new ApiError(503, "MISSION_CONTROL_PUBLIC_ORIGIN is not configured");
  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    throw new ApiError(503, "MISSION_CONTROL_PUBLIC_ORIGIN is invalid");
  }
  if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
    throw new ApiError(503, "Mission Control email links require HTTPS");
  }
  return url.origin;
}

export function escapeSecondBrainEmailHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function allowedReviewerUids(): Set<string> {
  return new Set(parseCsv(process.env.SECOND_BRAIN_REVIEW_ALLOWED_UIDS));
}

export async function resolveSecondBrainReviewRecipients(): Promise<ReviewerRecipient[]> {
  const emails = configuredReviewEmails();
  if (emails.length === 0) throw new ApiError(503, "SECOND_BRAIN_REVIEW_EMAILS is not configured");
  const allowed = allowedReviewerUids();
  if (allowed.size === 0) throw new ApiError(503, "SECOND_BRAIN_REVIEW_ALLOWED_UIDS is not configured");
  const recipients: ReviewerRecipient[] = [];
  for (const email of emails) {
    let user;
    try {
      user = await getAdminAuth().getUserByEmail(email);
    } catch {
      throw new ApiError(503, "A configured second-brain reviewer is not a Firebase user");
    }
    if (!allowed.has(user.uid)) {
      throw new ApiError(503, "A configured second-brain reviewer is not UID-allowlisted");
    }
    recipients.push({ uid: user.uid, email: email.toLowerCase() });
  }
  return recipients;
}

function candidateMetric(candidate: SecondBrainCandidate): string {
  const quality = `${candidate.qualityDeltaPoints >= 0 ? "+" : ""}${candidate.qualityDeltaPoints.toFixed(1)} quality pts`;
  const efficiency = `${candidate.efficiencyImprovement >= 0 ? "+" : ""}${(candidate.efficiencyImprovement * 100).toFixed(1)}% efficiency`;
  return `${quality} · ${efficiency} · ${candidate.caseCount} cases`;
}

export function renderSecondBrainDigestEmail(args: {
  digestDate: string;
  candidates: Array<SecondBrainCandidate & { actions: Record<"approve" | "reject" | "defer", string> }>;
  dashboardUrl: string;
}): { subject: string; html: string } {
  const candidateCards = args.candidates.length
    ? args.candidates.map((candidate) => {
      const buttons = (["approve", "reject", "defer"] as const).map((decision) => {
        const label = decision === "approve" ? "Approve" : decision === "reject" ? "Reject" : "Defer";
        const color = decision === "approve" ? "#5ee6a8" : decision === "reject" ? "#ff7b8b" : "#f5c15d";
        return `<a href="${escapeSecondBrainEmailHtml(candidate.actions[decision])}" style="display:inline-block;margin:10px 8px 0 0;padding:10px 14px;border:1px solid ${color};border-radius:6px;color:${color};text-decoration:none;font-weight:700">${label}</a>`;
      }).join("");
      return `<section style="margin:18px 0;padding:18px;border:1px solid #294047;border-radius:10px;background:#0a1518">
        <div style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#70d6e6">${escapeSecondBrainEmailHtml(candidate.skillName)}</div>
        <h2 style="margin:8px 0;color:#f3f7f8;font-size:19px">${escapeSecondBrainEmailHtml(candidate.purpose)}</h2>
        <p style="margin:8px 0;color:#b7c7cb">${escapeSecondBrainEmailHtml(candidateMetric(candidate))}</p>
        <p style="margin:8px 0;color:#8fa4a9">Evidence: ${candidate.evidenceCount} · Evaluator: ${escapeSecondBrainEmailHtml(candidate.evaluatorVersion)}</p>
        ${candidate.riskFlags.length ? `<p style="color:#f5c15d">Risks: ${escapeSecondBrainEmailHtml(candidate.riskFlags.join(", "))}</p>` : ""}
        ${buttons}
      </section>`;
    }).join("")
    : `<p style="padding:18px;border:1px solid #294047;border-radius:10px;color:#b7c7cb">No candidates need review today.</p>`;
  const html = `<!doctype html><html><body style="margin:0;background:#061013;color:#f3f7f8;font-family:Segoe UI,Arial,sans-serif">
    <main style="max-width:720px;margin:0 auto;padding:32px 22px">
      <div style="font-size:12px;letter-spacing:.18em;text-transform:uppercase;color:#70d6e6">RT Solutions · Portfolio Memory</div>
      <h1 style="font-size:30px;margin:10px 0 8px">Second Brain Review</h1>
      <p style="color:#8fa4a9">${escapeSecondBrainEmailHtml(args.digestDate)} · ${args.candidates.length} candidate${args.candidates.length === 1 ? "" : "s"} awaiting review</p>
      ${candidateCards}
      <p style="margin-top:28px"><a href="${escapeSecondBrainEmailHtml(args.dashboardUrl)}" style="color:#70d6e6">Open the full Memory Observatory in Mission Control →</a></p>
      <p style="margin-top:30px;color:#65787d;font-size:12px">Email buttons open an authenticated confirmation page. Link previews and scanners cannot record a decision.</p>
    </main></body></html>`;
  return { subject: `[Second Brain] ${args.candidates.length} review${args.candidates.length === 1 ? "" : "s"} · ${args.digestDate}`, html };
}

export function renderSecondBrainUrgentEmail(args: {
  event: SecondBrainUrgentRequest;
  dashboardUrl: string;
}): { subject: string; html: string } {
  const html = `<!doctype html><html><body style="margin:0;background:#160b0d;color:#fff4f4;font-family:Segoe UI,Arial,sans-serif">
    <main style="max-width:680px;margin:0 auto;padding:34px 22px">
      <div style="font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:#ff8896">Second Brain · ${escapeSecondBrainEmailHtml(args.event.severity)}</div>
      <h1 style="font-size:29px;margin:12px 0">${escapeSecondBrainEmailHtml(args.event.eventType.replaceAll("-", " "))}</h1>
      <p style="padding:18px;border-left:3px solid #ff6577;background:#241014;line-height:1.6">${escapeSecondBrainEmailHtml(args.event.summary)}</p>
      <p style="color:#cbaeb2">Detected ${escapeSecondBrainEmailHtml(args.event.detectedAt)} · Event ${escapeSecondBrainEmailHtml(args.event.eventId)}</p>
      <p><a href="${escapeSecondBrainEmailHtml(args.dashboardUrl)}" style="color:#ff9ca7">Open Memory Observatory →</a></p>
    </main></body></html>`;
  return { subject: `[Second Brain ${args.event.severity.toUpperCase()}] ${args.event.eventType}`, html };
}

function deterministicMessageId(idempotencyKey: string): string {
  return `<second-brain-${createHash("sha256").update(idempotencyKey).digest("hex").slice(0, 32)}@mission-control.local>`;
}

async function sendGmailIdempotently(args: {
  accessToken: string;
  recipient: string;
  subject: string;
  html: string;
  idempotencyKey: string;
  log?: Logger;
}): Promise<{ id: string; threadId: string; replayed: boolean }> {
  const messageId = deterministicMessageId(args.idempotencyKey);
  const query = `rfc822msgid:${messageId}`;
  const existing = await searchEmails(args.accessToken, query, 1, args.log).catch(() => []);
  if (existing[0]) return { id: existing[0].id, threadId: existing[0].threadId, replayed: true };

  let lastError: unknown = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const sent = await sendEmail(args.accessToken, {
        to: [args.recipient],
        subject: args.subject,
        body: args.html,
        isHtml: true,
        headers: {
          "Message-ID": messageId,
          "X-Second-Brain-Idempotency-Key": createHash("sha256").update(args.idempotencyKey).digest("hex"),
        },
      }, args.log);
      return { ...sent, replayed: false };
    } catch (error) {
      lastError = error;
      const delivered = await searchEmails(args.accessToken, query, 1, args.log).catch(() => []);
      if (delivered[0]) return { id: delivered[0].id, threadId: delivered[0].threadId, replayed: true };
      const status = error instanceof ApiError ? error.status : 0;
      if (![429, 502, 503].includes(status) || attempt === 3) break;
      await new Promise((resolve) => setTimeout(resolve, attempt * 250));
    }
  }
  throw lastError instanceof Error ? lastError : new ApiError(502, "Second-brain email delivery failed");
}

export async function dispatchSecondBrainDigest(args: {
  request: SecondBrainDigestRequest;
  correlationId: string;
  idempotencyKey: string;
  log?: Logger;
}): Promise<{ status: "dry-run" | "delivered" | "dead-letter"; recipientCount: number; candidateCount: number; messageIds: string[] }> {
  if (!args.request.dryRun) throw new ApiError(409, "Live second-brain email is hard-disabled pending verified shadow graduation");
  const recipients = await resolveSecondBrainReviewRecipients();
  const candidates = (await getSecondBrainCandidates({
    uid: args.request.uid,
    candidateIds: args.request.candidateIds,
    reviewableOnly: true,
  })).slice(0, 10);
  const digestDate = args.request.digestDate || new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(new Date());
  const dashboardUrl = `${publicOrigin()}/dashboard/aios-evolution/second-brain`;
  const notificationId = `digest-${createHash("sha256").update(args.idempotencyKey).digest("hex").slice(0, 32)}`;

  if (args.request.dryRun) {
    await recordSecondBrainNotification({
      uid: args.request.uid,
      notificationId,
      kind: "digest",
      status: "dry-run",
      recipientCount: recipients.length,
      correlationId: args.correlationId,
      detail: `${candidates.length} candidate(s)`,
    });
    return { status: "dry-run", recipientCount: recipients.length, candidateCount: candidates.length, messageIds: [] };
  }

  const accessToken = await getAccessTokenForUser(args.request.uid, args.log);
  const messageIds: string[] = [];
  try {
    for (const recipient of recipients) {
      const candidatesWithActions = [];
      for (const candidate of candidates) {
        const actions = {} as Record<"approve" | "reject" | "defer", string>;
        for (const decision of ["approve", "reject", "defer"] as const) {
          const token = await createSecondBrainEmailAction({
            uid: args.request.uid,
            candidate,
            decision,
            recipientUid: recipient.uid,
            recipientEmail: recipient.email,
            correlationId: args.correlationId,
          });
          actions[decision] = `${publicOrigin()}/dashboard/aios-evolution/second-brain/review?token=${encodeURIComponent(token)}`;
        }
        candidatesWithActions.push({ ...candidate, actions });
      }
      const email = renderSecondBrainDigestEmail({ digestDate, candidates: candidatesWithActions, dashboardUrl });
      const result = await sendGmailIdempotently({
        accessToken,
        recipient: recipient.email,
        subject: email.subject,
        html: email.html,
        idempotencyKey: `${args.idempotencyKey}:${recipient.uid}`,
        log: args.log,
      });
      messageIds.push(result.id);
    }
    await recordSecondBrainNotification({
      uid: args.request.uid,
      notificationId,
      kind: "digest",
      status: "delivered",
      recipientCount: recipients.length,
      correlationId: args.correlationId,
      detail: `${candidates.length} candidate(s)`,
      messageIds,
    });
    return { status: "delivered", recipientCount: recipients.length, candidateCount: candidates.length, messageIds };
  } catch (error) {
    await recordSecondBrainNotification({
      uid: args.request.uid,
      notificationId,
      kind: "digest",
      status: "dead-letter",
      recipientCount: recipients.length,
      correlationId: args.correlationId,
      detail: "delivery failed",
      messageIds,
    });
    throw error;
  }
}

export async function dispatchSecondBrainUrgent(args: {
  request: SecondBrainUrgentRequest;
  correlationId: string;
  idempotencyKey: string;
  log?: Logger;
}): Promise<{ status: "dry-run" | "delivered" | "dead-letter"; recipientCount: number; messageIds: string[] }> {
  if (!args.request.dryRun) throw new ApiError(409, "Live second-brain email is hard-disabled pending verified shadow graduation");
  const recipients = await resolveSecondBrainReviewRecipients();
  const dashboardUrl = `${publicOrigin()}/dashboard/aios-evolution/second-brain`;
  const email = renderSecondBrainUrgentEmail({ event: args.request, dashboardUrl });
  const notificationId = `urgent-${createHash("sha256").update(args.idempotencyKey).digest("hex").slice(0, 32)}`;
  if (args.request.dryRun) {
    await recordSecondBrainNotification({
      uid: args.request.uid,
      notificationId,
      kind: "urgent",
      status: "dry-run",
      recipientCount: recipients.length,
      correlationId: args.correlationId,
      detail: args.request.eventType,
    });
    return { status: "dry-run", recipientCount: recipients.length, messageIds: [] };
  }

  const accessToken = await getAccessTokenForUser(args.request.uid, args.log);
  const messageIds: string[] = [];
  try {
    for (const recipient of recipients) {
      const result = await sendGmailIdempotently({
        accessToken,
        recipient: recipient.email,
        subject: email.subject,
        html: email.html,
        idempotencyKey: `${args.idempotencyKey}:${recipient.uid}`,
        log: args.log,
      });
      messageIds.push(result.id);
    }
    await recordSecondBrainNotification({
      uid: args.request.uid,
      notificationId,
      kind: "urgent",
      status: "delivered",
      recipientCount: recipients.length,
      correlationId: args.correlationId,
      detail: args.request.eventType,
      messageIds,
    });
    return { status: "delivered", recipientCount: recipients.length, messageIds };
  } catch (error) {
    await recordSecondBrainNotification({
      uid: args.request.uid,
      notificationId,
      kind: "urgent",
      status: "dead-letter",
      recipientCount: recipients.length,
      correlationId: args.correlationId,
      detail: "delivery failed",
      messageIds,
    });
    throw error;
  }
}
