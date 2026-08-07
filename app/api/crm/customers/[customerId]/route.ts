import { NextResponse } from "next/server";
import { z } from "zod";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { ApiError, withApiHandler } from "@/lib/api/handler";
import { getIdempotencyKey, withIdempotency } from "@/lib/api/idempotency";
import { parseJson } from "@/lib/api/validation";
import {
  assertProjectedCustomerWriteAccess,
  normalizePaperclipCustomers,
  updateProjectedCustomerStage,
} from "@/lib/crm/customer-memory";
import { PaperclipClient, readPaperclipClientConfig } from "@/lib/paperclip/client";

const bodySchema = z.object({
  pipelineStage: z.string().trim().min(1).max(80),
  idempotencyKey: z.string().trim().min(1).max(200).optional(),
});

function rethrowCustomerOwnershipRejection(error: unknown): void {
  const status =
    error && typeof error === "object" && typeof (error as { status?: unknown }).status === "number"
      ? (error as { status: number }).status
      : null;
  if (status === 403 || status === 409) {
    throw new ApiError(status, "Customer record is not writable by this user", {
      reason: "upstream_ownership_rejection",
    });
  }
}

export const PATCH = withApiHandler(
  async ({ request, params, correlationId, log }) => {
    const body = await parseJson(request, bodySchema);
    const user = await requireFirebaseAuth(request, log);
    const idempotencyKey = getIdempotencyKey(request, body);
    const customerId = String(params?.customerId || "").trim();
    if (!customerId) {
      throw new ApiError(400, "Customer ID is required");
    }
    await assertProjectedCustomerWriteAccess(user.uid, customerId);

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
            rethrowCustomerOwnershipRejection(error);
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
