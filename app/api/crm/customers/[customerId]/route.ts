import { NextResponse } from "next/server";
import { z } from "zod";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { withApiHandler } from "@/lib/api/handler";
import { getIdempotencyKey, withIdempotency } from "@/lib/api/idempotency";
import { parseJson } from "@/lib/api/validation";
import {
  normalizePaperclipCustomers,
  updateProjectedCustomerStage,
} from "@/lib/crm/customer-memory";
import { PaperclipClient, readPaperclipClientConfig } from "@/lib/paperclip/client";

const bodySchema = z.object({
  pipelineStage: z.string().trim().min(1).max(80),
  idempotencyKey: z.string().trim().min(1).max(200).optional(),
});

export const PATCH = withApiHandler(
  async ({ request, params, correlationId, log }) => {
    const body = await parseJson(request, bodySchema);
    const user = await requireFirebaseAuth(request, log);
    const idempotencyKey = getIdempotencyKey(request, body);
    const customerId = String(params?.customerId || "").trim();

    const result = await withIdempotency(
      { uid: user.uid, route: "crm.customers.update", key: idempotencyKey, log },
      async () => {
        const config = readPaperclipClientConfig();
        if (config) {
          try {
            const client = new PaperclipClient(config);
            const payload = await client.upsertCustomer({
              customerId,
              correlationId,
              requestedByUid: user.uid,
              payload: {
                pipelineStage: body.pipelineStage,
              },
            });
            return {
              sourceOfTruth: "paperclip" as const,
              customer: normalizePaperclipCustomers(payload)[0] || null,
            };
          } catch (error) {
            log.warn("crm.customers.paperclip_stage_fallback", {
              uid: user.uid,
              customerId,
              message: error instanceof Error ? error.message : String(error),
            });
          }
        }

        const event = await updateProjectedCustomerStage(user.uid, customerId, body.pipelineStage);
        return {
          sourceOfTruth: "firestore_projected" as const,
          event,
        };
      }
    );

    return NextResponse.json({
      ...result.data,
      replayed: result.replayed,
      correlationId,
    });
  },
  { route: "crm.customers.update" }
);
