import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  assertOwnedWarmReconnectFollowOnLock,
  assertWarmReconnectBatchShape,
  assertWarmReconnectFollowOnContent,
  assertWarmReconnectFollowOnReservation,
  assertWarmReconnectParentCompletion,
  warmReconnectApprovalScopeForPilot,
  warmReconnectFollowOnPilotLockId,
} from "@/lib/crm/warm-reconnect-batches";
import {
  assertWarmReconnectPilotFingerprints,
  computeWarmReconnectPilotFingerprints,
  createWarmReconnectPilot,
  WARM_RECONNECT_EXECUTION_POLICY,
  warmReconnectInitialPilotLockId,
} from "@/lib/crm/warm-reconnect-activation";
import type {
  WarmReconnectCandidate,
  WarmReconnectPilot,
} from "@/lib/crm/warm-reconnect-activation-types";
import { warmReconnectFingerprint } from "@/lib/crm/warm-reconnect-dedupe";
import { warmReconnectInvitationReservationBindingForPilot } from "@/lib/crm/warm-reconnect-invitation-ledger";
import {
  WARM_RECONNECT_CAMPAIGN_ID,
  WARM_RECONNECT_CAMPAIGN_VERSION,
} from "@/lib/crm/warm-reconnect-types";

const START_MS = Date.parse("2026-10-08T12:00:00.000Z");
const CADENCE_MS = 60_000;
const EXCLUDED_SCOPE = [
  "audience_expansion", "provider_draft_create", "sms_send", "phone_call",
  "social_lookup", "social_direct_message", "ambiguous_outcome_retry",
] as const;

function candidate(index: number): WarmReconnectCandidate {
  return {
    recipientId: `recipient-${index}`,
    personId: `person-${index}`,
    contactPointId: `contact-${index}`,
    displayName: `Person ${index}`,
    email: `person${index}@example.com`,
    emailKey: `sha256:${index.toString(16).padStart(64, "0")}`,
    candidateFingerprint: `sha256:${(index + 100).toString(16).padStart(64, "0")}`,
    permissionState: "unknown",
    permissionRemainsExplicit: true,
    sourceEvidence: [{
      evidenceRef: `crm_source_records/source-${index}`,
      sourceSystem: "google_people",
      permissionBasis: "none",
      observedAt: "2026-10-07T12:00:00.000Z",
    }],
    reviewStatus: "requires_operator_attestation",
  };
}

function initialPilot(): WarmReconnectPilot {
  const candidates = [1, 2, 3, 4, 5].map(candidate);
  const pilot = createWarmReconnectPilot({
    pilotId: "pilot-initial",
    workspaceId: "workspace_default_owner-1",
    ownerUid: "owner-1",
    legacyDncOrgId: "workspace_default_owner-1",
    googleReady: true,
    fromEmail: "mrosser@rossergallery.com",
    accountId: "gallery-account-1",
    preferenceOrigin: "https://leadflow-review.web.app",
    now: new Date(START_MS),
    candidates,
    request: {
      idempotencyKey: "initial-test",
      campaignPreviewFingerprint: `sha256:${"a".repeat(64)}`,
      tranche: "initial_5",
      recipientCap: 5,
      candidateRecipientIds: candidates.map((row) => row.recipientId) as [string, string, string, string, string],
      contentMode: "artwork_html",
      artworkEmailApproval: {
        approvedForThisEmailCampaign: true,
        evidenceNote: "Artist approved this artwork for the reviewed email campaign.",
      },
      sender: {
        senderName: "Marcus Rosser",
        legalEntity: "Marcus Rosser / Rosser Gallery",
        businessId: "rosser_nft_gallery",
        profileId: "rosser_gallery_send",
        replyTo: "mrosser@rossergallery.com",
        physicalPostalAddress: "2505 N Tonti St, New Orleans, LA 70117",
      },
    },
  });
  pilot.recipients = pilot.recipients.map((row) => ({
    ...row,
    decision: {
      status: "eligible_one_time_reconnection",
      decisionId: `decision-${row.recipientId}`,
      decidedAt: new Date(START_MS).toISOString(),
      relationshipAttested: true,
      permissionState: "unknown",
      sourceEvidenceRefs: row.sourceEvidence.map((evidence) => evidence.evidenceRef),
      note: "Exact one-time invitation relationship reviewed.",
    },
  }));
  return freezeLaunch(pilot);
}

