import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/api/handler";
import { parseJson } from "@/lib/api/validation";
import { runIntakeNotificationWorkerCycle } from "@/lib/crm/rosser-gallery-intake-notification-worker";
import {
  readRosserGalleryIntakeWorkerConfig,
  requireRosserGalleryIntakeWorkerToken,
} from "@/lib/crm/rosser-gallery-intake-worker-config";

const bodySchema = z
  .object({
    limit: z.number().int().min(1).max(25).optional(),
    leaseSeconds: z.number().int().min(15).max(300).optional(),
  })
  .strict();

export const POST = withApiHandler(
  async ({ request, correlationId, log }) => {
    const config = readRosserGalleryIntakeWorkerConfig();
    requireRosserGalleryIntakeWorkerToken(
      request.headers.get("authorization"),
      config
    );
    const body = await parseJson(request, bodySchema);
    const result = await runIntakeNotificationWorkerCycle({
      config,
      correlationId,
      log,
      limit: body.limit,
      leaseSeconds: body.leaseSeconds,
    });
    const response = NextResponse.json({
      ok: true,
      ...result,
      correlationId,
    });
    response.headers.set("cache-control", "no-store");
    return response;
  },
  { route: "integrations.rosser_gallery.intake_notifications.worker" }
);
