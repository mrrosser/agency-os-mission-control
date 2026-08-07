import { describe, expect, it } from "vitest";
import {
  DAILY_OUTCOME_ORGANIZATIONS,
  buildDailyOutcomeId,
  evaluateDailyOutcome,
  localDateKey,
  mergeDailyOutcomeForPersistence,
  toPublicDailyOutcome,
} from "@/lib/revenue/daily-outcome";

const rosser = DAILY_OUTCOME_ORGANIZATIONS[0];
const rt = DAILY_OUTCOME_ORGANIZATIONS[1];
const asOf = new Date("2026-08-07T17:00:00.000Z"); // noon America/Chicago

function currentSourceReceipt(observedAt = "2026-08-07T16:55:00.000Z") {
  return {
    receiptId: "source-receipt-1",
    sourceKind: "official_web",
    sourceName: "Official opportunity page",
    official: true,
    observedAt,
    contentHash: `sha256:${"a".repeat(64)}`,
    freshness: {
      status: "fresh",
      checkedAt: observedAt,
      validUntil: "2026-08-08T17:00:00.000Z",
      reason: null,
    },
  };
}

function readyOpportunity(overrides: Record<string, unknown> = {}) {
  return {
    id: "opp-1",
    workspaceId: rosser.workspaceId,
    businessIdentityId: rosser.businessIdentityId,
    recordType: "opportunity",
    workflowStatus: "ready",
    applicationReady: true,
    executionPolicy: "auto_run",
    profileEvidenceHash: `sha256:${"b".repeat(64)}`,
    title: "Public art commission",
    officialUrl: "https://example.org/open-call",
    deadline: "2026-08-21",
    fitScore: 91,
    requirementsVerified: true,
    missingRequirementKeys: [],
    exclusions: [],
    requirements: [{ key: "portfolio", required: true, satisfied: true }],
    sources: [currentSourceReceipt()],
    updatedAt: "2026-08-07T16:55:00.000Z",
    ...overrides,
  };
}

function confirmedMeeting(overrides: Record<string, unknown> = {}) {
  return {
    id: "meeting-1",
    workspaceId: rosser.workspaceId,
    businessIdentityId: rosser.businessIdentityId,
    recordType: "event",
    eventKind: "meeting",
    title: "Private title must not leave the server",
    startsAt: "2026-08-08T17:00:00.000Z",
    providerCreatedAt: "2026-08-07T16:30:00.000Z",
    providerEventId: "provider-private-id",
    providerStatus: "confirmed",
    externalAttendeeCount: 1,
    sources: [
      {
        ...currentSourceReceipt("2026-08-07T16:31:00.000Z"),
        receiptId: "calendar-source-receipt",
        sourceKind: "google_calendar",
      },
    ],
    updatedAt: "2026-08-07T16:31:00.000Z",
    ...overrides,
  };
}

