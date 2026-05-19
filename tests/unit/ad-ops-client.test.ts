import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AdOpsClient,
  AdOpsClientError,
  normalizeCampaigns,
  readAdOpsProviderConfig,
  type AdOpsProviderConfig,
} from "@/lib/ad-ops/client";

const ORIGINAL_ENV = {
  META_ADS_CONTROL_URL: process.env.META_ADS_CONTROL_URL,
  META_ADS_ACCOUNT_ID: process.env.META_ADS_ACCOUNT_ID,
  META_ADS_WRITE_ENABLED: process.env.META_ADS_WRITE_ENABLED,
  META_ADS_CONTROL_TOKEN: process.env.META_ADS_CONTROL_TOKEN,
  META_ADS_ACCESS_TOKEN: process.env.META_ADS_ACCESS_TOKEN,
  GOOGLE_ADS_CONTROL_URL: process.env.GOOGLE_ADS_CONTROL_URL,
  GOOGLE_ADS_CUSTOMER_ID: process.env.GOOGLE_ADS_CUSTOMER_ID,
  GOOGLE_ADS_WRITE_ENABLED: process.env.GOOGLE_ADS_WRITE_ENABLED,
  GOOGLE_ADS_DEVELOPER_TOKEN: process.env.GOOGLE_ADS_DEVELOPER_TOKEN,
  GOOGLE_ADS_CLIENT_ID: process.env.GOOGLE_ADS_CLIENT_ID,
  GOOGLE_ADS_CLIENT_SECRET: process.env.GOOGLE_ADS_CLIENT_SECRET,
  GOOGLE_ADS_REFRESH_TOKEN: process.env.GOOGLE_ADS_REFRESH_TOKEN,
};

afterEach(() => {
  vi.restoreAllMocks();
  Object.assign(process.env, ORIGINAL_ENV);
});

function metaProvider(overrides: Partial<AdOpsProviderConfig> = {}): AdOpsProviderConfig {
  return {
    providerId: "meta_ads",
    label: "Meta Ads",
    transport: "control_plane",
    baseUrl: "https://meta-control.example",
    serviceToken: "meta-token",
    accountId: "act_123",
    writeEnabled: true,
    campaignsPath: "/campaigns",
    actionPathTemplate: "/campaigns/{campaignId}/actions",
    timeoutMs: 1_000,
    ...overrides,
  };
}

function googleProvider(overrides: Partial<AdOpsProviderConfig> = {}): AdOpsProviderConfig {
  return {
    providerId: "google_ads",
    label: "Google Ads",
    transport: "direct_google",
    baseUrl: null,
    serviceToken: null,
    accountId: "1234567890",
    writeEnabled: true,
    campaignsPath: "/campaigns",
    actionPathTemplate: "/campaigns/{campaignId}/actions",
    timeoutMs: 1_000,
    googleApiVersion: "v19",
    googleDeveloperToken: "dev-token",
    googleClientId: "client-id",
    googleClientSecret: "client-secret",
    googleRefreshToken: "refresh-token",
    googleLoginCustomerId: null,
    ...overrides,
  };
}