function freezeLaunch(pilot: WarmReconnectPilot): WarmReconnectPilot {
  pilot.fingerprints = computeWarmReconnectPilotFingerprints(pilot);
  pilot.approval = {
    approvalId: `approval-${pilot.pilotId}`,
    decision: "approved",
    approvedAt: new Date(START_MS).toISOString(),
    expiresAt: new Date(START_MS + 24 * 60 * 60_000).toISOString(),
    note: "Exact audience and message approved.",
    ...pilot.fingerprints,
    approvalScope: warmReconnectApprovalScopeForPilot(pilot),
    excludedScope: EXCLUDED_SCOPE,
  };
  pilot.status = "launch_requested";
  pilot.launchRequestedAt = new Date(START_MS).toISOString();
  pilot.gates = pilot.gates.map((gate) => ({ ...gate, status: "verified" }));
  return pilot;
}

function followOn(parent = initialPilot(), size = 4): WarmReconnectPilot {
  const next = structuredClone(parent);
  next.pilotId = `pilot-follow-${(parent.batchSequence || 0) + 1}`;
  next.tranche = "follow_on";
  next.parentPilotId = parent.pilotId;
  next.batchSequence = (parent.batchSequence || 0) + 1;
  next.recipientCap = size;
  next.followOnNotBeforeMs = START_MS + parent.recipientCap * CADENCE_MS;
  next.recipients = Array.from({ length: size }, (_, index) => {
    const row = candidate(index + 20 * next.batchSequence!);
    return {
      recipientId: row.recipientId,
      personId: row.personId,
      contactPointId: row.contactPointId,
      emailKey: row.emailKey,
      candidateFingerprint: row.candidateFingerprint,
      sourceEvidence: row.sourceEvidence,
      greetingName: "Person",
      decision: {
        ...parent.recipients[0].decision,
        decisionId: `decision-${row.recipientId}`,
        sourceEvidenceRefs: row.sourceEvidence.map((source) => source.evidenceRef),
      },
    } as WarmReconnectPilot["recipients"][number];
  });
  return freezeLaunch(next);
}

function followOnLock(pilot: WarmReconnectPilot) {
  return {
    schemaVersion: "crm.warm-reconnect-follow-on-lock.v1",
    workspaceId: pilot.workspaceId,
    campaignId: WARM_RECONNECT_CAMPAIGN_ID,
    campaignVersion: WARM_RECONNECT_CAMPAIGN_VERSION,
    tranche: "follow_on",
    state: "active",
    pilotId: pilot.pilotId,
    parentPilotId: pilot.parentPilotId,
    batchSequence: pilot.batchSequence,
    recipientCap: pilot.recipientCap,
  };
}

