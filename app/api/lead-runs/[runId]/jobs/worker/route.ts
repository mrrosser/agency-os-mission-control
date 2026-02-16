import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import twilio from "twilio";
import { z } from "zod";
import { withApiHandler, ApiError } from "@/lib/api/handler";
import { parseJson } from "@/lib/api/validation";
import { getAdminDb } from "@/lib/firebase-admin";
import type { Logger } from "@/lib/logging";
import { resolveSecret } from "@/lib/api/secrets";
import { getAccessTokenForUser } from "@/lib/google/oauth";
import { createClientFolder } from "@/lib/google/drive";
import { createDraftEmail, sendEmail } from "@/lib/google/gmail";
import { withIdempotency } from "@/lib/api/idempotency";
import { buildLeadActionIdempotencyKey } from "@/lib/lead-runs/ids";
import { recordLeadActionReceipt } from "@/lib/lead-runs/receipts";
import {
  defaultLeadRunDiagnostics,
  leadRunJobRef,
  triggerLeadRunWorker,
  type LeadRunJobConfig,
  type LeadRunJobDiagnostics,
  type LeadRunJobDoc,
  type LeadRunJobStatus,
} from "@/lib/lead-runs/jobs";
import { recordLeadRunOutcome, releaseLeadRunConcurrencySlot } from "@/lib/lead-runs/quotas";
import { availabilityDraftHtml, runScheduleAttempt, type ScheduleAttemptResult } from "@/lib/lead-runs/worker/scheduling";
import { createHostedCallAudio } from "@/lib/voice/call-audio";
import { findDncMatch } from "@/lib/outreach/dnc";

const bodySchema = z.object({
  workerToken: z.string().min(1),
});

interface LeadDoc {
  companyName?: string;
  founderName?: string;
  email?: string;
  phone?: string;
  website?: string;
  industry?: string;
  source?: string;
  score?: number;
}

function mergeDiagnostics(
  base: LeadRunJobDiagnostics,
  delta: Partial<LeadRunJobDiagnostics>
): LeadRunJobDiagnostics {
  return {
    sourceFetched: base.sourceFetched + (delta.sourceFetched || 0),
    sourceScored: base.sourceScored + (delta.sourceScored || 0),
    sourceFilteredByScore: base.sourceFilteredByScore + (delta.sourceFilteredByScore || 0),
    sourceWithEmail: base.sourceWithEmail + (delta.sourceWithEmail || 0),
    sourceWithoutEmail: base.sourceWithoutEmail + (delta.sourceWithoutEmail || 0),
    processedLeads: base.processedLeads + (delta.processedLeads || 0),
    failedLeads: base.failedLeads + (delta.failedLeads || 0),
    calendarRetries: base.calendarRetries + (delta.calendarRetries || 0),
    noEmail: base.noEmail + (delta.noEmail || 0),
    noSlot: base.noSlot + (delta.noSlot || 0),
    meetingsScheduled: base.meetingsScheduled + (delta.meetingsScheduled || 0),
    meetingsDrafted: base.meetingsDrafted + (delta.meetingsDrafted || 0),
    emailsSent: base.emailsSent + (delta.emailsSent || 0),
    emailsDrafted: base.emailsDrafted + (delta.emailsDrafted || 0),
    smsSent: base.smsSent + (delta.smsSent || 0),
    callsPlaced: base.callsPlaced + (delta.callsPlaced || 0),
    avatarsQueued: base.avatarsQueued + (delta.avatarsQueued || 0),
    channelFailures: base.channelFailures + (delta.channelFailures || 0),
  };
}

function readPositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value || "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

const CALENDAR_RETRY_POLICY = {
  maxAttempts: readPositiveInt(process.env.LEAD_RUNS_CALENDAR_MAX_ATTEMPTS, 3),
  baseBackoffMs: readPositiveInt(process.env.LEAD_RUNS_CALENDAR_BACKOFF_MS, 1500),
} as const;

const CHANNEL_RETRY_POLICY = {
  sms: { maxAttempts: 2, initialDelayMs: 300 },
  call: { maxAttempts: 2, initialDelayMs: 500 },
  avatar: { maxAttempts: 2, initialDelayMs: 700 },
} as const;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runChannelWithRetry<T>(
  channel: keyof typeof CHANNEL_RETRY_POLICY,
  operation: (attempt: number) => Promise<T>,
  log: Logger,
  runId: string,
  leadDocId: string
): Promise<T> {
  const policy = CHANNEL_RETRY_POLICY[channel];
  let attempt = 0;
  let lastError: Error | null = null;

  while (attempt < policy.maxAttempts) {
    attempt += 1;
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      log.warn("lead_runs.channel.retry", {
        runId,
        leadDocId,
        channel,
        attempt,
        maxAttempts: policy.maxAttempts,
        error: lastError.message,
      });
      if (attempt >= policy.maxAttempts) break;
      await sleep(policy.initialDelayMs * attempt);
    }
  }

  throw lastError || new Error(`Channel ${channel} failed`);
}

