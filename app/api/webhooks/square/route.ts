import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { ApiError, withApiHandler } from "@/lib/api/handler";
import { getAdminDb } from "@/lib/firebase-admin";
import { legacyStatusFromPipelineStage, normalizeCrmPipelineStage } from "@/lib/revenue/offers";
import {
  extractSquareEventId,
  extractSquareLeadDocIdHint,
  extractSquareOfferCode,
  extractSquarePaymentSnapshot,
  extractSquareUidHint,
  isSquareCompletedPaymentEvent,
  verifySquareWebhookSignature,
} from "@/lib/revenue/square";
import { markPosWebhookEventCompleted, queuePosWebhookEvent } from "@/lib/revenue/pos-worker";

const SQUARE_SIGNATURE_HEADER = "x-square-hmacsha256-signature";
const OFFER_CODE_QUERY_LIMIT = 100;
const LEAD_FALLBACK_QUERY_LIMIT = 500;

type LeadDoc = {
  userId?: string;
  offerCode?: string;
  pipelineStage?: string;
  status?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
};

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  const candidate = value as { toDate?: () => Date };
  if (typeof candidate.toDate === "function") {
    try {
      const parsed = candidate.toDate();
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    } catch {
      return null;
    }
  }
  return null;
}

function toMillis(value: unknown): number {
  return asDate(value)?.getTime() || 0;
}

function isTerminalStage(stage: string): boolean {
  return stage === "won" || stage === "lost";
}

function buildOfferCodeVariants(offerCode: string): string[] {
  const base = asString(offerCode);
  if (!base) return [];
  return Array.from(new Set([base, base.toUpperCase(), base.toLowerCase()]));
}

function rankLeadCandidate(doc: LeadDoc): number {
  const stage = normalizeCrmPipelineStage(doc.pipelineStage || doc.status);
  if (stage === "deposit_received") return 1;
  if (isTerminalStage(stage)) return 0;
  return 2;
}

function pickPreferredLead(
  docs: Array<{ id: string; data: LeadDoc }>,
  offerCode: string
): { id: string; data: LeadDoc } | null {
  const matching = docs.filter((doc) => asString(doc.data.offerCode).toUpperCase() === offerCode);
  if (matching.length === 0) return null;

  return (
    matching
      .sort((a, b) => {
        const rankDiff = rankLeadCandidate(b.data) - rankLeadCandidate(a.data);
        if (rankDiff !== 0) return rankDiff;
        const updatedDiff = toMillis(b.data.updatedAt) - toMillis(a.data.updatedAt);
        if (updatedDiff !== 0) return updatedDiff;
        return toMillis(b.data.createdAt) - toMillis(a.data.createdAt);
      })
      .at(0) || null
  );
}

function resolveNotificationUrl(request: Request, configured: string | undefined): string {
  const explicit = asString(configured || "");
  if (explicit) return explicit;

  const raw = new URL(request.url);
  const forwardedHost = asString(request.headers.get("x-forwarded-host"));
  const forwardedProto = asString(request.headers.get("x-forwarded-proto"));
  if (forwardedHost) raw.host = forwardedHost;
  if (forwardedProto) raw.protocol = forwardedProto.endsWith(":") ? forwardedProto : `${forwardedProto}:`;
  return raw.toString();
}

