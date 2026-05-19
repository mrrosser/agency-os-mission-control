import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET as listCustomers, POST as upsertCustomer } from "@/app/api/crm/customers/route";
import { PATCH as updateCustomerStage } from "@/app/api/crm/customers/[customerId]/route";
import { GET as getTimeline } from "@/app/api/crm/customers/[customerId]/timeline/route";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { withIdempotency } from "@/lib/api/idempotency";
import {
  getProjectedCustomerTimeline,
  listProjectedCustomers,
  normalizePaperclipCustomers,
  updateProjectedCustomerStage,
} from "@/lib/crm/customer-memory";
import { PaperclipClient, readPaperclipClientConfig } from "@/lib/paperclip/client";

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

vi.mock("@/lib/crm/customer-memory", () => ({
  listProjectedCustomers: vi.fn(),
  getProjectedCustomerTimeline: vi.fn(),
  upsertProjectedCustomer: vi.fn(),
  updateProjectedCustomerStage: vi.fn(),
  normalizePaperclipCustomers: vi.fn(),
  normalizePaperclipTimeline: vi.fn(),
}));

vi.mock("@/lib/paperclip/client", () => ({
  readPaperclipClientConfig: vi.fn(),
  PaperclipClient: vi.fn(),
}));

const requireAuthMock = vi.mocked(requireFirebaseAuth);
const withIdempotencyMock = vi.mocked(withIdempotency);
const listProjectedCustomersMock = vi.mocked(listProjectedCustomers);
const getProjectedCustomerTimelineMock = vi.mocked(getProjectedCustomerTimeline);
const updateProjectedCustomerStageMock = vi.mocked(updateProjectedCustomerStage);
const normalizePaperclipCustomersMock = vi.mocked(normalizePaperclipCustomers);
const readPaperclipClientConfigMock = vi.mocked(readPaperclipClientConfig);
const PaperclipClientMock = vi.mocked(PaperclipClient);

function routeContext(params: Record<string, string> = {}) {
  return { params: Promise.resolve(params) };
}

describe("crm customer routes", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    requireAuthMock.mockResolvedValue({ uid: "user-1" } as never);
    withIdempotencyMock.mockImplementation(async (_params, executor: () => Promise<unknown>) => ({
      data: await executor(),
      replayed: false,
    }));
    readPaperclipClientConfigMock.mockReturnValue(null);
    PaperclipClientMock.mockImplementation(
      () =>
        ({
          listCustomers: vi.fn(async () => ({ items: [] })),
          getCustomerTimeline: vi.fn(async () => ({ events: [] })),
          upsertCustomer: vi.fn(async () => ({ items: [] })),
        }) as never
    );
  });

  it("lists projected customers when Paperclip is not configured", async () => {
    listProjectedCustomersMock.mockResolvedValue([
      {
        customerId: "cust_1",
        companyName: "Alpha Dental",
        contactName: "Alice",
        email: "alice@alpha.example",
        phone: null,
        sourceLabel: "manual",
        businessUnit: "ai_cofoundry",
        offerCode: "AICF-DISCOVERY",
        pipelineStage: "lead_capture",
        channels: ["email", "system"],
        lastTimelineAt: "2026-04-06T09:00:00.000Z",
        timelineCount: 1,
        duplicateProtection: true,
        dncProtection: true,
        sourceOfTruth: "firestore_projected",
      },
    ]);

    const response = await listCustomers(
      new Request("http://localhost/api/crm/customers", { method: "GET" }) as never,
      routeContext() as never
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.sourceOfTruth).toBe("firestore_projected");
    expect(data.customers).toHaveLength(1);
  });

  it("upserts through Paperclip when configured", async () => {
    readPaperclipClientConfigMock.mockReturnValue({
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
    });
    PaperclipClientMock.mockImplementation(
      () =>
        ({
          upsertCustomer: vi.fn(async () => ({
            items: [{ customerId: "cust_1", companyName: "Alpha Dental" }],
          })),
        }) as never
    );
    normalizePaperclipCustomersMock.mockReturnValue([
      {
        customerId: "cust_1",
        companyName: "Alpha Dental",
        contactName: "Alice",
        email: "alice@alpha.example",
        phone: null,
        sourceLabel: "manual",
        businessUnit: "ai_cofoundry",
        offerCode: "AICF-DISCOVERY",
        pipelineStage: "lead_capture",
        channels: ["email", "system"],
        lastTimelineAt: null,
        timelineCount: 1,
        duplicateProtection: true,
        dncProtection: true,
        sourceOfTruth: "paperclip",
      },
    ]);

    const response = await upsertCustomer(
      new Request("http://localhost/api/crm/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyName: "Alpha Dental", contactName: "Alice" }),
      }) as never,
      routeContext() as never
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.sourceOfTruth).toBe("paperclip");
    expect(data.customer.companyName).toBe("Alpha Dental");
  });

  it("returns projected customer timeline when Paperclip is unavailable", async () => {
    getProjectedCustomerTimelineMock.mockResolvedValue([
      {
        eventId: "evt_1",
        customerId: "cust_1",
        type: "crm.created",
        channel: "system",
        summary: "Customer record created in Mission Control CRM.",
        detail: null,
        occurredAt: "2026-04-06T09:00:00.000Z",
        sourceOfTruth: "firestore_projected",
      },
    ]);

    const response = await getTimeline(
      new Request("http://localhost/api/crm/customers/cust_1/timeline", { method: "GET" }) as never,
      routeContext({ customerId: "cust_1" }) as never
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.sourceOfTruth).toBe("firestore_projected");
    expect(data.events).toHaveLength(1);
  });

  it("updates projected customer stage when Paperclip is unavailable", async () => {
    updateProjectedCustomerStageMock.mockResolvedValue({
      eventId: "evt_stage",
      customerId: "cust_1",
      type: "crm.stage",
      channel: "system",
      summary: "Pipeline stage changed to proposal.",
      detail: "proposal",
      occurredAt: "2026-04-06T09:30:00.000Z",
      sourceOfTruth: "firestore_projected",
    });

    const response = await updateCustomerStage(
      new Request("http://localhost/api/crm/customers/cust_1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pipelineStage: "proposal" }),
      }) as never,
      routeContext({ customerId: "cust_1" }) as never
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.sourceOfTruth).toBe("firestore_projected");
    expect(data.event.summary).toContain("proposal");
  });
});
