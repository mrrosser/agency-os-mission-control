import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET as listCampaigns } from "@/app/api/ad-ops/campaigns/route";
import { POST as campaignAction } from "@/app/api/ad-ops/campaigns/[campaignId]/action/route";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { ApiError } from "@/lib/api/handler";
import { withIdempotency } from "@/lib/api/idempotency";
import {
  AdOpsClient,
  readAdOpsProviderConfig,
  readAdOpsProviderConfigs,
} from "@/lib/ad-ops/client";
import { assertProviderSpendAllowed } from "@/lib/budget/enforcement";

vi.mock("@/lib/api/auth", () => ({
  requireFirebaseAuth: vi.fn(),
}));

vi.mock("@/lib/api/idempotency", () => ({
  getIdempotencyKey: vi.fn(() => "idempotency-1"),
  withIdempotency: vi.fn(async (_params, executor: () => Promise<unknown>) => ({
    data: await executor(),
    replayed: false,
  })),
}));

vi.mock("@/lib/ad-ops/client", () => ({
  readAdOpsProviderConfigs: vi.fn(),
  readAdOpsProviderConfig: vi.fn(),
  AdOpsClient: vi.fn(),
  AdOpsClientError: class AdOpsClientError extends Error {
    status: number;
    constructor(message: string, status: number = 500) {
      super(message);
      this.status = status;
    }
  },
}));

vi.mock("@/lib/budget/enforcement", () => ({
  assertProviderSpendAllowed: vi.fn(async () => undefined),
}));

const requireAuthMock = vi.mocked(requireFirebaseAuth);
const withIdempotencyMock = vi.mocked(withIdempotency);
const readAdOpsProviderConfigsMock = vi.mocked(readAdOpsProviderConfigs);
const readAdOpsProviderConfigMock = vi.mocked(readAdOpsProviderConfig);
const AdOpsClientMock = vi.mocked(AdOpsClient);
const assertProviderSpendAllowedMock = vi.mocked(assertProviderSpendAllowed);

function routeContext(params: Record<string, string> = {}) {
  return { params: Promise.resolve(params) };
}

describe("ad-ops routes", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    requireAuthMock.mockResolvedValue({ uid: "user-1" } as never);
    withIdempotencyMock.mockImplementation(async (_params, executor: () => Promise<unknown>) => ({
      data: await executor(),
      replayed: false,
    }));
    readAdOpsProviderConfigsMock.mockReturnValue([
      {
        providerId: "meta_ads",
        label: "Meta Ads",
        transport: "control_plane",
        baseUrl: "https://meta-control.example",
        serviceToken: "meta-token",
        accountId: "act_123",
        writeEnabled: true,
        campaignsPath: "/campaigns",
        actionPathTemplate: "/campaigns/{campaignId}/actions",
        timeoutMs: 1000,
      },
      {
        providerId: "google_ads",
        label: "Google Ads",
        transport: "disabled",
        baseUrl: null,
        serviceToken: null,
        accountId: null,
        writeEnabled: false,
        campaignsPath: "/campaigns",
        actionPathTemplate: "/campaigns/{campaignId}/actions",
        timeoutMs: 1000,
      },
    ]);
    readAdOpsProviderConfigMock.mockImplementation((providerId) => ({
      providerId,
      label: providerId === "meta_ads" ? "Meta Ads" : "Google Ads",
      transport: providerId === "meta_ads" ? "control_plane" : "disabled",
      baseUrl: providerId === "meta_ads" ? "https://meta-control.example" : null,
      serviceToken: providerId === "meta_ads" ? "meta-token" : null,
      accountId: providerId === "meta_ads" ? "act_123" : null,
      writeEnabled: providerId === "meta_ads",
      campaignsPath: "/campaigns",
      actionPathTemplate: "/campaigns/{campaignId}/actions",
      timeoutMs: 1000,
    }));
    AdOpsClientMock.mockImplementation(
      () =>
        ({
          listCampaigns: vi.fn(async () => [
            {
              providerId: "meta_ads",
              providerLabel: "Meta Ads",
              campaignId: "cmp_1",
              name: "Spring Promo",
              status: "active",
              objective: "Leads",
              dailyBudgetUsd: 75,
              spendMonthToDateUsd: 320,
              updatedAt: "2026-04-06T10:00:00.000Z",
              writeEnabled: true,
            },
          ]),
          invokeCampaignAction: vi.fn(async () => ({ ok: true })),
        }) as never
    );
    assertProviderSpendAllowedMock.mockResolvedValue(undefined);
  });

  it("lists configured campaigns and provider readiness", async () => {
    const response = await listCampaigns(
      new Request("http://localhost/api/ad-ops/campaigns", { method: "GET" }) as never,
      routeContext() as never
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.ready).toBe(true);
    expect(data.providers).toHaveLength(2);
    expect(data.campaigns).toHaveLength(1);
  });

  it("rejects resume without an approval reference", async () => {
    const response = await campaignAction(
      new Request("http://localhost/api/ad-ops/campaigns/cmp_1/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          providerId: "meta_ads",
          action: "resume",
          evidenceRef: "mission-control:/dashboard/operations#ad-ops",
        }),
      }) as never,
      routeContext({ campaignId: "cmp_1" }) as never
    );
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(String(data.error)).toContain("approvalRef");
  });

  it("blocks resume when the budget governor hard-stops the provider", async () => {
    assertProviderSpendAllowedMock.mockRejectedValueOnce(
      new ApiError(423, "Budget governor blocked meta_ads after reaching the provider hard limit.")
    );

    const response = await campaignAction(
      new Request("http://localhost/api/ad-ops/campaigns/cmp_1/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          providerId: "meta_ads",
          action: "resume",
          approvalRef: "approval-123",
          evidenceRef: "mission-control:/dashboard/operations#ad-ops",
        }),
      }) as never,
      routeContext({ campaignId: "cmp_1" }) as never
    );
    const data = await response.json();

    expect(response.status).toBe(423);
    expect(String(data.error)).toContain("Budget governor blocked meta_ads");
  });

  it("proxies pause actions through the ad-ops client", async () => {
    const response = await campaignAction(
      new Request("http://localhost/api/ad-ops/campaigns/cmp_1/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          providerId: "meta_ads",
          action: "pause",
          evidenceRef: "mission-control:/dashboard/operations#ad-ops",
          note: "pause for creative refresh",
        }),
      }) as never,
      routeContext({ campaignId: "cmp_1" }) as never
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.proxied).toBe(true);
    expect(data.action).toBe("pause");
  });
});
