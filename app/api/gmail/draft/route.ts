import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, withApiHandler } from "@/lib/api/handler";
import { parseJson } from "@/lib/api/validation";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { getAccessTokenForUser } from "@/lib/google/oauth";
import { createDraftEmail } from "@/lib/google/gmail";
import { getIdempotencyKey, withIdempotency } from "@/lib/api/idempotency";
import { recordLeadActionReceipt } from "@/lib/lead-runs/receipts";
import { resolveLeadRunOrgId } from "@/lib/lead-runs/quotas";
import { findDncMatch } from "@/lib/outreach/dnc";

const emailSchema = z.object({
  to: z.array(z.string().email()).min(1),
  cc: z.array(z.string().email()).optional(),
  bcc: z.array(z.string().email()).optional(),
  subject: z.string().min(1),
  body: z.string().min(1),
  isHtml: z.boolean().optional(),
});

const bodySchema = z.object({
  email: emailSchema,
  idempotencyKey: z.string().optional(),
  dryRun: z.boolean().optional(),
  runId: z.string().min(1).max(128).optional(),
  leadDocId: z.string().min(1).max(120).optional(),
  receiptActionId: z.string().min(1).max(120).optional(),
});

export const POST = withApiHandler(
  async ({ request, log, correlationId }) => {
    const body = await parseJson(request, bodySchema);
    const user = await requireFirebaseAuth(request, log);
    const idempotencyKey = getIdempotencyKey(request, body);

    const orgId = await resolveLeadRunOrgId(user.uid, log);
    const recipients = [
      ...body.email.to,
      ...(body.email.cc || []),
      ...(body.email.bcc || []),
    ];

    for (const recipient of recipients) {
      const domain = recipient.includes("@") ? recipient.split("@")[1] : null;
      const dnc = await findDncMatch({ orgId, email: recipient, domain });
      if (!dnc) continue;

      if (body.runId && body.leadDocId) {
        await recordLeadActionReceipt(
          {
            runId: body.runId,
            leadDocId: body.leadDocId,
            actionId: body.receiptActionId || "gmail.draft",
            uid: user.uid,
            correlationId,
            status: "skipped",
            dryRun: Boolean(body.dryRun),
            replayed: false,
            idempotencyKey,
            data: {
              reason: "dnc",
              to: body.email.to,
              cc: body.email.cc,
              bcc: body.email.bcc,
              subject: body.email.subject,
              blockedRecipient: recipient,
              dnc: { entryId: dnc.entryId, type: dnc.type, value: dnc.value },
            },
          },
          log
        );
      }

      throw new ApiError(409, "Recipient is on the Do Not Contact list.", {
        entryId: dnc.entryId,
        type: dnc.type,
        value: dnc.value,
      });
    }

    if (body.dryRun) {
      const draftId = `dryrun_${correlationId.slice(0, 8)}`;
      const payload = {
        success: true,
        draftId,
        messageId: draftId,
        threadId: undefined as string | undefined,
        dryRun: true,
        replayed: false,
      };

      if (body.runId && body.leadDocId) {
        await recordLeadActionReceipt(
          {
            runId: body.runId,
            leadDocId: body.leadDocId,
            actionId: body.receiptActionId || "gmail.draft",
            uid: user.uid,
            correlationId,
            status: "simulated",
            dryRun: true,
            replayed: false,
            idempotencyKey,
            data: {
              to: body.email.to,
              subject: body.email.subject,
              draftId,
            },
          },
          log
        );
      }

      return NextResponse.json(payload);
    }

    const accessToken = await getAccessTokenForUser(user.uid, log);
    const result = await withIdempotency(
      { uid: user.uid, route: "gmail.draft", key: idempotencyKey, log },
      () => createDraftEmail(accessToken, body.email, log)
    );

    if (body.runId && body.leadDocId) {
      await recordLeadActionReceipt(
        {
          runId: body.runId,
          leadDocId: body.leadDocId,
          actionId: body.receiptActionId || "gmail.draft",
          uid: user.uid,
          correlationId,
          status: "complete",
          dryRun: false,
          replayed: result.replayed,
          idempotencyKey,
          data: {
            to: body.email.to,
            subject: body.email.subject,
            draftId: result.data.draftId,
            messageId: result.data.messageId,
            threadId: result.data.threadId,
          },
        },
        log
      );
    }

    return NextResponse.json({
      success: true,
      draftId: result.data.draftId,
      messageId: result.data.messageId,
      threadId: result.data.threadId,
      dryRun: false,
      replayed: result.replayed,
    });
  },
  { route: "gmail.draft" }
);
