import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/agents/control-plane/route";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { getAgentSpaceStatus } from "@/lib/agent-status";
import { getSecretStatus } from "@/lib/api/secrets";
import { getStoredGoogleTokens } from "@/lib/google/oauth";
import {
  getLeadRunQuotaSummary,
  listLeadRunAlerts,
  resolveLeadRunOrgId,
} from "@/lib/lead-runs/quotas";
import { getAdminDb } from "@/lib/firebase-admin";
import { pullProviderBilling } from "@/lib/billing/provider-costs";

vi.mock("@/lib/api/auth", () => ({
  requireFirebaseAuth: vi.fn(),
}));

vi.mock("@/lib/agent-status", () => ({
  getAgentSpaceStatus: vi.fn(async () => ({})),
}));

vi.mock("@/lib/api/secrets", () => ({
  getSecretStatus: vi.fn(async () => ({
    openaiKey: "missing",
    twilioSid: "missing",
    twilioToken: "missing",
    twilioPhoneNumber: "missing",
    elevenLabsKey: "missing",
    heyGenKey: "missing",
    googlePlacesKey: "missing",
    firecrawlKey: "missing",
    googlePickerApiKey: "missing",
  })),
}));

vi.mock("@/lib/google/oauth", () => ({
  getStoredGoogleTokens: vi.fn(async () => ({ scope: "" })),
}));

vi.mock("@/lib/lead-runs/quotas", () => ({
  resolveLeadRunOrgId: vi.fn(async () => "org-1"),
  getLeadRunQuotaSummary: vi.fn(async () => ({
    orgId: "org-1",
    windowKey: "2026-02-16",
    runsUsed: 0,
    leadsUsed: 0,
    activeRuns: 0,
    maxRunsPerDay: 80,
    maxLeadsPerDay: 1200,
    maxActiveRuns: 3,
    runsRemaining: 80,
    leadsRemaining: 1200,
    utilization: { runsPct: 0, leadsPct: 0 },
  })),
  listLeadRunAlerts: vi.fn(async () => []),
}));

vi.mock("@/lib/firebase-admin", () => ({
  getAdminDb: vi.fn(),
}));

vi.mock("@/lib/billing/provider-costs", () => ({
  pullProviderBilling: vi.fn(async () => ({
    capturedAt: "2026-02-16T18:00:00.000Z",
    providers: [
      {
        providerId: "openai",
        label: "OpenAI",
        status: "live",
        monthlyCostUsd: 12.4,
        currency: "USD",
        detail: "Live month-to-date billing pulled from OpenAI.",
        source: "organization.costs",
      },
      {
        providerId: "twilio",
        label: "Twilio",
        status: "live",
        monthlyCostUsd: 4.2,
        currency: "USD",
        detail: "Live month-to-date usage pulled from Twilio.",
        source: "usage.records.this_month",
      },
      {
        providerId: "elevenlabs",
        label: "ElevenLabs",
        status: "live",
        monthlyCostUsd: 7.8,
        currency: "USD",
        detail: "Live invoice amount pulled from ElevenLabs subscription endpoint.",
        source: "user.subscription",
      },
    ],
  })),
}));

const requireAuthMock = vi.mocked(requireFirebaseAuth);
const getAgentSpaceStatusMock = vi.mocked(getAgentSpaceStatus);
const getSecretStatusMock = vi.mocked(getSecretStatus);
const getStoredGoogleTokensMock = vi.mocked(getStoredGoogleTokens);
const resolveOrgMock = vi.mocked(resolveLeadRunOrgId);
const getQuotaMock = vi.mocked(getLeadRunQuotaSummary);
const listAlertsMock = vi.mocked(listLeadRunAlerts);
const getAdminDbMock = vi.mocked(getAdminDb);
const pullProviderBillingMock = vi.mocked(pullProviderBilling);
const ORIGINAL_SMAUTO_MCP_SERVER_URL = process.env.SMAUTO_MCP_SERVER_URL;
const ORIGINAL_LEADOPS_MCP_SERVER_URL = process.env.LEADOPS_MCP_SERVER_URL;

function createContext() {
  return { params: Promise.resolve({}) };
}