export const POST = withApiHandler(
  async ({ request, correlationId, log }) => {
    const signatureKey = asString(process.env.SQUARE_WEBHOOK_SIGNATURE_KEY || "");
    if (!signatureKey) {
      throw new ApiError(503, "Missing SQUARE_WEBHOOK_SIGNATURE_KEY");
    }

    const rawBody = await request.text();
    let payload: unknown;
    try {
      payload = rawBody ? JSON.parse(rawBody) : {};
    } catch {
      throw new ApiError(400, "Invalid JSON payload");
    }

    const notificationUrl = resolveNotificationUrl(request, process.env.SQUARE_WEBHOOK_NOTIFICATION_URL);
    const providedSignature = request.headers.get(SQUARE_SIGNATURE_HEADER);
    if (
      !verifySquareWebhookSignature({
        notificationUrl,
        rawBody,
        signatureKey,
        providedSignature,
      })
    ) {
      throw new ApiError(401, "Invalid Square webhook signature");
    }

    const eventId = extractSquareEventId(payload);
    if (!eventId) {
      throw new ApiError(400, "Missing Square event_id");
    }

    const uid = extractSquareUidHint(payload, process.env.SQUARE_WEBHOOK_DEFAULT_UID || null);
    if (!uid) {
      log.warn("webhooks.square.ignored", {
        eventId,
        reason: "missing_uid",
      });
      return NextResponse.json(
        {
          ok: true,
          ignored: true,
          reason: "missing_uid",
          eventId,
          correlationId,
        },
        { status: 202 }
      );
    }

    const offerCode = extractSquareOfferCode(payload);
    const leadDocIdHint = extractSquareLeadDocIdHint(payload);
    const payment = extractSquarePaymentSnapshot(payload);
    let posQueue: Awaited<ReturnType<typeof queuePosWebhookEvent>> = {
      queued: false,
      replayed: false,
      ignored: true,
      reason: "queue_unavailable",
      eventType: null,
    };

    try {
      posQueue = await queuePosWebhookEvent({
        uid,
        eventId,
        payload,
        offerCode,
        leadDocIdHint,
        payment,
        correlationId,
        log,
      });
    } catch (error) {
      log.warn("webhooks.square.pos_queue_failed", {
        eventId,
        uid,
        message: error instanceof Error ? error.message : String(error),
      });
    }

    if (!isSquareCompletedPaymentEvent(payload)) {
      log.info("webhooks.square.ignored", {
        eventId,
        reason: "not_completed_payment",
        posQueueReason: posQueue.reason,
        posQueued: posQueue.queued,
      });
      return NextResponse.json(
        {
          ok: true,
          ignored: true,
          reason: "not_completed_payment",
          eventId,
          uid,
          posQueue,
          correlationId,
        },
        { status: 202 }
      );
    }

    if (!offerCode) {
      log.warn("webhooks.square.ignored", {
        eventId,
        reason: "missing_offer_code",
      });
      return NextResponse.json(
        {
          ok: true,
          ignored: true,
          reason: "missing_offer_code",
          eventId,
          uid,
          posQueue,
          correlationId,
        },
        { status: 202 }
      );
    }

    const db = getAdminDb();
    const outcome = await db.runTransaction(async (tx) => {
      const eventRef = db.collection("square_webhook_events").doc(eventId);
      const existingEvent = await tx.get(eventRef);
      if (existingEvent.exists) {
        const existingData = existingEvent.data() as Record<string, unknown>;
        return {
          replayed: true,
          applied: Boolean(existingData.applied),
          leadDocId: asString(existingData.leadDocId) || null,
          stageAfter: asString(existingData.stageAfter) || null,
          reason: asString(existingData.reason) || null,
        };
      }

      const leadsCollection = db.collection("leads");
      let selectedLead:
        | {
            ref: ReturnType<typeof leadsCollection.doc>;
            id: string;
            data: LeadDoc;
          }
        | null = null;

      if (leadDocIdHint) {
        const hintedRef = leadsCollection.doc(leadDocIdHint);
        const hintedSnap = await tx.get(hintedRef);
        if (hintedSnap.exists) {
          const hintedData = (hintedSnap.data() || {}) as LeadDoc;
          const hintedUid = asString(hintedData.userId);
          const hintedOffer = asString(hintedData.offerCode).toUpperCase();
          if (hintedUid === uid && (!hintedOffer || hintedOffer === offerCode)) {
            selectedLead = {
              ref: hintedRef,
              id: hintedSnap.id,
              data: hintedData,
            };
          }
        }
      }

      if (!selectedLead) {
        const candidateDocsById = new Map<string, { id: string; data: LeadDoc }>();

        for (const offerVariant of buildOfferCodeVariants(offerCode)) {
          const offerQuery = leadsCollection
            .where("userId", "==", uid)
            .where("offerCode", "==", offerVariant)
            .limit(OFFER_CODE_QUERY_LIMIT);
          const offerSnap = await tx.get(offerQuery);
          for (const docSnap of offerSnap.docs) {
            candidateDocsById.set(docSnap.id, {
              id: docSnap.id,
              data: (docSnap.data() || {}) as LeadDoc,
            });
          }
        }

        if (candidateDocsById.size === 0) {
          const leadsQuery = leadsCollection.where("userId", "==", uid).limit(LEAD_FALLBACK_QUERY_LIMIT);
          const leadsSnap = await tx.get(leadsQuery);
          for (const docSnap of leadsSnap.docs) {
            candidateDocsById.set(docSnap.id, {
              id: docSnap.id,
              data: (docSnap.data() || {}) as LeadDoc,
            });
          }
        }

        const candidateDocs = Array.from(candidateDocsById.values());
        const preferred = pickPreferredLead(candidateDocs, offerCode);
        if (preferred) {
          selectedLead = {
            ref: leadsCollection.doc(preferred.id),
            id: preferred.id,
            data: preferred.data,
          };
        }
      }

      if (!selectedLead) {
        tx.set(
          eventRef,
          {
            eventId,
            uid,
            offerCode,
            leadDocId: null,
            applied: false,
            reason: "no_matching_lead",
            payment,
            correlationId,
            receivedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );

        return {
          replayed: false,
          applied: false,
          leadDocId: null,
          stageAfter: null,
          reason: "no_matching_lead",
        };
      }

      const stageBefore = normalizeCrmPipelineStage(
        selectedLead.data.pipelineStage || selectedLead.data.status
      );
      const stageAfter = isTerminalStage(stageBefore) ? stageBefore : "deposit_received";
      const statusAfter = legacyStatusFromPipelineStage(stageAfter);

      const leadPatch: Record<string, unknown> = {
        offerCode,
        status: statusAfter,
        updatedAt: FieldValue.serverTimestamp(),
        squarePayment: {
          eventId,
          paymentId: payment.paymentId,
          orderId: payment.orderId,
          amountCents: payment.amountCents,
          currency: payment.currency,
          status: payment.status,
          customerId: payment.customerId,
          referenceId: payment.referenceId,
          note: payment.note,
          recordedAt: new Date().toISOString(),
        },
      };

      if (!isTerminalStage(stageBefore)) {
        leadPatch.pipelineStage = "deposit_received";
        leadPatch.depositReceivedAt = FieldValue.serverTimestamp();
      }

      tx.set(selectedLead.ref, leadPatch, { merge: true });
      tx.set(
        eventRef,
        {
          eventId,
          uid,
          offerCode,
          leadDocId: selectedLead.id,
          applied: true,
          reason: "applied",
          stageBefore,
          stageAfter,
          payment,
          correlationId,
          receivedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      return {
        replayed: false,
        applied: true,
        leadDocId: selectedLead.id,
        stageAfter,
        reason: "applied",
      };
    });

    if (!posQueue.ignored) {
      try {
        await markPosWebhookEventCompleted({
          uid,
          eventId,
          correlationId,
          log,
        });
      } catch (error) {
        log.warn("webhooks.square.pos_inline_complete_failed", {
          eventId,
          uid,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    log.info("webhooks.square.processed", {
      eventId,
      uid,
      offerCode,
      leadDocId: outcome.leadDocId,
      applied: outcome.applied,
      replayed: outcome.replayed,
      reason: outcome.reason,
      posQueued: posQueue.queued,
      posReplayed: posQueue.replayed,
    });

    return NextResponse.json({
      ok: true,
      eventId,
      offerCode,
      uid,
      posQueue,
      ...outcome,
      correlationId,
    });
  },
  { route: "webhooks.square.post" }
);
