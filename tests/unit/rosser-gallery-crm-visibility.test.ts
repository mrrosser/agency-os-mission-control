import { beforeEach, describe, expect, it, vi } from "vitest";
import { getAdminDb } from "@/lib/firebase-admin";
import {
  getProjectedCustomerTimeline,
  listProjectedCustomers,
} from "@/lib/crm/customer-memory";

vi.mock("@/lib/firebase-admin", () => ({
  getAdminDb: vi.fn(),
}));

const getAdminDbMock = vi.mocked(getAdminDb);
const log = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

function queryResult(docs: Array<{ id: string; data: Record<string, unknown> }>) {
  return {
    limit: () => ({
      get: async () => ({
        docs: docs.map((document) => ({
          id: document.id,
          data: () => structuredClone(document.data),
        })),
      }),
    }),
  };
}

describe("Rosser Gallery projected CRM visibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("surfaces the latest Gallery context and receiver-maintained timeline count", async () => {
    const customerId = "legacy-customer";
    getAdminDbMock.mockReturnValue({
      collection: (name: string) => {
        if (name === "leads") {
          return {
            where: () =>
              queryResult([
                {
                  id: customerId,
                  data: {
                    userId: "owner-uid",
                    companyName: "Existing Company",
                    founderName: "Original Founder",
                    contactName: "Current Collector",
                    latestContactName: "Current Collector",
                    businessUnit: "rt_solutions",
                    offerCode: "RTS-QUICK-WEBSITE-SPRINT",
                    latestBusinessUnit: "rosser_nft_gallery",
                    latestOfferCode: "RNG-COMMISSION-SCULPTURE",
                    latestSource: "Rosser Gallery collector request",
                    timelineCount: 4,
                    latestTimelineAt: "2026-07-25T15:45:00.000Z",
                  },
                },
              ]),
          };
        }
        return { where: () => queryResult([]) };
      },
    } as never);

    const customers = await listProjectedCustomers("owner-uid", log as never, 100);

    expect(customers).toHaveLength(1);
    expect(customers[0]).toMatchObject({
      customerId,
      contactName: "Current Collector",
      businessUnit: "rosser_nft_gallery",
      offerCode: "RNG-COMMISSION-SCULPTURE",
      sourceLabel: "Rosser Gallery collector request",
      timelineCount: 4,
      lastTimelineAt: "2026-07-25T15:45:00.000Z",
    });
  });

  it("keeps both city-lane projections visible in the shared owner workspace", async () => {
    const ownerQueries: Array<{ collection: string; field: string; value: unknown }> = [];
    const cityCustomers = [
      {
        id: "dmv-customer",
        data: {
          userId: "owner-uid",
          companyName: "DMV Collector",
          latestContactName: "DMV Collector",
          latestBusinessUnit: "rosser_nft_gallery",
          latestOfferCode: "RNG-COLLECTOR-PREVIEW",
          latestSource: "Rosser Gallery collector request",
          tags: [
            "gallery_collector",
            "gallery_the_braider",
            "gallery_market_dmv",
          ],
          lastInquiryAt: "2026-07-25T15:30:00.000Z",
        },
      },
      {
        id: "houston-customer",
        data: {
          userId: "owner-uid",
          companyName: "Houston Collector",
          latestContactName: "Houston Collector",
          latestBusinessUnit: "rosser_nft_gallery",
          latestOfferCode: "RNG-COLLECTOR-PREVIEW",
          latestSource: "Rosser Gallery collector request",
          tags: [
            "gallery_collector",
            "gallery_the_braider",
            "gallery_market_houston",
          ],
          lastInquiryAt: "2026-07-25T15:31:00.000Z",
        },
      },
    ];
    getAdminDbMock.mockReturnValue({
      collection: (name: string) => ({
        where: (field: string, _operator: string, value: unknown) => {
          ownerQueries.push({ collection: name, field, value });
          return queryResult(name === "leads" ? cityCustomers : []);
        },
      }),
    } as never);

    const customers = await listProjectedCustomers("owner-uid", log as never, 100);

    expect(ownerQueries).toEqual([
      { collection: "leads", field: "userId", value: "owner-uid" },
      { collection: "activities", field: "userId", value: "owner-uid" },
    ]);
    expect(customers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          customerId: "dmv-customer",
          businessUnit: "rosser_nft_gallery",
          sourceLabel: "Rosser Gallery collector request",
        }),
        expect.objectContaining({
          customerId: "houston-customer",
          businessUnit: "rosser_nft_gallery",
          sourceLabel: "Rosser Gallery collector request",
        }),
      ])
    );
  });

  it("queries the selected customer directly so its collector inquiry remains visible", async () => {
    const customerId = "rng-customer";
    let activityQuery: { field: string; value: unknown } | null = null;
    getAdminDbMock.mockReturnValue({
      collection: (name: string) => {
        if (name === "leads") {
          return {
            doc: () => ({
              get: async () => ({
                exists: true,
                data: () => ({
                  userId: "owner-uid",
                  pipelineStage: "lead_capture",
                  createdAt: "2026-07-25T15:30:00.000Z",
                }),
              }),
            }),
          };
        }
        return {
          where: (field: string, _operator: string, value: unknown) => {
            activityQuery = { field, value };
            return queryResult([
              {
                id: "rng-activity",
                data: {
                  userId: "owner-uid",
                  customerId,
                  action: "crm.collector_inquiry_received",
                  type: "system",
                  summary: "Collector request received for The Braider.",
                  timestamp: "2026-07-25T15:30:00.000Z",
                },
              },
              {
                id: "foreign-activity",
                data: {
                  userId: "foreign-owner",
                  customerId,
                  action: "crm.foreign_activity",
                  type: "system",
                  summary: "Must not cross the tenant boundary.",
                  timestamp: "2026-07-25T15:31:00.000Z",
                },
              },
            ]);
          },
        };
      },
    } as never);

    const events = await getProjectedCustomerTimeline(
      "owner-uid",
      customerId,
      log as never
    );

    expect(activityQuery).toEqual({ field: "customerId", value: customerId });
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventId: "rng-activity",
          customerId,
          type: "crm.collector_inquiry_received",
        }),
      ])
    );
    expect(events.some((event) => event.eventId === "foreign-activity")).toBe(false);
  });
});