function completionFixture(parent = initialPilot()) {
  const receipts = parent.recipients.map((recipient, index) => {
    const receiptId = `wre_${createHash("sha256")
      .update(`warm-reconnect-delivery:v1|${parent.workspaceId}|${parent.pilotId}|${recipient.recipientId}|${parent.fingerprints.actionFingerprint}`)
      .digest("hex").slice(0, 32)}`;
    const binding = warmReconnectInvitationReservationBindingForPilot(parent, recipient, receiptId);
    return {
      schemaVersion: "crm.warm-reconnect-delivery-receipt.v1",
      ...binding,
      ...parent.fingerprints,
      ownerUid: parent.ownerUid,
      recipientId: recipient.recipientId,
      contactPointId: recipient.contactPointId,
      invitationReservationId: binding.reservationId,
      status: "sent",
      claimedAtMs: START_MS + index * CADENCE_MS,
      providerStartedAtMs: START_MS + index * CADENCE_MS,
      sentAtMs: START_MS + index * CADENCE_MS + 100,
      providerMessageId: `a${index.toString(16).padStart(15, "0")}`,
      providerThreadId: `b${index.toString(16).padStart(15, "0")}`,
      correlationId: "batch-completion-test",
    };
  });
  const ledgers = receipts.map((receipt, index) => ({
    schemaVersion: "crm.warm-reconnect-invitation-ledger.v1",
    ...warmReconnectInvitationReservationBindingForPilot(parent, parent.recipients[index], receipt.receiptId),
    status: "sent",
    reservationGeneration: 1,
    reservedAtMs: receipt.claimedAtMs,
    providerStartedAtMs: receipt.providerStartedAtMs,
    terminalAtMs: receipt.sentAtMs,
    correlationId: "batch-completion-test",
  }));
  const lastProviderAttemptAtMs = receipts.at(-1)!.providerStartedAtMs;
  return {
    parent,
    state: {
      schemaVersion: "crm.warm-reconnect-executor-state.v1",
      pilotId: parent.pilotId,
      workspaceId: parent.workspaceId,
      activeReceiptId: null,
      claimedCount: parent.recipientCap,
      sentCount: parent.recipientCap,
      lastProviderAttemptAtMs,
      nextEligibleAtMs: lastProviderAttemptAtMs + CADENCE_MS,
      halted: false,
      complete: true,
    },
    receipts,
    ledgers,
    minimumCadenceMs: CADENCE_MS,
  };
}