describe("daily revenue outcome proof", () => {
  it("uses deterministic organization-local IDs and handles local dates across UTC", () => {
    expect(localDateKey(new Date("2026-08-08T02:00:00.000Z"), "America/Chicago")).toBe(
      "2026-08-07"
    );
    const first = buildDailyOutcomeId({
      workspaceId: rosser.workspaceId,
      businessUnit: rosser.businessUnit,
      localDate: "2026-08-07",
    });
    const replay = buildDailyOutcomeId({
      workspaceId: rosser.workspaceId,
      businessUnit: rosser.businessUnit,
      localDate: "2026-08-07",
    });
    const nextDay = buildDailyOutcomeId({
      workspaceId: rosser.workspaceId,
      businessUnit: rosser.businessUnit,
      localDate: "2026-08-08",
    });
    expect(first).toBe(replay);
    expect(first).not.toBe(nextDay);
  });

  it("counts a receipt-backed, complete, open opportunity but not discovery alone", () => {
    const result = evaluateDailyOutcome({
      organization: rosser,
      asOf,
      canonicalRecords: [readyOpportunity()],
    });
    expect(result.status).toBe("met");
    expect(result.winningKind).toBe("application_ready");
    expect(result.counts.applicationReady).toBe(1);

    const discoveryOnly = evaluateDailyOutcome({
      organization: rosser,
      asOf,
      artistOpportunities: [
        readyOpportunity({
          workflowStatus: undefined,
          applicationReady: false,
          highSignalState: "working",
        }),
      ],
    });
    expect(discoveryOnly.status).toBe("at_risk");
    expect(discoveryOnly.counts.applicationReady).toBe(0);
    expect(discoveryOnly.rejectionReasonCodes).toContain("workflow_not_ready");
  });

  it.each([
    ["expired", { deadline: "2026-08-06" }, "deadline_expired"],
    ["unknown deadline", { deadline: null }, "deadline_unknown"],
    ["missing requirement", { missingRequirementKeys: ["portfolio"] }, "missing_requirements"],
    ["unverified requirements", { requirementsVerified: false }, "requirements_unverified"],
    ["legacy workflow-only readiness", { applicationReady: false }, "workflow_not_ready"],
    ["review-required policy", { executionPolicy: "review_required" }, "workflow_not_ready"],
    ["missing profile evidence", { profileEvidenceHash: null }, "profile_evidence_missing_or_stale"],
    ["exclusion", { exclusions: ["student_only"] }, "has_exclusions"],
    ["low fit", { fitScore: 79 }, "fit_below_threshold"],
    ["missing URL", { officialUrl: null }, "missing_public_url"],
    [
      "non-official source",
      { sources: [{ ...currentSourceReceipt(), official: false }] },
      "source_receipt_missing_or_stale",
    ],
    ["stale receipt", { sources: [currentSourceReceipt("2026-08-05T01:00:00.000Z")] }, "source_receipt_missing_or_stale"],
  ])("fails closed for %s", (_label, overrides, reasonCode) => {
    const result = evaluateDailyOutcome({
      organization: rosser,
      asOf,
      canonicalRecords: [readyOpportunity(overrides)],
    });
    expect(result.counts.applicationReady).toBe(0);
    expect(result.rejectionReasonCodes).toContain(reasonCode);
  });

  it("allows an explicitly rolling opportunity and requires paid RT evidence", () => {
    const rtBase = readyOpportunity({
      workspaceId: rt.workspaceId,
      businessIdentityId: rt.businessIdentityId,
      id: "rt-paid-1",
      deadline: null,
      deadlineStatus: "rolling",
      title: "Paid AI workshop",
    });
    const unpaid = evaluateDailyOutcome({
      organization: rt,
      asOf,
      canonicalRecords: [rtBase],
    });
    expect(unpaid.counts.applicationReady).toBe(0);
    expect(unpaid.rejectionReasonCodes).toContain("paid_signal_missing");

    const paid = evaluateDailyOutcome({
      organization: rt,
      asOf,
      canonicalRecords: [{ ...rtBase, tags: ["paid_signal"] }],
    });
    expect(paid.status).toBe("met");
    expect(paid.counts.applicationReady).toBe(1);
  });

  it("counts only a real, confirmed, future provider meeting booked today", () => {
    const result = evaluateDailyOutcome({
      organization: rosser,
      asOf,
      canonicalRecords: [confirmedMeeting()],
    });
    expect(result.status).toBe("met");
    expect(result.winningKind).toBe("meeting_booked");

    const bookingLinkOnly = evaluateDailyOutcome({
      organization: rosser,
      asOf,
      canonicalRecords: [
        confirmedMeeting({
          providerEventId: null,
          providerStatus: "pending",
          externalAttendeeCount: 0,
          officialUrl: "https://cal.example.org/book",
        }),
      ],
    });
    expect(bookingLinkOnly.counts.verifiedMeetings).toBe(0);
    expect(bookingLinkOnly.rejectionReasonCodes).toContain("provider_event_missing");
    expect(bookingLinkOnly.rejectionReasonCodes).toContain("booking_not_confirmed");
    expect(bookingLinkOnly.rejectionReasonCodes).toContain("external_attendee_missing");
  });

  it("distinguishes at-risk, missed, and not-observed without false green", () => {
    const incomplete = readyOpportunity({ missingRequirementKeys: ["artist_statement"] });
    const beforeCutoff = evaluateDailyOutcome({
      organization: rosser,
      asOf,
      canonicalRecords: [incomplete],
    });
    const afterCutoff = evaluateDailyOutcome({
      organization: rosser,
      asOf: new Date("2026-08-08T02:00:00.000Z"), // 21:00 local
      canonicalRecords: [
        { ...incomplete, updatedAt: "2026-08-08T01:55:00.000Z", sources: [currentSourceReceipt("2026-08-08T01:55:00.000Z")] },
      ],
    });
    const noObservation = evaluateDailyOutcome({ organization: rt, asOf });

    expect(beforeCutoff.status).toBe("at_risk");
    expect(afterCutoff.status).toBe("missed");
    expect(noObservation.status).toBe("not_observed");
  });

  it("preserves a verified daily win while exposing a later source outage", () => {
    const met = evaluateDailyOutcome({
      organization: rosser,
      asOf,
      canonicalRecords: [readyOpportunity()],
    });
    const degraded = evaluateDailyOutcome({
      organization: rosser,
      asOf: new Date("2026-08-07T18:00:00.000Z"),
      unavailableSourceCodes: ["mission_control_records_unavailable"],
    });

    const merged = mergeDailyOutcomeForPersistence(met, degraded);

    expect(merged.status).toBe("met");
    expect(merged.winningKind).toBe("application_ready");
    expect(merged.evidence).toEqual(met.evidence);
    expect(merged.sourceHealth.status).toBe("unavailable");
    expect(merged.alert).toMatchObject({ active: true, severity: "warning" });
    expect(merged.rejectionReasonCodes).toContain("latest_evaluation_not_observed");
  });

  it("reports any critical source read failure even when another source has current proof", () => {
    const partial = evaluateDailyOutcome({
      organization: rosser,
      asOf,
      canonicalRecords: [readyOpportunity()],
      unavailableSourceCodes: ["mission_control_execution_receipts_unavailable"],
    });

    expect(partial.status).toBe("met");
    expect(partial.sourceHealth).toMatchObject({
      status: "unavailable",
      reasonCodes: ["mission_control_execution_receipts_unavailable"],
    });
    expect(partial.alert).toMatchObject({ active: true, severity: "urgent" });
  });

  it("does not preserve an unvalidated or cross-outcome stored met marker", () => {
    const incoming = evaluateDailyOutcome({ organization: rosser, asOf });
    const forged = {
      ...incoming,
      status: "met",
      winningKind: "application_ready",
      evidence: [{ receiptId: "forged" }],
    };

    expect(mergeDailyOutcomeForPersistence(forged, incoming)).toEqual(incoming);
    expect(
      mergeDailyOutcomeForPersistence(
        { ...forged, outcomeId: "another-outcome" },
        incoming
      )
    ).toEqual(incoming);
  });

  it("removes internal workspace/entity/provider identifiers from the public projection", () => {
    const internal = evaluateDailyOutcome({
      organization: rosser,
      asOf,
      canonicalRecords: [confirmedMeeting()],
    });
    const publicResult = toPublicDailyOutcome(internal);
    const serialized = JSON.stringify(publicResult);
    expect(serialized).not.toContain(rosser.workspaceId);
    expect(serialized).not.toContain("meeting-1");
    expect(serialized).not.toContain("provider-private-id");
    expect(publicResult.evidence[0]?.title).toBe("Confirmed meeting");
  });
});
