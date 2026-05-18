import { NextResponse } from "next/server";
import { z } from "zod";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { withApiHandler } from "@/lib/api/handler";
import {
  AdOpsClient,
  readAdOpsProviderConfigs,
  type AdOpsCampaignRecord,
} from "@/lib/ad-ops/client";

const providerSchema = z.enum(["meta_ads", "google_ads"]);

interface CampaignProviderSummary {
  providerId: "meta_ads" | "google_ads";
  label: string;
  configured: boolean;
  writeEnabled: boolean;
  accountId: string | null;
  error: string | null;
}

export const GET = withApiHandler(
  async ({ request, correlationId, log }) => {
    const user = await requireFirebaseAuth(request, log);
    const url = new URL(request.url);
    const parsedProvider = providerSchema.safeParse(url.searchParams.get("provider"));
    const providerId = parsedProvider.success ? parsedProvider.data : undefined;
    const limitParam = Number(url.searchParams.get("limit"));
    const limit = Number.isFinite(limitParam) ? Math.max(1, Math.min(100, Math.floor(limitParam))) : 20;

    const providers = readAdOpsProviderConfigs();
    const client = new AdOpsClient(fetch, providers);
    const selectedProviders = providerId
      ? providers.filter((provider) => provider.providerId === providerId)
      : providers;

    const results = await Promise.all(
      selectedProviders.map(async (provider) => {
        if (!provider.baseUrl) {
          return {
            provider: {
              providerId: provider.providerId,
              label: provider.label,
              configured: false,
              writeEnabled: provider.writeEnabled,
              accountId: provider.accountId,
              error: null,
            } satisfies CampaignProviderSummary,
            campaigns: [] as AdOpsCampaignRecord[],
          };
        }

        try {
          const campaigns = await client.listCampaigns({
            providerId: provider.providerId,
            requestedByUid: user.uid,
            correlationId,
            limit,
          });
          return {
            provider: {
              providerId: provider.providerId,
              label: provider.label,
              configured: true,
              writeEnabled: provider.writeEnabled,
              accountId: provider.accountId,
              error: null,
            } satisfies CampaignProviderSummary,
            campaigns,
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          log.warn("ad_ops.campaigns.provider_error", {
            uid: user.uid,
            providerId: provider.providerId,
            message,
          });
          return {
            provider: {
              providerId: provider.providerId,
              label: provider.label,
              configured: true,
              writeEnabled: provider.writeEnabled,
              accountId: provider.accountId,
              error: message,
            } satisfies CampaignProviderSummary,
            campaigns: [] as AdOpsCampaignRecord[],
          };
        }
      })
    );

    const configuredProviders = results.filter((entry) => entry.provider.configured).length;
    return NextResponse.json({
      providers: results.map((entry) => entry.provider),
      campaigns: results.flatMap((entry) => entry.campaigns),
      ready: configuredProviders > 0,
    });
  },
  { route: "ad-ops.campaigns.list" }
);
