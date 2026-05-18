import { NextResponse } from "next/server";
import { z } from "zod";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { ApiError, withApiHandler } from "@/lib/api/handler";
import { getIdempotencyKey, withIdempotency } from "@/lib/api/idempotency";
import { parseJson } from "@/lib/api/validation";
import {
  AdOpsClient,
  AdOpsClientError,
  readAdOpsProviderConfig,
  type AdOpsCampaignAction,
  type AdOpsProviderId,
} from "@/lib/ad-ops/client";
import { assertProviderSpendAllowed } from "@/lib/budget/enforcement";

const bodySchema = z.object({
  providerId: z.enum(["meta_ads", "google_ads"]),
  action: z.enum(["pause", "resume", "sync"]),
  note: z.string().trim().max(400).optional(),
  evidenceRef: z.string().trim().min(1).max(260),
  approvalRef: z.string().trim().min(1).max(200).optional(),
  delegatedBy: z.string().trim().max(200).optional(),
  idempotencyKey: z.string().trim().min(1).max(200).optional(),
});

function buildScope(providerId: AdOpsProviderId, action: AdOpsCampaignAction): string[] {
  return [`ad_ops.${providerId}.campaign.${action}`];
}

function buildAutonomyClass(action: AdOpsCampaignAction): "internal_write" | "spend_bearing" {
  return action === "resume" ? "spend_bearing" : "internal_write";
}

function buildTrustLevel(action: AdOpsCampaignAction): "medium" | "high" {
  return action === "resume" ? "high" : "medium";
}

export const POST = withApiHandler(
  async ({ request, params, correlationId, log }) => {
    const body = await parseJson(request, bodySchema);
    const user = await requireFirebaseAuth(request, log);
    const idempotencyKey = getIdempotencyKey(request, body);
    const campaignId = String(params?.campaignId || "").trim();
    if (!campaignId) {
      throw new ApiError(400, "campaignId is required");
    }

    const provider = readAdOpsProviderConfig(body.providerId);
    if (!provider.baseUrl) {
      throw new ApiError(503, `${provider.label} control plane is not configured`);
    }

    if (body.action === "resume" && !provider.writeEnabled) {
      throw new ApiError(409, `${provider.label} writes are disabled`);
    }

    if (body.action === "resume" && !body.approvalRef) {
      throw new ApiError(400, "approvalRef is required for spend-bearing ad actions");
    }

    if (body.action === "resume") {
      await assertProviderSpendAllowed({
        uid: user.uid,
        providerId: body.providerId,
        log,
        route: "ad-ops.campaigns.action",
      });
    }

    const result = await withIdempotency(
      {
        uid: user.uid,
        route: `ad-ops.campaigns.action.${body.providerId}.${body.action}`,
        key: idempotencyKey,
        log,
      },
      async () => {
        const client = new AdOpsClient(fetch, [provider]);
        try {
          const payload = await client.invokeCampaignAction({
            providerId: body.providerId,
            campaignId,
            action: body.action,
            correlationId,
            requestedByUid: user.uid,
            note: body.note || null,
            autonomyClass: buildAutonomyClass(body.action),
            envelope: {
              agentId: "mission-control/ad-ops",
              delegatedBy: body.delegatedBy || `mission-control:${user.uid}`,
              scope: buildScope(body.providerId, body.action),
              trustLevel: buildTrustLevel(body.action),
              evidenceRef: body.evidenceRef,
              approvalRef: body.approvalRef || null,
            },
          });

          log.info("ad_ops.campaigns.action_forwarded", {
            uid: user.uid,
            providerId: body.providerId,
            campaignId,
            action: body.action,
            scope: buildScope(body.providerId, body.action),
          });

          return {
            ok: true,
            providerId: body.providerId,
            campaignId,
            action: body.action,
            proxied: true,
            payload,
          };
        } catch (error) {
          if (error instanceof AdOpsClientError) {
            throw new ApiError(error.status, error.message);
          }
          throw error;
        }
      }
    );

    return NextResponse.json({
      ...result.data,
      replayed: result.replayed,
      correlationId,
    });
  },
  { route: "ad-ops.campaigns.action" }
);
