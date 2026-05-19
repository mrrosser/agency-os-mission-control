import { NextResponse } from "next/server";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { withApiHandler } from "@/lib/api/handler";
import {
  getProjectedCustomerTimeline,
  normalizePaperclipTimeline,
} from "@/lib/crm/customer-memory";
import { PaperclipClient, readPaperclipClientConfig } from "@/lib/paperclip/client";

export const GET = withApiHandler(
  async ({ request, params, correlationId, log }) => {
    const user = await requireFirebaseAuth(request, log);
    const customerId = String(params?.customerId || "").trim();
    const url = new URL(request.url);
    const limitParam = Number(url.searchParams.get("limit"));
    const limit = Number.isFinite(limitParam) ? Math.max(1, Math.min(100, Math.floor(limitParam))) : 50;

    const config = readPaperclipClientConfig();
    if (config) {
      try {
        const client = new PaperclipClient(config);
        const payload = await client.getCustomerTimeline({
          customerId,
          correlationId,
          requestedByUid: user.uid,
          limit,
        });
        return NextResponse.json({
          sourceOfTruth: "paperclip",
          events: normalizePaperclipTimeline(customerId, payload),
        });
      } catch (error) {
        log.warn("crm.customers.timeline_paperclip_fallback", {
          uid: user.uid,
          customerId,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const events = await getProjectedCustomerTimeline(user.uid, customerId, log);
    return NextResponse.json({
      sourceOfTruth: "firestore_projected",
      events: events.slice(0, limit),
    });
  },
  { route: "crm.customers.timeline" }
);