describe("warm reconnect follow-on batch contract", () => {
  it.each([1, 4, 10, 11, 20])("accepts an exact follow-on audience of %i", (size) => {
    const pilot = followOn(undefined, size);
    expect(() => assertWarmReconnectBatchShape(pilot)).not.toThrow();
    expect(warmReconnectApprovalScopeForPilot(pilot)).toBe("exact_batch_one_time_reconnection_emails");
  });

  it("preserves the original five-person approval scope and action fingerprint", () => {
    const pilot = initialPilot();
    expect(() => assertWarmReconnectBatchShape(pilot)).not.toThrow();
    expect(warmReconnectApprovalScopeForPilot(pilot)).toBe("exact_five_one_time_reconnection_emails");
    expect(pilot.fingerprints.actionFingerprint).toBe(warmReconnectFingerprint({
      contract: "warm-reconnect-action.v1",
      action: "email_send",
      executionBoundary: "launch_authorizes_exact_claimed_provider_execution.v1",
      workspaceId: pilot.workspaceId,
      legacyDncOrgId: pilot.legacyDncOrgId,
      pilotId: pilot.pilotId,
      googleProfile: { businessId: pilot.sender.businessId, profileId: pilot.sender.profileId },
      artifactFingerprint: pilot.fingerprints.artifactFingerprint,
      audienceFingerprint: pilot.fingerprints.audienceFingerprint,
      tranche: "initial_5",
      recipientCap: 5,
      approvalScope: "exact_five_one_time_reconnection_emails",
      excludedScope: EXCLUDED_SCOPE,
      executionPolicy: WARM_RECONNECT_EXECUTION_POLICY,
    }));
  });

  it("preserves a four-person approval and refuses to enlarge it under the higher maximum", () => {
    const approved = followOn(undefined, 4);
    const saved = structuredClone(approved);
    expect(() => assertWarmReconnectPilotFingerprints(approved)).not.toThrow();
    expect(approved).toEqual(saved);
    const largerAudience = followOn(undefined, 20);
    const changed = { ...approved, recipientCap: 20, recipients: largerAudience.recipients };
    expect(() => assertWarmReconnectPilotFingerprints(changed)).toThrow("fingerprint contract drifted");
    expect(saved.approval?.actionFingerprint).not.toBe(largerAudience.fingerprints.actionFingerprint);
    expect(saved.recipients).toHaveLength(4);
  });

  it.each([
    { recipientCap: 4 }, { recipientCap: 20 }, { parentPilotId: "other" }, { batchSequence: 1 }, { followOnNotBeforeMs: 0 },
  ])("rejects altered initial-pilot metadata: %j", (change) => {
    expect(() => assertWarmReconnectBatchShape({ ...initialPilot(), ...change })).toThrow();
  });

  it.each([
    { recipientCap: 0 }, { recipientCap: 21 }, { recipientCap: 1.5 },
    { parentPilotId: "" }, { parentPilotId: undefined },
    { batchSequence: 0 }, { batchSequence: 1.5 }, { batchSequence: Number.MAX_SAFE_INTEGER + 1 },
    { followOnNotBeforeMs: -1 }, { followOnNotBeforeMs: Number.NaN },
    { followOnNotBeforeMs: Number.POSITIVE_INFINITY }, { followOnNotBeforeMs: undefined },
  ])("rejects malformed follow-on bounds: %j", (change) => {
    expect(() => assertWarmReconnectBatchShape({ ...followOn(), ...change })).toThrow();
  });

  it("uses an isolated, workspace-bound follow-on lock", () => {
    const pilot = followOn();
    const id = warmReconnectFollowOnPilotLockId(pilot.workspaceId);
    expect(id).toBe(warmReconnectFollowOnPilotLockId(pilot.workspaceId));
    expect(id).not.toBe(warmReconnectInitialPilotLockId(pilot.workspaceId));
    expect(id).not.toBe(warmReconnectFollowOnPilotLockId("workspace_default_other"));
    expect(() => assertOwnedWarmReconnectFollowOnLock(followOnLock(pilot), pilot)).not.toThrow();
  });

  it.each([
    { schemaVersion: 2 }, { workspaceId: "workspace_default_other" },
    { campaignId: "other" }, { campaignVersion: "other" }, { tranche: "initial_5" },
    { state: "released_before_provider" }, { pilotId: "other" },
    { parentPilotId: "other" }, { batchSequence: 2 }, { recipientCap: 10 },
  ])("refuses a foreign or stale active follow-on lock: %j", (change) => {
    const pilot = followOn();
    expect(() => assertOwnedWarmReconnectFollowOnLock({ ...followOnLock(pilot), ...change }, pilot)).toThrow();
  });

  it("requires an existing lock for execution", () => {
    expect(() => assertOwnedWarmReconnectFollowOnLock(undefined, followOn())).toThrow();
  });

  it("allows fresh audience decisions while preserving approved message and sender", () => {
    const parent = initialPilot();
    const next = followOn(parent);
    expect(next.fingerprints.artifactFingerprint).toBe(parent.fingerprints.artifactFingerprint);
    expect(next.fingerprints.audienceFingerprint).not.toBe(parent.fingerprints.audienceFingerprint);
    expect(() => assertWarmReconnectFollowOnContent(parent, next)).not.toThrow();
  });

  it.each([
    ["suppression scope", (pilot: WarmReconnectPilot) => { pilot.legacyDncOrgId = "other"; }],
    ["preview", (pilot: WarmReconnectPilot) => { pilot.campaignPreviewFingerprint = `sha256:${"b".repeat(64)}`; }],
    ["sender account", (pilot: WarmReconnectPilot) => { pilot.sender.accountId = "other"; }],
    ["reply-to", (pilot: WarmReconnectPilot) => { pilot.sender.replyTo = "other@example.com"; }],
    ["artwork approval", (pilot: WarmReconnectPilot) => { pilot.artworkEmailApproval!.evidenceNote = "Changed approval"; }],
    ["content mode", (pilot: WarmReconnectPilot) => { pilot.contentMode = "plain_text"; }],
    ["preferences origin", (pilot: WarmReconnectPilot) => { pilot.preferenceContract.origin = "https://other.example.com"; }],
  ])("refuses changed %s even when stored fingerprint is copied", (_label, change) => {
    const parent = initialPilot();
    const next = followOn(parent);
    (change as (pilot: WarmReconnectPilot) => void)(next);
    expect(() => assertWarmReconnectFollowOnContent(parent, next)).toThrow();
  });

  it.each(["parentPilotId", "batchSequence", "followOnNotBeforeMs"] as const)(
    "binds %s to the follow-on action approval", (key) => {
      const pilot = followOn();
      const changed = structuredClone(pilot);
      if (key === "parentPilotId") changed.parentPilotId = "another-parent";
      else changed[key] = changed[key]! + 1;
      const fingerprints = computeWarmReconnectPilotFingerprints(changed);
      expect(fingerprints.actionFingerprint).not.toBe(pilot.fingerprints.actionFingerprint);
      expect(fingerprints.artifactFingerprint).toBe(pilot.fingerprints.artifactFingerprint);
    }
  );
});

