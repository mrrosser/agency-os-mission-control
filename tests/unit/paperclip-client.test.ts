import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PaperclipClient,
  PaperclipClientError,
  readPaperclipClientConfig,
} from "@/lib/paperclip/client";

const log = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
} as const;

const ORIGINAL_ENV = {
  PAPERCLIP_API_BASE_URL: process.env.PAPERCLIP_API_BASE_URL,
  PAPERCLIP_SERVICE_TOKEN: process.env.PAPERCLIP_SERVICE_TOKEN,
  PAPERCLIP_DEFAULT_COMPANY_ID: process.env.PAPERCLIP_DEFAULT_COMPANY_ID,
  PAPERCLIP_CUSTOMER_RECORDS_PATH: process.env.PAPERCLIP_CUSTOMER_RECORDS_PATH,
  PAPERCLIP_CUSTOMER_TIMELINE_PATH_TEMPLATE: process.env.PAPERCLIP_CUSTOMER_TIMELINE_PATH_TEMPLATE,
  PAPERCLIP_CUSTOMER_UPDATE_PATH_TEMPLATE: process.env.PAPERCLIP_CUSTOMER_UPDATE_PATH_TEMPLATE,
};

afterEach(() => {
  vi.restoreAllMocks();
  process.env.PAPERCLIP_API_BASE_URL = ORIGINAL_ENV.PAPERCLIP_API_BASE_URL;
  process.env.PAPERCLIP_SERVICE_TOKEN = ORIGINAL_ENV.PAPERCLIP_SERVICE_TOKEN;
  process.env.PAPERCLIP_DEFAULT_COMPANY_ID = ORIGINAL_ENV.PAPERCLIP_DEFAULT_COMPANY_ID;
  process.env.PAPERCLIP_CUSTOMER_RECORDS_PATH = ORIGINAL_ENV.PAPERCLIP_CUSTOMER_RECORDS_PATH;
  process.env.PAPERCLIP_CUSTOMER_TIMELINE_PATH_TEMPLATE =
    ORIGINAL_ENV.PAPERCLIP_CUSTOMER_TIMELINE_PATH_TEMPLATE;
  process.env.PAPERCLIP_CUSTOMER_UPDATE_PATH_TEMPLATE =
    ORIGINAL_ENV.PAPERCLIP_CUSTOMER_UPDATE_PATH_TEMPLATE;
});

describe("PaperclipClient", () => {
  it("reads config from env", () => {
    process.env.PAPERCLIP_API_BASE_URL = "https://paperclip.example/system";
    process.env.PAPERCLIP_SERVICE_TOKEN = "secret";
    process.env.PAPERCLIP_DEFAULT_COMPANY_ID = "company-1";

    const config = readPaperclipClientConfig();

    expect(config?.baseUrl).toBe("https://paperclip.example/system");
    expect(config?.serviceToken).toBe("secret");
    expect(config?.defaultCompanyId).toBe("company-1");
  });

  it("builds an operational control snapshot from health and count endpoints", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/health")) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (url.includes("/api/companies")) {
        return new Response(JSON.stringify({ items: [{ id: "co-1" }, { id: "co-2" }] }), {
          status: 200,
        });
      }
      if (url.includes("/api/agents")) {
        return new Response(JSON.stringify({ items: [{ id: "a-1" }] }), { status: 200 });
      }
      if (url.includes("/api/runs")) {
        return new Response(JSON.stringify({ count: 5 }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });

    const client = new PaperclipClient(
      {
        baseUrl: "https://paperclip.example/system",
        serviceToken: "secret",
        timeoutMs: 1000,
        defaultCompanyId: null,
        healthPath: "/api/health",
        companiesPath: "/api/companies",
        agentsPath: "/api/agents",
        activeRunsPath: "/api/runs?state=active",
        actionPathTemplate: "/api/agents/{agentId}/{action}",
        customerRecordsPath: "/api/customers",
        customerTimelinePathTemplate: "/api/customers/{customerId}/timeline",
        customerUpdatePathTemplate: "/api/customers/{customerId}",
      },
      fetchMock as unknown as typeof fetch
    );

    const snapshot = await client.getControlSnapshot(log as never);

    expect(snapshot.state).toBe("operational");
    expect(snapshot.canProxyActions).toBe(true);
    expect(snapshot.companyCount).toBe(2);
    expect(snapshot.agentCount).toBe(1);
    expect(snapshot.activeRunCount).toBe(5);
  });

  it("throws when invoking lifecycle action without a service token", async () => {
    const client = new PaperclipClient(
      {
        baseUrl: "https://paperclip.example/system",
        serviceToken: null,
        timeoutMs: 1000,
        defaultCompanyId: null,
        healthPath: "/api/health",
        companiesPath: "/api/companies",
        agentsPath: "/api/agents",
        activeRunsPath: "/api/runs?state=active",
        actionPathTemplate: "/api/agents/{agentId}/{action}",
        customerRecordsPath: "/api/customers",
        customerTimelinePathTemplate: "/api/customers/{customerId}/timeline",
        customerUpdatePathTemplate: "/api/customers/{customerId}",
      },
      vi.fn() as unknown as typeof fetch
    );

    await expect(
      client.invokeLifecycleAction({
        agentId: "orchestrator",
        action: "resume",
        correlationId: "cid-1",
        requestedByUid: "user-1",
        evidenceRef: "mission-control:user-1",
        autonomyClass: "internal_write",
      })
    ).rejects.toBeInstanceOf(PaperclipClientError);
  });

  it("adds the default companyId to customer requests", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      expect(url).toContain("companyId=company-1");
      return new Response(JSON.stringify({ customers: [] }), { status: 200 });
    });

    const client = new PaperclipClient(
      {
        baseUrl: "https://paperclip.example/system",
        serviceToken: "secret",
        timeoutMs: 1000,
        defaultCompanyId: "company-1",
        healthPath: "/api/health",
        companiesPath: "/api/companies",
        agentsPath: "/api/agents",
        activeRunsPath: "/api/runs?state=active",
        actionPathTemplate: "/api/agents/{agentId}/{action}",
        customerRecordsPath: "/api/customers",
        customerTimelinePathTemplate: "/api/customers/{customerId}/timeline",
        customerUpdatePathTemplate: "/api/customers/{customerId}",
      },
      fetchMock as unknown as typeof fetch
    );

    await client.listCustomers({
      correlationId: "cid-1",
      requestedByUid: "user-1",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
