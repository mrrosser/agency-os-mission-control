import { describe, it, expect } from "vitest";
import { flattenRunAuditTimeline, pickAuditIds } from "@/lib/lead-runs/audit";

describe("lead run audit helpers", () => {
  it("flattens actions and sorts by updatedAt desc", () => {
    const events = flattenRunAuditTimeline([
      {
        leadDocId: "lead-1",
        companyName: "Alpha",
        score: 80,
        actions: [
          { actionId: "gmail.send", updatedAt: "2026-02-12T10:00:00.000Z", status: "complete" },
        ],
      },
      {
        leadDocId: "lead-2",
        companyName: "Beta",
        score: 60,
        actions: [
          { actionId: "calendar.schedule", updatedAt: "2026-02-12T11:00:00.000Z", status: "complete" },
        ],
      },
    ]);

    expect(events.map((e) => e.actionId)).toEqual(["calendar.schedule", "gmail.send"]);
    expect(events[0]?.companyName).toBe("Beta");
  });

  it("extracts common external ids for display", () => {
    const ids = pickAuditIds({
      messageId: "m1",
      threadId: "t1",
      eventId: "e1",
      folderId: "f1",
      ignore: 123,
    });
    expect(ids).toEqual(["eventId:e1", "messageId:m1", "threadId:t1", "folderId:f1"]);
  });
});

