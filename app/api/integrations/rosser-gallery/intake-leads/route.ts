import { NextResponse } from "next/server";
import { ApiError, withApiHandler } from "@/lib/api/handler";
import {
  ROSSER_GALLERY_INTAKE_BUSINESS_UNITS,
  ROSSER_GALLERY_INTAKE_LANES,
  ROSSER_GALLERY_MEETING_INTENTS,
  rosserGalleryIntakeLeadV1Schema,
  type RosserGalleryIntakeLeadV1,
} from "@/lib/crm/rosser-gallery-intake-contract";
import { readRosserGalleryIntakeConfig } from "@/lib/crm/rosser-gallery-intake-config";
import { ingestRosserGalleryIntakeLead } from "@/lib/crm/rosser-gallery-intake-ingest";
import { triggerIntakeNotificationWorker } from "@/lib/crm/rosser-gallery-intake-notification-trigger";
import { requireRosserGalleryServiceToken } from "@/lib/crm/rosser-gallery-crm-config";

const CORRELATION_ID_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;
const MAX_BODY_BYTES = 32 * 1024;

async function parseBoundedIntakeLead(
  request: Request
): Promise<RosserGalleryIntakeLeadV1> {
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    throw new ApiError(413, "Request body is too large");
  }
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
    throw new ApiError(413, "Request body is too large");
  }

  let candidate: unknown;
  try {
    candidate = JSON.parse(raw);
  } catch {
    throw new ApiError(400, "Invalid JSON body");
  }
  const parsed = rosserGalleryIntakeLeadV1Schema.safeParse(candidate);
  if (!parsed.success) {
    throw new ApiError(400, "Invalid request body", {
      issues: parsed.error.issues,
    });
  }
  return parsed.data;
}

export const GET = withApiHandler(
  async ({ request, correlationId, log }) => {
    const config = readRosserGalleryIntakeConfig();
    requireRosserGalleryServiceToken(request.headers.get("authorization"), config);
    log.info("crm.rosser_gallery_intake_receiver_ready", {
      supportedLaneCount: ROSSER_GALLERY_INTAKE_LANES.length,
      supportedBusinessUnitCount: ROSSER_GALLERY_INTAKE_BUSINESS_UNITS.length,
      notificationMode: "outbox",
    });
    const response = NextResponse.json({
      ok: true,
      receiver: "rosser-gallery-intake-leads",
      contractVersions: [1],
      supportedLanes: ROSSER_GALLERY_INTAKE_LANES,
      supportedBusinessUnits: ROSSER_GALLERY_INTAKE_BUSINESS_UNITS,
      supportedMeetingIntents: ROSSER_GALLERY_MEETING_INTENTS,
      notificationMode: "outbox",
      correlationId,
    });
    response.headers.set("cache-control", "no-store");
    return response;
  },
  { route: "integrations.rosser_gallery.intake_leads.readiness" }
);

export const POST = withApiHandler(
  async ({ request, correlationId, log }) => {
    const incomingCorrelationId = request.headers.get("x-correlation-id");
    if (
      incomingCorrelationId !== null &&
      !CORRELATION_ID_PATTERN.test(incomingCorrelationId.trim())
    ) {
      throw new ApiError(400, "Invalid X-Correlation-Id header");
    }

    const config = readRosserGalleryIntakeConfig();
    requireRosserGalleryServiceToken(request.headers.get("authorization"), config);
    const payload = await parseBoundedIntakeLead(request);
    const idempotencyKey = request.headers.get("x-idempotency-key")?.trim();
    if (!idempotencyKey) {
      throw new ApiError(400, "X-Idempotency-Key header is required");
    }
    if (idempotencyKey !== payload.externalEventId) {
      throw new ApiError(400, "X-Idempotency-Key must match externalEventId");
    }

    const result = await ingestRosserGalleryIntakeLead(payload, config, {
      correlationId,
    });
    log.info("crm.rosser_gallery_intake_ingested", {
      receiptId: result.receiptId,
      schemaVersion: payload.schemaVersion,
      lane: payload.lane,
      businessUnit: payload.businessUnit,
      notificationChannelCount: result.notificationChannels.length,
      replayed: result.replayed,
    });
    await triggerIntakeNotificationWorker({ correlationId, log });

    const response = NextResponse.json(
      {
        ok: true,
        replayed: result.replayed,
        receiptId: result.receiptId,
        customerId: result.customerId,
        timelineEventId: result.timelineEventId,
        notificationChannels: result.notificationChannels,
        correlationId,
        receivedAt: result.receivedAt,
      },
      { status: result.replayed ? 200 : 201 }
    );
    response.headers.set("cache-control", "no-store");
    return response;
  },
  { route: "integrations.rosser_gallery.intake_leads" }
);
