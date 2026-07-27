import { NextResponse } from "next/server";
import { ApiError, withApiHandler } from "@/lib/api/handler";
import { ingestRosserGalleryCollectorLead } from "@/lib/crm/rosser-gallery-collector-ingest";
import {
  ROSSER_GALLERY_SUPPORTED_LEAD_LANES,
  rosserGalleryCollectorLeadSchema,
  type RosserGalleryCollectorLead,
} from "@/lib/crm/rosser-gallery-collector-contract";
import {
  readRosserGalleryCrmConfig,
  requireRosserGalleryServiceToken,
} from "@/lib/crm/rosser-gallery-crm-config";

const CORRELATION_ID_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;
const MAX_BODY_BYTES = 32 * 1024;

async function parseBoundedCollectorLead(
  request: Request
): Promise<RosserGalleryCollectorLead> {
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
  const parsed = rosserGalleryCollectorLeadSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new ApiError(400, "Invalid request body", {
      issues: parsed.error.issues,
    });
  }
  return parsed.data;
}

export const GET = withApiHandler(
  async ({ request, correlationId, log }) => {
    const config = readRosserGalleryCrmConfig();
    requireRosserGalleryServiceToken(request.headers.get("authorization"), config);
    log.info("crm.rosser_gallery_collector_receiver_ready", {
      supportedLaneCount: ROSSER_GALLERY_SUPPORTED_LEAD_LANES.length,
    });
    const response = NextResponse.json({
      ok: true,
      receiver: "rosser-gallery-collector-leads",
      contractVersions: [1, 2],
      supportedLanes: ROSSER_GALLERY_SUPPORTED_LEAD_LANES,
      correlationId,
    });
    response.headers.set("cache-control", "no-store");
    return response;
  },
  { route: "integrations.rosser_gallery.collector_leads.readiness" }
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

    const config = readRosserGalleryCrmConfig();
    requireRosserGalleryServiceToken(request.headers.get("authorization"), config);

    const payload = await parseBoundedCollectorLead(request);
    const idempotencyKey = request.headers.get("x-idempotency-key")?.trim();
    if (!idempotencyKey) {
      throw new ApiError(400, "X-Idempotency-Key header is required");
    }
    if (idempotencyKey !== payload.externalEventId) {
      throw new ApiError(400, "X-Idempotency-Key must match externalEventId");
    }

    const result = await ingestRosserGalleryCollectorLead(payload, config, {
      correlationId,
    });
    log.info("crm.rosser_gallery_collector_ingested", {
      receiptId: result.receiptId,
      campaignId: payload.campaign.id,
      schemaVersion: payload.schemaVersion,
      eventType: "eventType" in payload ? payload.eventType : "collector_request",
      interest: payload.collector.interest,
      replayed: result.replayed,
    });

    const response = NextResponse.json(
      {
        ok: true,
        replayed: result.replayed,
        receiptId: result.receiptId,
        customerId: result.customerId,
        timelineEventId: result.timelineEventId,
        correlationId,
        receivedAt: result.receivedAt,
      },
      { status: result.replayed ? 200 : 201 }
    );
    response.headers.set("cache-control", "no-store");
    return response;
  },
  { route: "integrations.rosser_gallery.collector_leads" }
);