describe("warm reconnect durable parent completion", () => {
  it.each([1, 4, 10, 11, 20])("accepts exact durable completion of %i follow-on recipients", (size) => {
    const fixture = completionFixture(followOn(undefined, size));
    expect(assertWarmReconnectParentCompletion(fixture)).toEqual({
      notBeforeMs: fixture.state.nextEligibleAtMs,
    });
  });

  it("accepts initial completion after approval expiry without imposing an observation wait", () => {
    const fixture = completionFixture();
    fixture.parent.approval!.expiresAt = "2026-10-08T11:00:00.000Z";
    expect(assertWarmReconnectParentCompletion(fixture)).toEqual({
      notBeforeMs: fixture.state.lastProviderAttemptAtMs + CADENCE_MS,
    });
  });

  it.each([
    { complete: false }, { halted: true }, { activeReceiptId: "inflight" },
    { claimedCount: 4 }, { sentCount: 4 }, { sentCount: 6 },
    { workspaceId: "workspace_default_other" }, { pilotId: "other" },
    { lastProviderAttemptAtMs: Number.NaN },
  ])("refuses unreconciled executor state: %j", (change) => {
    const fixture = completionFixture();
    expect(() => assertWarmReconnectParentCompletion({ ...fixture, state: { ...fixture.state, ...change } })).toThrow();
  });

  it.each(["missing receipt", "extra receipt", "duplicate receipt", "missing ledger", "extra ledger"])(
    "refuses %s despite complete=true", (change) => {
      const fixture = completionFixture();
      if (change === "missing receipt") fixture.receipts.pop();
      if (change === "extra receipt") fixture.receipts.push({ ...fixture.receipts[0], receiptId: "stray-receipt" });
      if (change === "duplicate receipt") fixture.receipts[1] = { ...fixture.receipts[0] };
      if (change === "missing ledger") fixture.ledgers.pop();
      if (change === "extra ledger") fixture.ledgers.push({ ...fixture.ledgers[0], reservationId: "stray-ledger" });
      expect(() => assertWarmReconnectParentCompletion(fixture)).toThrow();
    }
  );

  it.each([
    ["status", "delivery_unknown"], ["status", "provider_inflight"],
    ["receiptId", "different-receipt"], ["pilotId", "other"],
    ["workspaceId", "other"], ["ownerUid", "other"], ["recipientId", "other"],
    ["personId", "other"], ["contactPointId", "other"], ["emailKey", `sha256:${"d".repeat(64)}`],
    ["approvalId", "other"], ["artifactFingerprint", `sha256:${"d".repeat(64)}`],
    ["audienceFingerprint", `sha256:${"d".repeat(64)}`], ["actionFingerprint", `sha256:${"d".repeat(64)}`],
    ["invitationReservationId", "other"], ["providerMessageId", ""], ["providerThreadId", ""],
    ["providerMessageId", "not-a-gmail-id"], ["providerThreadId", "not-a-gmail-id"],
    ["providerMessageId", "a".repeat(65)], ["providerThreadId", "b".repeat(65)],
    ["sentAtMs", 0], ["sentAtMs", Number.NaN], ["sentAtMs", Number.POSITIVE_INFINITY],
  ])("refuses receipt %s=%s", (key, value) => {
    const fixture = completionFixture();
    Object.assign(fixture.receipts[0], { [key]: value });
    expect(() => assertWarmReconnectParentCompletion(fixture)).toThrow();
  });

  it.each(["providerMessageId", "providerThreadId"] as const)("refuses duplicate %s completion proof", (key) => {
    const fixture = completionFixture();
    fixture.receipts[1][key] = fixture.receipts[0][key];
    expect(() => assertWarmReconnectParentCompletion(fixture)).toThrow();
  });

  it.each([
    ["status", "delivery_unknown"], ["status", "released_before_provider"],
    ["reservationId", "other"], ["receiptId", "other"], ["pilotId", "other"],
    ["workspaceId", "other"], ["personId", "other"], ["approvalId", "other"],
    ["emailKey", `sha256:${"d".repeat(64)}`], ["actionFingerprint", `sha256:${"d".repeat(64)}`],
  ])("refuses invitation ledger %s=%s", (key, value) => {
    const fixture = completionFixture();
    Object.assign(fixture.ledgers[0], { [key]: value });
    expect(() => assertWarmReconnectParentCompletion(fixture)).toThrow();
  });
});

