import { describe, expect, it } from "vitest";
import {
  normalizePaperclipCustomers,
  normalizePaperclipTimeline,
} from "@/lib/crm/customer-memory";

describe("customer-memory normalization", () => {
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
});
