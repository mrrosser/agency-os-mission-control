import { describe, expect, it } from "vitest";
import { buildApprovalQueueSnapshot, type ApprovalQueueActionRecord } from "@/lib/lead-runs/approval-queue";

describe("approval queue snapshot", () => {
  it("builds draft and booking queues from receipt actions", () => {
    const actions: ApprovalQueueActionRecord[] = [
      {
        key: "runs/run-1/leads/lead-1/actions/gmail.outreach_draft",
        leadPath: "lead_runs/run-1/leads/lead-1",
        runId: "run-1",
        leadDocId: "lead-1",
        actionId: "gmail.outreach_draft",
        status: "complete",
        updatedAt: "2026-03-09T15:30:00.000Z",
        data: {
          subject: "Quick question for ACME",
          to: ["founder@acme.com"],
          draftId: "draft-123",
          messageId: "msg-123",
          threadId: "thread-123",
        },
      },
      {
        key: "runs/run-2/leads/lead-2/actions/gmail.availability_draft",
        leadPath: "lead_runs/run-2/leads/lead-2",
        runId: "run-2",
        leadDocId: "lead-2",
        actionId: "gmail.availability_draft",
        status: "simulated",
        updatedAt: "2026-03-09T16:00:00.000Z",
        data: {
          subject: "Quick scheduling question",
          to: ["team@beta.com"],
          draftId: "draft-456",
        },
      },
      {
        key: "runs/run-3/leads/lead-3/actions/calendar.booking",
        leadPath: "lead_runs/run-3/leads/lead-3",
        runId: "run-3",
        leadDocId: "lead-3",
        actionId: "calendar.booking",
        status: "complete",
        updatedAt: "2026-03-09T14:00:00.000Z",
        data: {
          summary: "Discovery Call - Gamma",
          scheduledStart: "2026-03-10T17:00:00.000Z",
          scheduledEnd: "2026-03-10T17:30:00.000Z",
          attendees: ["gamma@example.com"],
          eventId: "evt-789",
          htmlLink: "https://calendar.google.com/event?eid=evt-789",
          meetLink: "https://meet.google.com/abc-defg-hij",
        },
      },
      {
        key: "runs/run-4/leads/lead-4/actions/calendar.booking",
        leadPath: "lead_runs/run-4/leads/lead-4",
        runId: "run-4",
        leadDocId: "lead-4",
        actionId: "calendar.booking",
        status: "skipped",
        updatedAt: "2026-03-09T18:00:00.000Z",
        data: {
          reason: "no_slot",
        },
      },
    ];

    const leadByPath = {
      "lead_runs/run-1/leads/lead-1": {
        leadDocId: "lead-1",
        companyName: "ACME",
        founderName: "Ava",
        email: "founder@acme.com",
      },
      "lead_runs/run-2/leads/lead-2": {
        leadDocId: "lead-2",
        companyName: "Beta",
        founderName: "Ben",
        email: "team@beta.com",
      },
      "lead_runs/run-3/leads/lead-3": {
        leadDocId: "lead-3",
        companyName: "Gamma",
        founderName: "Gia",
        email: "gamma@example.com",
      },
    };

    const snapshot = buildApprovalQueueSnapshot(actions, leadByPath, {
      emailLimit: 10,
      calendarLimit: 10,
    });

    expect(snapshot.email).toHaveLength(2);
    expect(snapshot.email[0]).toMatchObject({
      companyName: "Beta",
      queueLabel: "Availability Follow-up",
      draftId: "draft-456",
      status: "simulated",
    });
    expect(snapshot.email[1]).toMatchObject({
      companyName: "ACME",
      queueLabel: "Outreach Draft",
      draftId: "draft-123",
      threadId: "thread-123",
    });

    expect(snapshot.calendar).toHaveLength(1);
    expect(snapshot.calendar[0]).toMatchObject({
      companyName: "Gamma",
      summary: "Discovery Call - Gamma",
      eventId: "evt-789",
      htmlLink: "https://calendar.google.com/event?eid=evt-789",
      meetLink: "https://meet.google.com/abc-defg-hij",
    });
  });
});