describe("warm reconnect single follow-on chain", () => {
  it("reserves the first follow-on only from the initial parent", () => {
    const parent = initialPilot();
    expect(() => assertWarmReconnectFollowOnReservation({ lock: undefined, parent, proposed: followOn(parent) })).not.toThrow();
    const child = followOn(parent);
    expect(() => assertWarmReconnectFollowOnReservation({ lock: undefined, parent: child, proposed: followOn(child) })).toThrow();
  });

  it("advances only from the locked completed parent", () => {
    const parent = followOn();
    const proposed = followOn(parent);
    expect(() => assertWarmReconnectFollowOnReservation({ lock: followOnLock(parent), parent, proposed })).not.toThrow();
  });

  it("recognizes a replay of the exact reserved successor", () => {
    const parent = initialPilot();
    const proposed = followOn(parent);
    expect(() => assertWarmReconnectFollowOnReservation({ lock: followOnLock(proposed), parent, proposed })).not.toThrow();
  });

  it.each(["ownerUid", "workspaceId"] as const)("rejects successor %s drift", (key) => {
    const parent = initialPilot();
    const proposed = followOn(parent);
    proposed[key] = "another-owner-or-workspace";
    expect(() => assertWarmReconnectFollowOnReservation({ lock: undefined, parent, proposed })).toThrow();
  });

  it.each(["branch from initial", "stale parent", "skipped sequence", "wrong parent", "foreign workspace"])(
    "rejects %s", (change) => {
      let parent = followOn();
      const lock = followOnLock(parent);
      let proposed = followOn(parent);
      if (change === "branch from initial") {
        parent = initialPilot();
        proposed = followOn(parent);
        proposed.pilotId = "different-first-child";
      }
      if (change === "stale parent") lock.pilotId = "newer-completed-pilot";
      if (change === "skipped sequence") proposed.batchSequence! += 1;
      if (change === "wrong parent") proposed.parentPilotId = "another-parent";
      if (change === "foreign workspace") lock.workspaceId = "workspace_default_other";
      expect(() => assertWarmReconnectFollowOnReservation({ lock, parent, proposed })).toThrow();
    }
  );
});