describe("agents control-plane route", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    requireAuthMock.mockResolvedValue({ uid: "user-1" } as unknown as Awaited<ReturnType<typeof requireFirebaseAuth>>);
    getAgentSpaceStatusMock.mockResolvedValue({
      "spaces/AAQA62xqRGQ": {
        agentId: "orchestrator",
        updatedAt: "2026-02-16T18:00:00.000Z",
      },
    });
    getSecretStatusMock.mockResolvedValue({
      openaiKey: "secret",
      twilioSid: "secret",
      twilioToken: "secret",
      twilioPhoneNumber: "secret",
      elevenLabsKey: "secret",
      heyGenKey: "missing",
      googlePlacesKey: "missing",
      firecrawlKey: "secret",
      googlePickerApiKey: "missing",
    });
    getStoredGoogleTokensMock.mockResolvedValue({
      scope:
        "https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/drive.readonly",
    } as unknown as Awaited<ReturnType<typeof getStoredGoogleTokens>>);
    resolveOrgMock.mockResolvedValue("org-1");
    getQuotaMock.mockResolvedValue({
      orgId: "org-1",
      windowKey: "2026-02-16",
      runsUsed: 2,
      leadsUsed: 50,
      activeRuns: 1,
      maxRunsPerDay: 80,
      maxLeadsPerDay: 1200,
      maxActiveRuns: 3,
      runsRemaining: 78,
      leadsRemaining: 1150,
      utilization: { runsPct: 3, leadsPct: 4 },
    });
    listAlertsMock.mockResolvedValue([
      {
        alertId: "org-1_run-1",
        orgId: "org-1",
        runId: "run-1",
        uid: "user-1",
        severity: "error",
        title: "Lead run failures exceeded threshold",
        message: "One or more lead runs failed repeatedly.",
        failureStreak: 3,
        status: "open",
        createdAt: "2026-02-16T17:30:00.000Z",
      },
    ]);
    pullProviderBillingMock.mockResolvedValue({
      capturedAt: "2026-02-16T18:00:00.000Z",
      providers: [
        {
          providerId: "openai",
          label: "OpenAI",
          status: "live",
          monthlyCostUsd: 12.4,
          currency: "USD",
          detail: "Live month-to-date billing pulled from OpenAI.",
          source: "organization.costs",
        },
        {
          providerId: "twilio",
          label: "Twilio",
          status: "live",
          monthlyCostUsd: 4.2,
          currency: "USD",
          detail: "Live month-to-date usage pulled from Twilio.",
          source: "usage.records.this_month",
        },
        {
          providerId: "elevenlabs",
          label: "ElevenLabs",
          status: "live",
          monthlyCostUsd: 7.8,
          currency: "USD",
          detail: "Live invoice amount pulled from ElevenLabs subscription endpoint.",
          source: "user.subscription",
        },
      ],
    });
    process.env.SMAUTO_MCP_SERVER_URL = "https://smauto.example/mcp";
    process.env.LEADOPS_MCP_SERVER_URL = "https://leadops.example/mcp";

    getAdminDbMock.mockReturnValue({
      collection: (name: string) => {
        if (name === "identities") {
          return {
            doc: () => ({
              collection: () => ({
                doc: () => ({
                  get: async () => ({
                    exists: true,
                    data: () => ({
                      lastRunAt: "2026-02-15T18:00:00.000Z",
                      lastResultCount: 18,
                    }),
                  }),
                }),
              }),
            }),
          };
        }

        if (name === "telemetry_error_events") {
          return {
            where: () => ({
              limit: () => ({
                get: async () => ({
                  docs: [{ data: () => ({ fingerprint: "fp-1" }) }],
                }),
              }),
            }),
          };
        }

        if (name === "telemetry_error_groups") {
          return {
            doc: () => ({
              get: async () => ({
                exists: true,
                data: () => ({
                  kind: "server",
                  count: 3,
                  lastSeenAt: "2026-02-16T17:55:00.000Z",
                  sample: { message: "Calendar 500", route: "/api/calendar/schedule" },
                  triage: { status: "new", issueUrl: null },
                }),
              }),
            }),
          };
        }

        return {
          doc: () => ({
            get: async () => ({ exists: false, data: () => ({}) }),
          }),
        };
      },
    } as unknown as ReturnType<typeof getAdminDb>);
  });

  afterEach(() => {
    if (typeof ORIGINAL_SMAUTO_MCP_SERVER_URL === "string") {
      process.env.SMAUTO_MCP_SERVER_URL = ORIGINAL_SMAUTO_MCP_SERVER_URL;
    } else {
      delete process.env.SMAUTO_MCP_SERVER_URL;
    }

    if (typeof ORIGINAL_LEADOPS_MCP_SERVER_URL === "string") {
      process.env.LEADOPS_MCP_SERVER_URL = ORIGINAL_LEADOPS_MCP_SERVER_URL;
    } else {
      delete process.env.LEADOPS_MCP_SERVER_URL;
    }
  });

  it("returns control-plane snapshot payload", async () => {
    const request = new Request("http://localhost/api/agents/control-plane", { method: "GET" });
    const response = await GET(
      request as unknown as Parameters<typeof GET>[0],
      createContext() as unknown as Parameters<typeof GET>[1]
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.summary.health).toBeDefined();
    expect(Array.isArray(payload.agents)).toBe(true);
    expect(Array.isArray(payload.services)).toBe(true);
    expect(Array.isArray(payload.skills)).toBe(true);
    expect(Array.isArray(payload.diagnostics.alerts)).toBe(true);
    expect(Array.isArray(payload.diagnostics.bugs)).toBe(true);
    expect(typeof payload.summary.projectedMonthlyCostUsd).toBe("number");
    expect(payload.costModel.method).toBe("live-v1");
    expect(Array.isArray(payload.costModel.providerBilling)).toBe(true);
    expect(payload.services.some((service: { id: string }) => service.id === "square_pos")).toBe(true);
    expect(payload.services.find((service: { id: string; state: string }) => service.id === "smauto_mcp")?.state).toBe("operational");
    expect(payload.services.find((service: { id: string; state: string }) => service.id === "leadops_mcp")?.state).toBe("operational");
  });
});