async function processLead(
  args: {
    runId: string;
    leadDocId: string;
    lead: LeadDoc;
    uid: string;
    orgId: string;
    correlationId: string;
    config: LeadRunJobConfig;
    origin: string;
  },
  log: Logger
): Promise<Partial<LeadRunJobDiagnostics>> {
  const diag: Partial<LeadRunJobDiagnostics> = { processedLeads: 1 };
  const leadName = args.lead.founderName || "there";
  const leadEmail = args.lead.email?.trim();
  const leadPhone = args.lead.phone?.trim();
  const leadWebsite = args.lead.website?.trim();
  const emailDomain =
    leadEmail && leadEmail.includes("@") ? leadEmail.split("@")[1]?.trim() || null : null;

  // Enforce org-level Do-Not-Contact before we do *any* side-effectful work (Drive/Calendar/Gmail/Twilio/HeyGen).
  let dnc = await findDncMatch({
    orgId: args.orgId,
    email: leadEmail || null,
    phone: leadPhone || null,
    domain: emailDomain,
  });
  if (!dnc && leadWebsite) {
    dnc = await findDncMatch({
      orgId: args.orgId,
      domain: leadWebsite,
    });
  }

  if (dnc) {
    const dncMeta = { entryId: dnc.entryId, type: dnc.type, value: dnc.value };
    log.info("lead_runs.dnc.blocked", {
      runId: args.runId,
      leadDocId: args.leadDocId,
      orgId: args.orgId,
      dnc: dncMeta,
    });

    // Record the “why” on the key outbound action receipts so the UI doesn't show "pending".
    const receiptBase = {
      runId: args.runId,
      leadDocId: args.leadDocId,
      uid: args.uid,
      correlationId: args.correlationId,
      status: "skipped" as const,
      dryRun: args.config.dryRun,
      replayed: false,
      data: { reason: "dnc" as const, dnc: dncMeta },
    };

    await recordLeadActionReceipt(
      {
        ...receiptBase,
        actionId: "calendar.booking",
        idempotencyKey: buildLeadActionIdempotencyKey({
          runId: args.runId,
          leadDocId: args.leadDocId,
          action: "calendar.schedule",
        }),
      },
      log
    );

    await recordLeadActionReceipt(
      {
        ...receiptBase,
        actionId: args.config.draftFirst ? "gmail.outreach_draft" : "gmail.outreach",
        idempotencyKey: buildLeadActionIdempotencyKey({
          runId: args.runId,
          leadDocId: args.leadDocId,
          action: args.config.draftFirst ? "gmail.outreach-draft" : "gmail.send",
        }),
      },
      log
    );

    await recordLeadActionReceipt(
      {
        ...receiptBase,
        actionId: "drive.folder",
        idempotencyKey: buildLeadActionIdempotencyKey({
          runId: args.runId,
          leadDocId: args.leadDocId,
          action: "drive.create-folder",
        }),
      },
      log
    );

    if (args.config.useSMS) {
      await recordLeadActionReceipt(
        {
          ...receiptBase,
          actionId: "twilio.sms",
          idempotencyKey: buildLeadActionIdempotencyKey({
            runId: args.runId,
            leadDocId: args.leadDocId,
            action: "twilio.send-sms",
          }),
        },
        log
      );
    }

    if (args.config.useOutboundCall) {
      await recordLeadActionReceipt(
        {
          ...receiptBase,
          actionId: "twilio.call",
          idempotencyKey: buildLeadActionIdempotencyKey({
            runId: args.runId,
            leadDocId: args.leadDocId,
            action: "twilio.make-call",
          }),
        },
        log
      );
    }

    if (args.config.useAvatar) {
      await recordLeadActionReceipt(
        {
          ...receiptBase,
          actionId: "heygen.avatar",
          idempotencyKey: buildLeadActionIdempotencyKey({
            runId: args.runId,
            leadDocId: args.leadDocId,
            action: "heygen.create-avatar",
          }),
        },
        log
      );
    }

    return diag;
  }

  const accessToken = await getAccessTokenForUser(args.uid, log);

  const identitySnap = await getAdminDb().collection("identities").doc(args.uid).get();
  const identity = identitySnap.data() || {};
  const founderName = String(identity.founderName || "Founder");
  const businessName = String(identity.businessName || "Mission Control");
  const primaryService = String(identity.primaryService || "growth support");
  const coreValue = String(identity.coreValue || "high-signal outreach");
  const keyBenefit = String(identity.keyBenefit || "faster qualified conversations");
  const voiceProfiles = (identity.voiceProfiles || {}) as Record<
    string,
    { voiceId?: string; modelId?: string }
  >;

  const driveKey = buildLeadActionIdempotencyKey({
    runId: args.runId,
    leadDocId: args.leadDocId,
    action: "drive.create-folder",
  });

  let folderLink: string | undefined;
  if (args.config.dryRun) {
    folderLink = `https://drive.google.com/drive/folders/dryrun_${args.runId.slice(0, 8)}`;
    await recordLeadActionReceipt(
      {
        runId: args.runId,
        leadDocId: args.leadDocId,
        actionId: "drive.folder",
        uid: args.uid,
        correlationId: args.correlationId,
        status: "simulated",
        dryRun: true,
        replayed: false,
        idempotencyKey: driveKey,
        data: { webViewLink: folderLink },
      },
      log
    );
  } else {
    const driveResult = await withIdempotency(
      { uid: args.uid, route: "drive.create-folder", key: driveKey, log },
      () => createClientFolder(accessToken, args.lead.companyName || "Client", undefined, log)
    );
    folderLink = driveResult.data?.mainFolder?.webViewLink;
    await recordLeadActionReceipt(
      {
        runId: args.runId,
        leadDocId: args.leadDocId,
        actionId: "drive.folder",
        uid: args.uid,
        correlationId: args.correlationId,
        status: "complete",
        dryRun: false,
        replayed: driveResult.replayed,
        idempotencyKey: driveKey,
        data: {
          folderId: driveResult.data?.mainFolder?.id,
          webViewLink: folderLink,
        },
      },
      log
    );
  }

  let meetingTime: string | undefined;
  let meetLink: string | undefined;
  let scheduleResult: ScheduleAttemptResult = { kind: "no_slot" };
  for (let attempt = 1; attempt <= CALENDAR_RETRY_POLICY.maxAttempts; attempt += 1) {
    scheduleResult = await runScheduleAttempt(
      {
        accessToken,
        config: args.config,
        runId: args.runId,
        leadDocId: args.leadDocId,
        lead: args.lead,
        leadEmail,
        correlationId: args.correlationId,
        uid: args.uid,
        retryAttempt: attempt,
      },
      log
    );
    if (scheduleResult.kind === "scheduled") break;
    if (attempt < CALENDAR_RETRY_POLICY.maxAttempts) {
      diag.calendarRetries = (diag.calendarRetries || 0) + 1;
      log.warn("lead_runs.calendar.retrying_after_no_slot", {
        runId: args.runId,
        leadDocId: args.leadDocId,
        attempt,
        maxAttempts: CALENDAR_RETRY_POLICY.maxAttempts,
      });
      await sleep(CALENDAR_RETRY_POLICY.baseBackoffMs * attempt);
    }
  }

  if (scheduleResult.kind === "scheduled") {
    diag.meetingsScheduled = 1;
    meetingTime = scheduleResult.scheduledStart;
    meetLink = scheduleResult.meetLink;
  } else {
    diag.noSlot = 1;
    log.warn("lead_runs.calendar.no_slot", {
      runId: args.runId,
      leadDocId: args.leadDocId,
      maxAttempts: CALENDAR_RETRY_POLICY.maxAttempts,
      checkedCandidates: scheduleResult.checkedCandidates ?? 0,
      busyCount: scheduleResult.busyCount ?? 0,
      windowsTried: scheduleResult.windowsTried ?? 0,
    });
    const calendarKey = buildLeadActionIdempotencyKey({
      runId: args.runId,
      leadDocId: args.leadDocId,
      action: "calendar.schedule",
    });
    await recordLeadActionReceipt(
      {
        runId: args.runId,
        leadDocId: args.leadDocId,
        actionId: "calendar.booking",
        uid: args.uid,
        correlationId: args.correlationId,
        status: "skipped",
        dryRun: false,
        replayed: false,
        idempotencyKey: calendarKey,
        data: {
          reason: "no_slot",
          maxAttempts: CALENDAR_RETRY_POLICY.maxAttempts,
          checked: scheduleResult.checkedCandidates,
          busyCount: scheduleResult.busyCount,
          windowsTried: scheduleResult.windowsTried,
        },
      },
      log
    );
    if (leadEmail) {
      const draftKey = buildLeadActionIdempotencyKey({
        runId: args.runId,
        leadDocId: args.leadDocId,
        action: "gmail.availability-draft",
      });

      if (args.config.dryRun) {
        await recordLeadActionReceipt(
          {
            runId: args.runId,
            leadDocId: args.leadDocId,
            actionId: "gmail.availability_draft",
            uid: args.uid,
            correlationId: args.correlationId,
            status: "simulated",
            dryRun: true,
            replayed: false,
            idempotencyKey: draftKey,
            data: { subject: `Quick scheduling question - ${args.lead.companyName || "your team"}` },
          },
          log
        );
      } else {
        const availabilityDraft = await withIdempotency(
          { uid: args.uid, route: "gmail.draft", key: draftKey, log },
          () =>
            createDraftEmail(
              accessToken,
              {
                to: [leadEmail],
                subject: `Quick scheduling question - ${args.lead.companyName || "your team"}`,
                body: availabilityDraftHtml(leadName, founderName, businessName),
                isHtml: true,
              },
              log
            )
        );

        await recordLeadActionReceipt(
          {
            runId: args.runId,
            leadDocId: args.leadDocId,
            actionId: "gmail.availability_draft",
            uid: args.uid,
            correlationId: args.correlationId,
            status: "complete",
            dryRun: false,
            replayed: availabilityDraft.replayed,
            idempotencyKey: draftKey,
            data: {
              draftId: availabilityDraft.data.draftId,
              messageId: availabilityDraft.data.messageId,
              threadId: availabilityDraft.data.threadId,
            },
          },
          log
        );
      }

      diag.meetingsDrafted = 1;
      diag.emailsDrafted = 1;
    }
  }

  const outreachSubject = `Quick Question - ${args.lead.companyName || "your team"}`;
  const outreachBody = `
    <h2>Hi ${leadName},</h2>
    <p>I noticed ${args.lead.companyName || "your company"} and thought we could help with ${primaryService}.</p>
    <p>Our core value: ${coreValue}</p>
    <p><strong>Key benefit:</strong> ${keyBenefit}</p>
    ${meetingTime ? `<p>I've scheduled a brief 30-minute discovery call for ${new Date(meetingTime).toLocaleString()}.</p>` : ""}
    ${meetLink ? `<p><strong>Join here:</strong> <a href="${meetLink}">${meetLink}</a></p>` : ""}
    ${folderLink ? `<p>I've also created a shared folder for our collaboration: <a href="${folderLink}">View Folder</a></p>` : ""}
    <br/>
    <p>Best regards,</p>
    <p>${founderName}<br/>${businessName}</p>
  `;

  if (!leadEmail) {
    diag.noEmail = 1;
    await recordLeadActionReceipt(
      {
        runId: args.runId,
        leadDocId: args.leadDocId,
        actionId: args.config.draftFirst ? "gmail.outreach_draft" : "gmail.outreach",
        uid: args.uid,
        correlationId: args.correlationId,
        status: "skipped",
        dryRun: args.config.dryRun,
        replayed: false,
        idempotencyKey: buildLeadActionIdempotencyKey({
          runId: args.runId,
          leadDocId: args.leadDocId,
          action: args.config.draftFirst ? "gmail.outreach-draft" : "gmail.send",
        }),
        data: { reason: "missing_email" },
      },
      log
    );
  } else if (args.config.draftFirst) {
    const draftKey = buildLeadActionIdempotencyKey({
      runId: args.runId,
      leadDocId: args.leadDocId,
      action: "gmail.outreach-draft",
    });

    if (args.config.dryRun) {
      await recordLeadActionReceipt(
        {
          runId: args.runId,
          leadDocId: args.leadDocId,
          actionId: "gmail.outreach_draft",
          uid: args.uid,
          correlationId: args.correlationId,
          status: "simulated",
          dryRun: true,
          replayed: false,
          idempotencyKey: draftKey,
          data: { subject: outreachSubject },
        },
        log
      );
    } else {
      const draftResponse = await withIdempotency(
        { uid: args.uid, route: "gmail.draft", key: draftKey, log },
        () =>
          createDraftEmail(
            accessToken,
            {
              to: [leadEmail],
              subject: outreachSubject,
              body: outreachBody,
              isHtml: true,
            },
            log
          )
      );

      await recordLeadActionReceipt(
        {
          runId: args.runId,
          leadDocId: args.leadDocId,
          actionId: "gmail.outreach_draft",
          uid: args.uid,
          correlationId: args.correlationId,
          status: "complete",
          dryRun: false,
          replayed: draftResponse.replayed,
          idempotencyKey: draftKey,
          data: {
            draftId: draftResponse.data.draftId,
            messageId: draftResponse.data.messageId,
            threadId: draftResponse.data.threadId,
          },
        },
        log
      );
    }

    diag.emailsDrafted = (diag.emailsDrafted || 0) + 1;
  } else {
    const sendKey = buildLeadActionIdempotencyKey({
      runId: args.runId,
      leadDocId: args.leadDocId,
      action: "gmail.send",
    });

    if (args.config.dryRun) {
      await recordLeadActionReceipt(
        {
          runId: args.runId,
          leadDocId: args.leadDocId,
          actionId: "gmail.outreach",
          uid: args.uid,
          correlationId: args.correlationId,
          status: "simulated",
          dryRun: true,
          replayed: false,
          idempotencyKey: sendKey,
          data: { subject: outreachSubject },
        },
        log
      );
    } else {
      const sent = await withIdempotency(
        { uid: args.uid, route: "gmail.send", key: sendKey, log },
        () =>
          sendEmail(
            accessToken,
            {
              to: [leadEmail],
              subject: outreachSubject,
              body: outreachBody,
              isHtml: true,
            },
            log
          )
      );

      await recordLeadActionReceipt(
        {
          runId: args.runId,
          leadDocId: args.leadDocId,
          actionId: "gmail.outreach",
          uid: args.uid,
          correlationId: args.correlationId,
          status: "complete",
          dryRun: false,
          replayed: sent.replayed,
          idempotencyKey: sendKey,
          data: {
            messageId: sent.data.id,
            threadId: sent.data.threadId,
          },
        },
        log
      );
    }

    diag.emailsSent = 1;
  }

  const twilioSid =
    args.config.useSMS || args.config.useOutboundCall
      ? await resolveSecret(args.uid, "twilioSid", "TWILIO_ACCOUNT_SID")
      : undefined;
  const twilioToken =
    args.config.useSMS || args.config.useOutboundCall
      ? await resolveSecret(args.uid, "twilioToken", "TWILIO_AUTH_TOKEN")
      : undefined;
  const twilioFrom =
    args.config.useSMS || args.config.useOutboundCall
      ? await resolveSecret(args.uid, "twilioPhoneNumber", "TWILIO_PHONE_NUMBER")
      : undefined;
  const elevenLabsKey = args.config.useOutboundCall
    ? await resolveSecret(args.uid, "elevenLabsKey", "ELEVENLABS_API_KEY")
    : undefined;
  const heyGenKey = args.config.useAvatar
    ? await resolveSecret(args.uid, "heyGenKey", "HEYGEN_API_KEY")
    : undefined;

  if (args.config.useSMS) {
    const smsKey = buildLeadActionIdempotencyKey({
      runId: args.runId,
      leadDocId: args.leadDocId,
      action: "twilio.send-sms",
    });
    if (!leadPhone) {
      await recordLeadActionReceipt(
        {
          runId: args.runId,
          leadDocId: args.leadDocId,
          actionId: "twilio.sms",
          uid: args.uid,
          correlationId: args.correlationId,
          status: "skipped",
          dryRun: args.config.dryRun,
          data: { reason: "missing_phone" },
        },
        log
      );
    } else if (!twilioSid || !twilioToken || !twilioFrom) {
      await recordLeadActionReceipt(
        {
          runId: args.runId,
          leadDocId: args.leadDocId,
          actionId: "twilio.sms",
          uid: args.uid,
          correlationId: args.correlationId,
          status: "skipped",
          dryRun: args.config.dryRun,
          data: { reason: "missing_twilio_config" },
        },
        log
      );
    } else if (args.config.dryRun) {
      await recordLeadActionReceipt(
        {
          runId: args.runId,
          leadDocId: args.leadDocId,
          actionId: "twilio.sms",
          uid: args.uid,
          correlationId: args.correlationId,
          status: "simulated",
          dryRun: true,
          replayed: false,
          idempotencyKey: smsKey,
          data: { to: leadPhone, from: twilioFrom },
        },
        log
      );
      diag.smsSent = (diag.smsSent || 0) + 1;
    } else {
      try {
        const smsResult = await runChannelWithRetry(
          "sms",
          () =>
            withIdempotency(
              { uid: args.uid, route: "twilio.send-sms", key: smsKey, log },
              async () => {
                const client = twilio(twilioSid, twilioToken);
                const message = await client.messages.create({
                  to: leadPhone,
                  from: twilioFrom,
                  body: `Hi ${leadName}, just sent you an email about ${args.lead.companyName || "your business"}.`,
                });
                return {
                  messageSid: message.sid,
                  status: message.status,
                  to: message.to,
                  from: message.from,
                };
              }
            ),
          log,
          args.runId,
          args.leadDocId
        );

        await recordLeadActionReceipt(
          {
            runId: args.runId,
            leadDocId: args.leadDocId,
            actionId: "twilio.sms",
            uid: args.uid,
            correlationId: args.correlationId,
            status: "complete",
            dryRun: false,
            replayed: smsResult.replayed,
            idempotencyKey: smsKey,
            data: smsResult.data,
          },
          log
        );
        diag.smsSent = (diag.smsSent || 0) + 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await recordLeadActionReceipt(
          {
            runId: args.runId,
            leadDocId: args.leadDocId,
            actionId: "twilio.sms",
            uid: args.uid,
            correlationId: args.correlationId,
            status: "error",
            dryRun: false,
            idempotencyKey: smsKey,
            data: { error: message },
          },
          log
        );
        diag.channelFailures = (diag.channelFailures || 0) + 1;
      }
    }
  }

  if (args.config.useOutboundCall) {
    const callKey = buildLeadActionIdempotencyKey({
      runId: args.runId,
      leadDocId: args.leadDocId,
      action: "twilio.make-call",
    });
    if (!leadPhone) {
      await recordLeadActionReceipt(
        {
          runId: args.runId,
          leadDocId: args.leadDocId,
          actionId: "twilio.call",
          uid: args.uid,
          correlationId: args.correlationId,
          status: "skipped",
          dryRun: args.config.dryRun,
          data: { reason: "missing_phone" },
        },
        log
      );
    } else if (!twilioSid || !twilioToken || !twilioFrom) {
      await recordLeadActionReceipt(
        {
          runId: args.runId,
          leadDocId: args.leadDocId,
          actionId: "twilio.call",
          uid: args.uid,
          correlationId: args.correlationId,
          status: "skipped",
          dryRun: args.config.dryRun,
          data: { reason: "missing_twilio_config" },
        },
        log
      );
    } else if (args.config.dryRun) {
      await recordLeadActionReceipt(
        {
          runId: args.runId,
          leadDocId: args.leadDocId,
          actionId: "twilio.call",
          uid: args.uid,
          correlationId: args.correlationId,
          status: "simulated",
          dryRun: true,
          replayed: false,
          idempotencyKey: callKey,
          data: { to: leadPhone, from: twilioFrom },
        },
        log
      );
      diag.callsPlaced = (diag.callsPlaced || 0) + 1;
    } else {
      try {
        const elevenLabsApiKey = elevenLabsKey;
        if (!elevenLabsApiKey) {
          throw new Error("ElevenLabs key missing");
        }
        const callScript = `Hi ${leadName}. This is ${founderName} from ${businessName}. We help with ${primaryService}. Please check your email and reply with a good time to connect.`;
        const callResult = await runChannelWithRetry(
          "call",
          () =>
            withIdempotency(
              { uid: args.uid, route: "twilio.make-call", key: callKey, log },
              async () => {
                const businessKey = String(args.config.businessKey || "")
                  .trim()
                  .toLowerCase();
                const profile =
                  (businessKey && voiceProfiles[businessKey]) || voiceProfiles.default || {};
                const profileVoiceId =
                  typeof profile.voiceId === "string" ? profile.voiceId : undefined;
                const profileModelId =
                  typeof profile.modelId === "string" ? profile.modelId : undefined;

                const hostedAudio = await createHostedCallAudio(
                  {
                    uid: args.uid,
                    elevenLabsKey: elevenLabsApiKey,
                    origin: args.origin,
                    text: callScript,
                    businessKey: args.config.businessKey,
                    voiceId: profileVoiceId,
                    modelId: profileModelId,
                    runId: args.runId,
                    leadDocId: args.leadDocId,
                    correlationId: args.correlationId,
                  },
                  log
                );
                const client = twilio(twilioSid, twilioToken);
                const call = await client.calls.create({
                  to: leadPhone,
                  from: twilioFrom,
                  twiml: `<Response><Play>${hostedAudio.audioUrl}</Play></Response>`,
                });
                return {
                  callSid: call.sid,
                  status: call.status,
                  to: leadPhone,
                  audioUrl: hostedAudio.audioUrl,
                  clipId: hostedAudio.clipId,
                  voiceId: hostedAudio.voiceId,
                };
              }
            ),
          log,
          args.runId,
          args.leadDocId
        );

        await recordLeadActionReceipt(
          {
            runId: args.runId,
            leadDocId: args.leadDocId,
            actionId: "twilio.call",
            uid: args.uid,
            correlationId: args.correlationId,
            status: "complete",
            dryRun: false,
            replayed: callResult.replayed,
            idempotencyKey: callKey,
            data: callResult.data,
          },
          log
        );
        diag.callsPlaced = (diag.callsPlaced || 0) + 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await recordLeadActionReceipt(
          {
            runId: args.runId,
            leadDocId: args.leadDocId,
            actionId: "twilio.call",
            uid: args.uid,
            correlationId: args.correlationId,
            status: "error",
            dryRun: false,
            idempotencyKey: callKey,
            data: { error: message },
          },
          log
        );
        diag.channelFailures = (diag.channelFailures || 0) + 1;
      }
    }
  }

  if (args.config.useAvatar) {
    const avatarKey = buildLeadActionIdempotencyKey({
      runId: args.runId,
      leadDocId: args.leadDocId,
      action: "heygen.create-avatar",
    });
    if (!heyGenKey) {
      await recordLeadActionReceipt(
        {
          runId: args.runId,
          leadDocId: args.leadDocId,
          actionId: "heygen.avatar",
          uid: args.uid,
          correlationId: args.correlationId,
          status: "skipped",
          dryRun: args.config.dryRun,
          data: { reason: "missing_heygen_key" },
        },
        log
      );
    } else if (args.config.dryRun) {
      await recordLeadActionReceipt(
        {
          runId: args.runId,
          leadDocId: args.leadDocId,
          actionId: "heygen.avatar",
          uid: args.uid,
          correlationId: args.correlationId,
          status: "simulated",
          dryRun: true,
          replayed: false,
          idempotencyKey: avatarKey,
          data: { status: "processing" },
        },
        log
      );
      diag.avatarsQueued = (diag.avatarsQueued || 0) + 1;
    } else {
      try {
        const avatarResult = await runChannelWithRetry(
          "avatar",
          () =>
            withIdempotency(
              { uid: args.uid, route: "heygen.create-avatar", key: avatarKey, log },
              async () => {
                const response = await fetch("https://api.heygen.com/v1/video.generate", {
                  method: "POST",
                  headers: {
                    Accept: "application/json",
                    "Content-Type": "application/json",
                    "X-Api-Key": heyGenKey,
                  },
                  body: JSON.stringify({
                    video_inputs: [
                      {
                        character: {
                          type: "avatar",
                          avatar_id: "default_avatar",
                        },
                        voice: {
                          type: "text",
                          input_text: `Hi ${leadName}, this is ${founderName} from ${businessName}. We can help ${args.lead.companyName || "your team"} with ${primaryService}.`,
                          voice_id: "en-US-Neural2-J",
                        },
                      },
                    ],
                    dimension: {
                      width: 1920,
                      height: 1080,
                    },
                  }),
                });

                if (!response.ok) {
                  throw new Error(`HeyGen API error (${response.status}): ${await response.text()}`);
                }
                const payload = await response.json();
                return {
                  videoId: payload.data?.video_id,
                  status: payload.data?.status || "processing",
                };
              }
            ),
          log,
          args.runId,
          args.leadDocId
        );

        await recordLeadActionReceipt(
          {
            runId: args.runId,
            leadDocId: args.leadDocId,
            actionId: "heygen.avatar",
            uid: args.uid,
            correlationId: args.correlationId,
            status: "complete",
            dryRun: false,
            replayed: avatarResult.replayed,
            idempotencyKey: avatarKey,
            data: avatarResult.data,
          },
          log
        );
        diag.avatarsQueued = (diag.avatarsQueued || 0) + 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await recordLeadActionReceipt(
          {
            runId: args.runId,
            leadDocId: args.leadDocId,
            actionId: "heygen.avatar",
            uid: args.uid,
            correlationId: args.correlationId,
            status: "error",
            dryRun: false,
            idempotencyKey: avatarKey,
            data: { error: message },
          },
          log
        );
        diag.channelFailures = (diag.channelFailures || 0) + 1;
      }
    }
  }

  return diag;
}

export const POST = withApiHandler(
  async ({ request, params, log, correlationId }) => {
    const body = await parseJson(request, bodySchema);
    const runId = params?.runId;
    if (!runId) throw new ApiError(400, "Missing runId");

    const runRef = getAdminDb().collection("lead_runs").doc(runId);
    const jobRef = leadRunJobRef(runId);

    const claim = await getAdminDb().runTransaction(async (tx) => {
      const runSnap = await tx.get(runRef);
      if (!runSnap.exists) throw new ApiError(404, "Lead run not found");

      const snap = await tx.get(jobRef);
      if (!snap.exists) throw new ApiError(404, "Lead run job not found");

      const job = snap.data() as LeadRunJobDoc;
      if (job.workerToken !== body.workerToken) {
        throw new ApiError(403, "Invalid worker token");
      }

      if (job.status === "paused" || job.status === "completed" || job.status === "failed") {
        return { shouldProcess: false, job, justFailed: false, failureReason: null };
      }

      if (!Array.isArray(job.leadDocIds) || job.leadDocIds.length === 0) {
        tx.set(
          jobRef,
          {
            status: "failed",
            lastError: "No leads attached to job",
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
        return {
          shouldProcess: false,
          job: { ...job, status: "failed" as LeadRunJobStatus },
          justFailed: true,
          failureReason: "No leads attached to job",
        };
      }

      if (job.nextIndex >= job.totalLeads) {
        tx.set(
          jobRef,
          {
            status: "completed",
            leaseUntil: FieldValue.delete(),
            updatedAt: FieldValue.serverTimestamp(),
            correlationId,
          },
          { merge: true }
        );
        return {
          shouldProcess: false,
          job: { ...job, status: "completed" as LeadRunJobStatus },
          justFailed: false,
          failureReason: null,
        };
      }

      const leaseUntilMs = job.leaseUntil ? Date.parse(job.leaseUntil) : NaN;
      if (job.status === "running" && Number.isFinite(leaseUntilMs) && leaseUntilMs > Date.now()) {
        return { shouldProcess: false, job, justFailed: false, failureReason: null };
      }

      tx.set(
        jobRef,
        {
          status: "running",
          leaseUntil: new Date(Date.now() + 90_000).toISOString(),
          correlationId,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      return { shouldProcess: true, job, justFailed: false, failureReason: null };
    });

    if (!claim.shouldProcess) {
      if (claim.justFailed) {
        await recordLeadRunOutcome({
          orgId: claim.job.orgId || claim.job.userId,
          runId,
          uid: claim.job.userId,
          failed: true,
          failureReason: claim.failureReason,
          correlationId,
          log,
        });
      }
      if (claim.job.status === "failed" || claim.job.status === "completed") {
        await releaseLeadRunConcurrencySlot({
          orgId: claim.job.orgId || claim.job.userId,
          runId,
          correlationId,
          log,
        });
      }
      return NextResponse.json({
        ok: true,
        status: claim.job.status,
        queued: claim.job.status === "queued",
      });
    }

    const job = claim.job;
    const leadDocId = job.leadDocIds[job.nextIndex];
    if (!leadDocId) {
      await jobRef.set(
        {
          status: "failed",
          lastError: "Invalid lead index",
          leaseUntil: FieldValue.delete(),
          updatedAt: FieldValue.serverTimestamp(),
          correlationId,
        },
        { merge: true }
      );
      await recordLeadRunOutcome({
        orgId: job.orgId || job.userId,
        runId,
        uid: job.userId,
        failed: true,
        failureReason: "Invalid lead index",
        correlationId,
        log,
      });
      await releaseLeadRunConcurrencySlot({
        orgId: job.orgId || job.userId,
        runId,
        correlationId,
        log,
      });
      throw new ApiError(500, "Invalid lead index");
    }

    const leadRef = runRef.collection("leads").doc(leadDocId);
    const leadSnap = await leadRef.get();
    if (!leadSnap.exists) {
      await jobRef.set(
        {
          status: "failed",
          lastError: `Lead document missing: ${leadDocId}`,
          leaseUntil: FieldValue.delete(),
          updatedAt: FieldValue.serverTimestamp(),
          correlationId,
        },
        { merge: true }
      );
      await recordLeadRunOutcome({
        orgId: job.orgId || job.userId,
        runId,
        uid: job.userId,
        failed: true,
        failureReason: `Lead document missing: ${leadDocId}`,
        correlationId,
        log,
      });
      await releaseLeadRunConcurrencySlot({
        orgId: job.orgId || job.userId,
        runId,
        correlationId,
        log,
      });
      throw new ApiError(404, `Lead not found: ${leadDocId}`);
    }

    await leadRef.set(
      {
        jobStatus: "running",
        jobUpdatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    let delta: Partial<LeadRunJobDiagnostics> = {};
    let processError: Error | null = null;
    try {
      delta = await processLead(
        {
          runId,
          leadDocId,
          lead: leadSnap.data() as LeadDoc,
          uid: job.userId,
          orgId: job.orgId || job.userId,
          correlationId,
          config: job.config,
          origin: request.nextUrl?.origin || new URL(request.url).origin,
        },
        log
      );
      await leadRef.set(
        {
          jobStatus: "complete",
          jobUpdatedAt: FieldValue.serverTimestamp(),
          jobLastError: FieldValue.delete(),
        },
        { merge: true }
      );
    } catch (error) {
      processError = error instanceof Error ? error : new Error(String(error));
      await leadRef.set(
        {
          jobStatus: "error",
          jobUpdatedAt: FieldValue.serverTimestamp(),
          jobLastError: processError.message,
        },
        { merge: true }
      );
    }

    const finalize = await getAdminDb().runTransaction(async (tx) => {
      const snap = await tx.get(jobRef);
      if (!snap.exists) throw new ApiError(404, "Lead run job not found");
      const current = snap.data() as LeadRunJobDoc;

      const attemptsByLead = { ...(current.attemptsByLead || {}) };
      const currentAttempts = attemptsByLead[leadDocId] || 0;
      let nextIndex = current.nextIndex;
      let failedIncrement = 0;
      const finalError = processError?.message || null;

      if (processError) {
        const attempts = currentAttempts + 1;
        attemptsByLead[leadDocId] = attempts;
        // Retry each lead up to 3 attempts, then continue to the next lead.
        if (attempts >= 3) {
          nextIndex += 1;
          failedIncrement = 1;
        }
      } else {
        nextIndex += 1;
        delete attemptsByLead[leadDocId];
      }

      const diagnostics = mergeDiagnostics(current.diagnostics || defaultLeadRunDiagnostics(), {
        ...delta,
        failedLeads: (delta.failedLeads || 0) + failedIncrement,
      });

      const reachedEnd = nextIndex >= current.totalLeads;
      const status: LeadRunJobStatus = reachedEnd
        ? "completed"
        : current.status === "paused"
          ? "paused"
          : "queued";

      tx.set(
        jobRef,
        {
          status,
          nextIndex,
          attemptsByLead,
          diagnostics,
          lastError: finalError || FieldValue.delete(),
          leaseUntil: FieldValue.delete(),
          updatedAt: FieldValue.serverTimestamp(),
          correlationId,
        },
        { merge: true }
      );

      return {
        status,
        nextIndex,
        totalLeads: current.totalLeads,
        workerToken: current.workerToken,
        orgId: current.orgId || current.userId,
        failedLeads: diagnostics.failedLeads || 0,
        lastError: finalError,
      };
    });

    if (finalize.status === "completed") {
      const failed = finalize.failedLeads > 0;
      await recordLeadRunOutcome({
        orgId: finalize.orgId,
        runId,
        uid: job.userId,
        failed,
        failureReason: failed
          ? finalize.lastError || `${finalize.failedLeads} lead(s) failed after retries`
          : null,
        correlationId,
        log,
      });
      await releaseLeadRunConcurrencySlot({
        orgId: finalize.orgId,
        runId,
        correlationId,
        log,
      });
    }

    if (finalize.status === "queued") {
      const origin = request.nextUrl?.origin || new URL(request.url).origin;
      void triggerLeadRunWorker(origin, runId, finalize.workerToken, correlationId, log);
    }

    return NextResponse.json({
      ok: true,
      status: finalize.status,
      nextIndex: finalize.nextIndex,
      totalLeads: finalize.totalLeads,
      leadDocId,
      retried: Boolean(processError),
    });
  },
  { route: "lead-runs.jobs.worker" }
);
