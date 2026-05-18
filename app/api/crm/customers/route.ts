import { NextResponse } from "next/server";
import { z } from "zod";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { withApiHandler } from "@/lib/api/handler";
import { getIdempotencyKey, withIdempotency } from "@/lib/api/idempotency";
import { parseJson } from "@/lib/api/validation";
import {
  listProjectedCustomers,
  normalizePaperclipCustomers,
  upsertProjectedCustomer,
  type CustomerRecord,
} from "@/lib/crm/customer-memory";
import { PaperclipClient, readPaperclipClientConfig } from "@/lib/paperclip/client";

const bodySchema = z.object({
  customerId: z.string().trim().min(1).max(160).optional(),
  companyName: z.string().trim().min(1).max(160),
  contactName: z.string().trim().max(160).optional(),
  email: z.string().trim().email().max(160).optional().or(z.literal("")),
  phone: z.string().trim().max(40).optional(),
  sourceLabel: z.string().trim().max(120).optional(),
  businessUnit: z.string().trim().max(80).optional(),
  offerCode: z.string().trim().max(80).optional(),
  pipelineStage: z.string().trim().max(80).optional(),
  idempotencyKey: z.string().trim().min(1).max(200).optional(),
});

function asCustomerFromInput(
  customerId: string,
  body: z.infer<typeof bodySchema>,
  sourceOfTruth: "paperclip" | "firestore_projected"
): CustomerRecord {
  return {
    customerId,
    companyName: body.companyName.trim(),
    contactName: body.contactName?.trim() || null,
    email: body.email?.trim() || null,
    phone: body.phone?.trim() || null,
    sourceLabel: body.sourceLabel?.trim() || null,
    businessUnit: "ai_cofoundry",
    offerCode: body.offerCode?.trim().toUpperCase() || "AICF-DISCOVERY",
    pipelineStage: "lead_capture",
    channels: [
      ...(body.email?.trim() ? (["email"] as const) : []),
      ...(body.phone?.trim() ? (["sms", "voice"] as const) : []),
      "system",
    ],
    lastTimelineAt: null,
    timelineCount: 1,
    duplicateProtection: true,
    dncProtection: true,
    sourceOfTruth,
  };
}

export const GET = withApiHandler(
  async ({ request, correlationId, log }) => {
    const user = await requireFirebaseAuth(request, log);
    const url = new URL(request.url);
    const limitParam = Number(url.searchParams.get("limit"));
    const limit = Number.isFinite(limitParam) ? Math.max(1, Math.min(200, Math.floor(limitParam))) : 100;

    const config = readPaperclipClientConfig();
    if (config) {
      try {
        const client = new PaperclipClient(config);
        const payload = await client.listCustomers({
          correlationId,
          requestedByUid: user.uid,
          limit,
        });
        return NextResponse.json({
          sourceOfTruth: "paperclip",
          customers: normalizePaperclipCustomers(payload),
        });
      } catch (error) {
        log.warn("crm.customers.paperclip_fallback", {
          uid: user.uid,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const customers = await listProjectedCustomers(user.uid, log, limit);
    return NextResponse.json({
      sourceOfTruth: "firestore_projected",
      customers,
    });
  },
  { route: "crm.customers.list" }
);

export const POST = withApiHandler(
  async ({ request, correlationId, log }) => {
    const body = await parseJson(request, bodySchema);
    const user = await requireFirebaseAuth(request, log);
    const idempotencyKey = getIdempotencyKey(request, body);

    const result = await withIdempotency(
      { uid: user.uid, route: "crm.customers.upsert", key: idempotencyKey, log },
      async () => {
        const config = readPaperclipClientConfig();
        if (config) {
          try {
            const client = new PaperclipClient(config);
            const payload = await client.upsertCustomer({
              customerId: body.customerId || null,
              correlationId,
              requestedByUid: user.uid,
              payload: {
                companyName: body.companyName,
                contactName: body.contactName || null,
                email: body.email || null,
                phone: body.phone || null,
                sourceLabel: body.sourceLabel || null,
                businessUnit: body.businessUnit,
                offerCode: body.offerCode,
                pipelineStage: body.pipelineStage,
              },
            });
            const normalized = normalizePaperclipCustomers(payload);
            return {
              sourceOfTruth: "paperclip" as const,
              customer:
                normalized[0] ||
                asCustomerFromInput(body.customerId || crypto.randomUUID(), body, "paperclip"),
            };
          } catch (error) {
            log.warn("crm.customers.paperclip_write_fallback", {
              uid: user.uid,
              message: error instanceof Error ? error.message : String(error),
            });
          }
        }

        const customer = await upsertProjectedCustomer(user.uid, {
          customerId: body.customerId || null,
          companyName: body.companyName,
          contactName: body.contactName || null,
          email: body.email || null,
          phone: body.phone || null,
          sourceLabel: body.sourceLabel || null,
          businessUnit: body.businessUnit,
          offerCode: body.offerCode,
          pipelineStage: body.pipelineStage,
        });
        return {
          sourceOfTruth: "firestore_projected" as const,
          customer,
        };
      }
    );

    return NextResponse.json({
      ...result.data,
      replayed: result.replayed,
      correlationId,
    });
  },
  { route: "crm.customers.upsert" }
);