describe("AdOpsClient", () => {
  it("prefers direct Meta mode when no control URL is configured", () => {
    process.env.META_ADS_CONTROL_URL = "";
    process.env.META_ADS_ACCOUNT_ID = "act_123";
    process.env.META_ADS_ACCESS_TOKEN = "meta-access";
    process.env.META_ADS_WRITE_ENABLED = "true";

    const config = readAdOpsProviderConfig("meta_ads");

    expect(config.transport).toBe("direct_meta");
    expect(config.accountId).toBe("act_123");
    expect(config.metaAccessToken).toBe("meta-access");
  });

  it("normalizes provider campaign payloads", () => {
    const campaigns = normalizeCampaigns(metaProvider(), {
      campaigns: [
        {
          id: "cmp_1",
          name: "Spring Promo",
          status: "ACTIVE",
          objective: "Leads",
          dailyBudgetUsd: 75,
          spendMonthToDateUsd: 321.5,
          updatedAt: "2026-04-06T10:00:00.000Z",
        },
      ],
    });

    expect(campaigns).toEqual([
      expect.objectContaining({
        providerId: "meta_ads",
        campaignId: "cmp_1",
        status: "active",
        dailyBudgetUsd: 75,
        spendMonthToDateUsd: 321.5,
      }),
    ]);
  });

  it("lists campaigns through an external control plane", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      expect(url).toContain("accountId=act_123");
      expect(url).toContain("requestedByUid=user-1");
      return new Response(JSON.stringify({ items: [{ campaignId: "cmp_1", name: "Pipeline Booster", status: "PAUSED" }] }), { status: 200 });
    });

    const client = new AdOpsClient(fetchMock as unknown as typeof fetch, [metaProvider()]);
    const campaigns = await client.listCampaigns({
      providerId: "meta_ads",
      correlationId: "cid-1",
      requestedByUid: "user-1",
      limit: 5,
    });

    expect(campaigns[0]?.status).toBe("paused");
  });

  it("lists campaigns directly from Meta Graph", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/campaigns?")) {
        return new Response(JSON.stringify({ data: [{ id: "cmp_1", name: "Meta Direct", effective_status: "ACTIVE", daily_budget: "2500", updated_time: "2026-04-06T10:00:00Z" }] }), { status: 200 });
      }
      return new Response(JSON.stringify({ data: [{ campaign_id: "cmp_1", spend: "41.2" }] }), { status: 200 });
    });

    const client = new AdOpsClient(fetchMock as unknown as typeof fetch, [
      metaProvider({
        transport: "direct_meta",
        baseUrl: null,
        serviceToken: null,
        metaAccessToken: "meta-access",
      }),
    ]);

    const campaigns = await client.listCampaigns({
      providerId: "meta_ads",
      correlationId: "cid-1",
      requestedByUid: "user-1",
    });

    expect(campaigns).toEqual([
      expect.objectContaining({
        campaignId: "cmp_1",
        name: "Meta Direct",
        status: "active",
        dailyBudgetUsd: 25,
        spendMonthToDateUsd: 41.2,
      }),
    ]);
  });

  it("invokes a Google Ads campaign action directly", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("oauth2.googleapis.com/token")) {
        return new Response(JSON.stringify({ access_token: "google-access" }), { status: 200 });
      }
      if (url.includes("campaigns:mutate")) {
        expect(String(init?.body || "")).toContain("\"status\":\"ENABLED\"");
        return new Response(JSON.stringify({ results: [{ resourceName: "customers/1234567890/campaigns/999" }] }), { status: 200 });
      }
      return new Response(JSON.stringify([{ results: [{ campaign: { id: "999", name: "Google Direct", status: "ENABLED", advertisingChannelType: "SEARCH" }, campaignBudget: { amountMicros: "5000000" }, metrics: { costMicros: "1230000" } }] }]), { status: 200 });
    });

    const client = new AdOpsClient(fetchMock as unknown as typeof fetch, [googleProvider()]);
    const payload = await client.invokeCampaignAction({
      providerId: "google_ads",
      campaignId: "999",
      action: "resume",
      correlationId: "cid-1",
      requestedByUid: "user-1",
      autonomyClass: "spend_bearing",
      envelope: {
        agentId: "mission-control/ad-ops",
        delegatedBy: "mission-control:user-1",
        scope: ["ad_ops.google_ads.campaign.resume"],
        trustLevel: "high",
        evidenceRef: "mission-control:/dashboard/operations#ad-ops",
        approvalRef: "approval-123",
      },
    });

    expect(payload).toEqual(
      expect.objectContaining({
        ok: true,
        campaign: expect.objectContaining({
          campaignId: "999",
          status: "active",
        }),
      })
    );
  });

  it("throws when the provider is not configured", async () => {
    const client = new AdOpsClient(vi.fn() as unknown as typeof fetch, [
      metaProvider({ transport: "disabled", baseUrl: null }),
    ]);

    await expect(
      client.listCampaigns({
        providerId: "meta_ads",
        correlationId: "cid-1",
        requestedByUid: "user-1",
      })
    ).rejects.toBeInstanceOf(AdOpsClientError);
  });
});
