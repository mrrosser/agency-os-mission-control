import { describe, expect, it } from "vitest";

const {
  buildTimelineImportPlan,
  detectTimelineChannel,
  normalizeLeadForPaperclip,
} = await import("../../scripts/backfill-paperclip-customers.mjs");

describe("backfill-paperclip-customers helpers", () => {
  it("normalizes Mission Control leads into the Paperclip customer payload", () => {
    const normalized = normalizeLeadForPaperclip("lead_1", {
      userId: "user-1",
      companyName: "Alpha Dental",
      founderName: "Alice",
      email: "alice@alpha.example",
      source: "manual",
      businessUnit: "ai_cofoundry",
      offerCode: "AICF-DISCOVERY",
      pipelineStage: "proposal",
      website: "https://alpha.example",
    });

    expect(normalized).toMatchObject({
      customerId: "lead_1",
      companyName: "Alpha Dental",
      contactName: "Alice",
      email: "alice@alpha.example",
      sourceLabel: "manual",
      businessUnit: "ai_cofoundry",
      offerCode: "AICF-DISCOVERY",
      pipelineStage: "proposal",
    });
    expect(normalized.metadata.sourceLeadId).toBe("lead_1");
  });

  it("maps imported activities to safe timeline channels", () => {
    expect(detectTimelineChannel("gmail.send")).toBe("email");
    expect(detectTimelineChannel("calendar.createMeet")).toBe("calendar");
    expect(detectTimelineChannel("square.payment")).toBe("pos");
    expect(detectTimelineChannel("twilio.call")).toBe("voice");
    expect(detectTimelineChannel("unknown")).toBe("system");
  });

  it("builds replay-safe timeline imports and skips existing external keys", () => {
    const events = buildTimelineImportPlan({
      leadId: "lead_1",
      leadRow: {
        pipelineStage: "proposal",
        source: "manual",
      },
      activities: [
        {
          id: "act_1",
          data: {
            action: "gmail.sent",
            type: "email",
            summary: "Sent intro email",
            details: "First touch",
            timestamp: "2026-04-06T12:00:00.000Z",
          },
        },
        {
          id: "act_2",
          data: {
            action: "calendar.booked",
            type: "calendar",
            summary: "Booked discovery call",
            timestamp: "2026-04-06T13:00:00.000Z",
          },
        },
      ],
      existingExternalKeys: new Set(["mission-control:activity:act_1"]),
    });

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      externalKey: "mission-control:lead:lead_1:snapshot",
      type: "mission_control.lead_snapshot",
      channel: "system",
    });
    expect(events[1]).toMatchObject({
      externalKey: "mission-control:activity:act_2",
      type: "calendar.booked",
      channel: "calendar",
      summary: "Booked discovery call",
    });
  });
});
