import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  normalizePaperclipCustomers,
  normalizePaperclipTimeline,
  updateProjectedCustomerStage,
  upsertProjectedCustomer,
} from "@/lib/crm/customer-memory";
import { getAdminDb } from "@/lib/firebase-admin";

vi.mock("@/lib/firebase-admin", () => ({
  getAdminDb: vi.fn(),
}));

const getAdminDbMock = vi.mocked(getAdminDb);

function mockProjectedCustomerDb(ownerUid: string | null, exists = true) {
  const transactionSet = vi.fn();
  const activityAdd = vi.fn(async () => ({ id: "activity-1" }));
  const leadSet = vi.fn(async () => undefined);
  const leadRef = { id: "cust_1", set: leadSet };
  const snapshot = {
    exists,
    data: () => (exists ? { userId: ownerUid } : undefined),
  };
  const db = {
    collection: vi.fn((name: string) => {
      if (name === "leads") {
        return {
          doc: vi.fn(() => leadRef),
        };
      }
      if (name === "activities") {
        return {
          add: activityAdd,
        };
      }
      throw new Error(`unexpected collection: ${name}`);
    }),
    runTransaction: vi.fn(async (executor: (tx: unknown) => Promise<unknown>) =>
      executor({
        get: vi.fn(async () => snapshot),
        set: transactionSet,
      })
    ),
  };
  getAdminDbMock.mockReturnValue(db as unknown as ReturnType<typeof getAdminDb>);
  return { activityAdd, transactionSet };
}

describe("customer-memory normalization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("normalizes Paperclip customers into the CRM shape", () => {
    const customers = normalizePaperclipCustomers({
      items: [
        {
          id: "cust_2",
          companyName: "Beta HVAC",
          contactName: "Ben",
          email: "ben@beta.example",
          phone: "+15550002",
          businessUnit: "rt_solutions",
          offerCode: "RTS-OPS",
          pipelineStage: "proposal",
          timelineCount: 2,
          updatedAt: "2026-04-05T09:00:00.000Z",
        },
        {
          customerId: "cust_1",
          company: "Alpha Dental",
          founderName: "Alice",
          primaryEmail: "alice@alpha.example",
          businessUnit: "ai_cofoundry",
          status: "booking",
          recentTimelineEvents: 4,
          channels: ["email", "calendar"],
          createdAt: "2026-04-06T08:00:00.000Z",
        },
      ],
    });

    expect(customers).toHaveLength(2);
    expect(customers[0]).toMatchObject({
      customerId: "cust_1",
      companyName: "Alpha Dental",
      contactName: "Alice",
      businessUnit: "ai_cofoundry",
      pipelineStage: "booking",
      sourceOfTruth: "paperclip",
    });
    expect(customers[0]?.channels).toContain("calendar");
    expect(customers[1]).toMatchObject({
      customerId: "cust_2",
      companyName: "Beta HVAC",
      phone: "+15550002",
      offerCode: "RTS-OPS",
      timelineCount: 2,
    });
  });

  it("normalizes Paperclip timeline events and sorts newest first", () => {
    const events = normalizePaperclipTimeline("cust_1", {
      events: [
        {
          id: "evt_older",
          type: "email.sent",
          summary: "Sent intro email",
          occurredAt: "2026-04-05T10:00:00.000Z",
        },
        {
          id: "evt_newer",
          action: "calendar.booked",
          title: "Booked discovery call",
          channel: "calendar",
          createdAt: "2026-04-06T11:30:00.000Z",
        },
      ],
    });

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      eventId: "evt_newer",
      customerId: "cust_1",
      channel: "calendar",
      summary: "Booked discovery call",
      sourceOfTruth: "paperclip",
    });
    expect(events[1]).toMatchObject({
      eventId: "evt_older",
      channel: "email",
      summary: "Sent intro email",
    });
  });

  it("rejects a projected customer upsert owned by another uid", async () => {
    const { activityAdd, transactionSet } = mockProjectedCustomerDb("user-2");

    await expect(
      upsertProjectedCustomer("user-1", {
        customerId: "cust_1",
        companyName: "Foreign Customer",
        businessUnit: "rt_solutions",
        offerCode: "RTS-AI-LUNCH-LEARN",
        pipelineStage: "proposal",
      })
    ).rejects.toMatchObject({ status: 403 });

    expect(transactionSet).not.toHaveBeenCalled();
    expect(activityAdd).not.toHaveBeenCalled();
  });

  it("rejects a projected stage update owned by another uid", async () => {
    const { activityAdd, transactionSet } = mockProjectedCustomerDb("user-2");

    await expect(
      updateProjectedCustomerStage("user-1", "cust_1", "proposal")
    ).rejects.toMatchObject({ status: 403 });

    expect(transactionSet).not.toHaveBeenCalled();
    expect(activityAdd).not.toHaveBeenCalled();
  });

  it("rejects claiming an existing projected customer with no owner", async () => {
    const { activityAdd, transactionSet } = mockProjectedCustomerDb(null);

    await expect(
      upsertProjectedCustomer("user-1", {
        customerId: "cust_1",
        companyName: "Unowned Customer",
      })
    ).rejects.toMatchObject({ status: 409 });

    expect(transactionSet).not.toHaveBeenCalled();
    expect(activityAdd).not.toHaveBeenCalled();
  });

  it("preserves same-owner projected upserts", async () => {
    const { activityAdd, transactionSet } = mockProjectedCustomerDb("user-1");

    const customer = await upsertProjectedCustomer("user-1", {
      customerId: "cust_1",
      companyName: "Owned Customer",
      businessUnit: "rt_solutions",
      offerCode: "RTS-AI-LUNCH-LEARN",
      pipelineStage: "proposal",
    });

    expect(customer).toMatchObject({
      customerId: "cust_1",
      businessUnit: "rt_solutions",
      offerCode: "RTS-AI-LUNCH-LEARN",
      pipelineStage: "proposal",
    });
    expect(transactionSet).toHaveBeenCalledOnce();
    expect(transactionSet.mock.calls[0]?.[2]).toEqual({ merge: true });
    expect(activityAdd).toHaveBeenCalledOnce();
  });
});
