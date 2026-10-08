import { describe, expect, it, vi } from "vitest";
import {
  WARM_RECONNECT_EXECUTION_POLICY,
  assertWarmReconnectPilotFingerprints,
  createWarmReconnectPilot,
  computeWarmReconnectPilotFingerprints,
  decideWarmReconnectPilotApproval,
  decideWarmReconnectRecipient,
  requestWarmReconnectPilotLaunch,
  warmReconnectInitialPilotLockId,
} from "@/lib/crm/warm-reconnect-activation";
import type {
  WarmReconnectCandidate,
  WarmReconnectContentMode,
  WarmReconnectPilot,
} from "@/lib/crm/warm-reconnect-activation-types";
import {
  WARM_RECONNECT_CAPABILITY_TTL_MS,
  WARM_RECONNECT_INFLIGHT_RECONCILIATION_MS,
  WARM_RECONNECT_MAX_CLAIMS_PER_INVOCATION,
  WARM_RECONNECT_MIN_CADENCE_MS,
  WARM_RECONNECT_CONTACT_SCAN_LIMIT,
  WARM_RECONNECT_SUPPRESSION_SCAN_LIMIT,
  isWarmReconnectProviderSendEnabled,
  isWarmReconnectGmailSendScopeExact,
  markWarmReconnectCapabilitiesPrepared,
  recordWarmReconnectSent,
  claimNextWarmReconnectRecipient,
  reconcileWarmReconnectExecutorProgress,
  reconcileWarmReconnectPermission,
  reconcileWarmReconnectSourceEvidence,
  runWarmReconnectPilotExecutor,
  reconcileWarmReconnectWorkspaceEmailUniqueness,
  reconcileWarmReconnectWorkspaceSuppressionScan,
  shouldReleaseWarmReconnectInitialPilotLock,
  warmReconnectRecipientTargetQuerySpecs,
  type WarmReconnectExecutorClaim,
  type WarmReconnectExecutorDependencies,
} from "@/lib/crm/warm-reconnect-executor";
import {
  reconcileWarmReconnectInvitationReservation,
  reconcileWarmReconnectInvitationTransition,
  warmReconnectInvitationReservationId,
  type WarmReconnectInvitationReservationBinding,
} from "@/lib/crm/warm-reconnect-invitation-ledger";
import { WARM_RECONNECT_CAMPAIGN_VERSION } from "@/lib/crm/warm-reconnect-types";
import { warmReconnectFollowOnPilotLockId, warmReconnectBatchReceiptId } from "@/lib/crm/warm-reconnect-batches";
import { warmReconnectEmailKey } from "@/lib/crm/warm-reconnect-dedupe";
import { buildWarmReconnectCampaignDraft } from "@/lib/crm/warm-reconnect";
import { isWarmReconnectCampaignArtworkMode, renderWarmReconnectCampaignEmail, warmReconnectCampaignAssetManifest } from "@/lib/crm/warm-reconnect-campaign-design";
import { buildWarmReconnectCampaignDeliveryMime } from "@/lib/google/gmail-campaign-design";

const START = new Date("2026-08-12T12:00:00.000Z");
const RUN_AT = new Date("2026-08-12T15:00:00.000Z");
const PREVIEW_FINGERPRINT = `sha256:${"a".repeat(64)}`;
const db = {} as never;
const log = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

function candidate(index: number): WarmReconnectCandidate {
  return {
    recipientId: `recipient-${index}`,
    personId: `person-${index}`,
    contactPointId: `contact-${index}`,
    displayName: `Person ${index}`,
    email: `person${index}@example.com`,
    emailKey: `sha256:${String(index).padStart(64, "0")}`,
    permissionState: "unknown",
    permissionRemainsExplicit: true,
    sourceEvidence: [
      {
        evidenceRef: `crm_source_records/source-${index}`,
        sourceSystem: "google_people",
        permissionBasis: "none",
        observedAt: "2026-08-01T00:00:00.000Z",
      },
    ],
    candidateFingerprint: `sha256:${index.toString(16).padStart(64, "0")}`,
    reviewStatus: "requires_operator_attestation",
  };
}

function launchedPilot(
  pilotId = "wrp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  approvalId = "approval-1",
  contentMode: WarmReconnectContentMode = "artwork_html",
  workspaceId = "workspace-1",
  legacyDncOrgId = "org-1"
): WarmReconnectPilot {
  let pilot = createWarmReconnectPilot({
    pilotId,
    workspaceId,
    ownerUid: "owner-1",
    legacyDncOrgId,
    request: {
      idempotencyKey: `request-${pilotId}`,
      campaignPreviewFingerprint: PREVIEW_FINGERPRINT,
      tranche: "initial_5",
      recipientCap: 5,
      candidateRecipientIds: [
        "recipient-1",
        "recipient-2",
        "recipient-3",
        "recipient-4",
        "recipient-5",
      ],
      sender: {
        senderName: "Marcus Rosser",
        legalEntity: contentMode === "approved_design_v2" ? "Marcus Rosser / Rosser Gallery" : "Rosser Gallery LLC",
        replyTo: contentMode === "approved_design_v2" ? "mrosser@rossergallery.com" : "marcus@example.com",
        physicalPostalAddress: "2505 N Tonti St, New Orleans, LA 70117",
        businessId: "rosser_nft_gallery",
        profileId: "rosser_gallery_send",
      },
      contentMode,
      ...(isWarmReconnectCampaignArtworkMode(contentMode) ? {
        artworkEmailApproval: {
          approvedForThisEmailCampaign: true as const,
          evidenceNote: "Approved for this exact email campaign.",
        },
      } : {}),
    },
    candidates: [1, 2, 3, 4, 5].map((index) => contentMode === "approved_design_v2" ? {
      ...candidate(index), displayName: ["Avery", "Blake", "Cameron", "Devon", "Emery"][index - 1], email: `person${index}@example.test`,
    } : candidate(index)),
    googleReady: true,
    fromEmail: "mrosser@rossergallery.com",
    accountId: "google-account-1",
    preferenceOrigin: "https://leadflow-review.web.app",
    now: START,
  });
  for (const recipient of pilot.recipients) {
    pilot = decideWarmReconnectRecipient({
      pilot,
      recipientId: recipient.recipientId,
      decisionId: `decision-${recipient.recipientId}`,
      request: {
        decision: "attest_relationship",
        expectedCandidateFingerprint: recipient.candidateFingerprint,
        personallyRecognizedRelationship: true,
        oneTimeReconnectionInvitationOnly: true,
        sourceEvidenceRefs: [...recipient.decision.sourceEvidenceRefs],
        note: "Personally recognized for one invitation.",
      },
      googleReady: true,
      now: new Date("2026-08-12T13:00:00.000Z"),
    });
  }
  pilot = decideWarmReconnectPilotApproval({
    pilot,
    approvalId,
    request: {
      decision: "approve",
      expectedArtifactFingerprint: pilot.fingerprints.artifactFingerprint,
      expectedAudienceFingerprint: pilot.fingerprints.audienceFingerprint,
      expectedActionFingerprint: pilot.fingerprints.actionFingerprint,
      approvalScope: "exact_five_one_time_reconnection_emails",
      confirmations: {
        senderLegalIdentityVerified: true,
        physicalPostalAddressVerified: true,
        preferencesAndUnsubscribeVerified: true,
        suppressionLedgerVerified: true,
        spfDkimDmarcVerified: true,
        replyToMonitored: true,
        ...(isWarmReconnectCampaignArtworkMode(contentMode) ? { artworkApprovedForEmail: true as const } : {}),
        exactAudienceReviewed: true,
      },
      note: "Approved for the exact five-person pilot.",
    },
    googleReady: true,
    now: new Date("2026-08-12T14:00:00.000Z"),
  });
  return requestWarmReconnectPilotLaunch({
    pilot,
    request: {
      approvalId,
      expectedArtifactFingerprint: pilot.fingerprints.artifactFingerprint,
      expectedAudienceFingerprint: pilot.fingerprints.audienceFingerprint,
      expectedActionFingerprint: pilot.fingerprints.actionFingerprint,
      acknowledgeLaunchAuthorizesExactFiveEmailSend: true,
    },
    googleReady: true,
    now: RUN_AT,
  });
}

function claimFor(pilot: WarmReconnectPilot): WarmReconnectExecutorClaim {
  return {
    pilot,
    recipient: pilot.recipients[0],
    receiptId: "wre_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    email: "person1@example.com",
    claimedAtMs: RUN_AT.getTime(),
  };
}

function reservationBindingFor(
  pilot: WarmReconnectPilot
): WarmReconnectInvitationReservationBinding {
  const recipient = pilot.recipients[0];
  return {
    reservationId: warmReconnectInvitationReservationId({
      workspaceId: pilot.workspaceId,
      campaignVersion: WARM_RECONNECT_CAMPAIGN_VERSION,
      personId: recipient.personId,
      emailKey: recipient.emailKey,
    }),
    workspaceId: pilot.workspaceId,
    campaignVersion: WARM_RECONNECT_CAMPAIGN_VERSION,
    personId: recipient.personId,
    emailKey: recipient.emailKey,
    pilotId: pilot.pilotId,
    receiptId: claimFor(pilot).receiptId,
    approvalId: pilot.approval!.approvalId,
    actionFingerprint: pilot.fingerprints.actionFingerprint,
  };
}

function invitationLedger(
  binding: WarmReconnectInvitationReservationBinding,
  status:
    | "reserved"
    | "provider_inflight"
    | "sent"
    | "delivery_unknown"
    | "released_before_provider"
) {
  return {
    schemaVersion: "crm.warm-reconnect-invitation-ledger.v1",
    ...binding,
    status,
    reservationGeneration: 1,
    reservedAtMs: RUN_AT.getTime(),
    correlationId: "correlation-1",
  };
}

function dependencies(
  overrides: Partial<WarmReconnectExecutorDependencies> = {}
): WarmReconnectExecutorDependencies {
  const pilot = launchedPilot();
  return {
    sendEnabled: vi.fn(() => true),
    claimNext: vi.fn(async () => ({ kind: "claimed" as const, claim: claimFor(pilot) })),
    issueCapabilities: vi.fn(async () => ({
      preferenceToken: "p".repeat(43),
      unsubscribeOnlyToken: "u".repeat(43),
      preferenceFragment: `/preferences#token=${"p".repeat(43)}`,
      oneClickPath: `/api/crm/warm-reconnect/unsubscribe/${"u".repeat(43)}`,
    })),
    markCapabilitiesPrepared: vi.fn(async () => undefined),
    beginProviderAttempt: vi.fn(async () => ({ ready: true as const })),
    resolveAccessToken: vi.fn(async () => "ephemeral-access-token"),
    renderMessage: vi.fn((input) => ({
      contentMode: input.contentMode || "artwork_html",
      rendererVersion: "warm-reconnect-email-renderer.v2" as const,
      subject: "A quick hello from Marcus",
      plainText: "plain",
      html: input.contentMode === "plain_text" ? "" : "<p>html</p>",
      artworkUrl: input.contentMode === "artwork_html" ? "https://leadflow-review.web.app/art.webp" : "",
      contractFingerprint: `sha256:${"f".repeat(64)}`,
    })),
    sendMessage: vi.fn(async () => ({ id: "gmail-message-1", threadId: "thread-1" })),
    recordSent: vi.fn(async () => ({ complete: false })),
    recordDeliveryUnknown: vi.fn(async () => ({ alreadySent: false })),
    recordStoppedBeforeProvider: vi.fn(async () => undefined),
    loadCampaign: vi.fn(async () => ({
      review: { previewFingerprint: PREVIEW_FINGERPRINT },
    } as never)),
    ...overrides,
  };
}

function capabilityReceiptFixture(suppliedPilot?: WarmReconnectPilot) {
  const pilot = suppliedPilot || launchedPilot(undefined, undefined, undefined, "workspace_default_owner-1", "workspace_default_owner-1");
  const claim = claimFor(pilot);
  const binding = reservationBindingFor(pilot);
  const pilotPath = `crm_warm_reconnect_pilots/${pilot.pilotId}`;
  const receiptPath = `${pilotPath}/delivery_receipts/${claim.receiptId}`;
  const receipt = {
    schemaVersion: "crm.warm-reconnect-delivery-receipt.v1",
    ...binding, ...pilot.fingerprints, ownerUid: pilot.ownerUid,
    recipientId: claim.recipient.recipientId,
    invitationReservationId: binding.reservationId,
    status: "claimed", claimedAtMs: claim.claimedAtMs,
  };
  const documents = new Map<string, Record<string, unknown>>([
    [pilotPath, pilot as unknown as Record<string, unknown>],
    [receiptPath, receipt],
    [`${pilotPath}/executor/state`, {
      schemaVersion: "crm.warm-reconnect-executor-state.v1", pilotId: pilot.pilotId,
      workspaceId: pilot.workspaceId, activeReceiptId: claim.receiptId,
    }],
    [`crm_warm_reconnect_invitation_ledger/${binding.reservationId}`, invitationLedger(binding, "reserved")],
    [`crm_warm_reconnect_campaign_locks/${warmReconnectInitialPilotLockId(pilot.workspaceId)}`, {
      schemaVersion: 1, workspaceId: pilot.workspaceId, campaignId: "marcus-warm-reconnect",
      campaignVersion: WARM_RECONNECT_CAMPAIGN_VERSION, tranche: "initial_5",
      state: "active", pilotId: pilot.pilotId,
    }],
  ]);
  type FakeRef = { path: string; collection: (name: string) => { doc: (id: string) => FakeRef } };
  const ref = (path: string): FakeRef => ({
    path, collection: (name) => ({ doc: (id) => ref(`${path}/${name}/${id}`) }),
  });
  const set = vi.fn();
  const transaction = {
    get: async ({ path }: { path: string }) => ({
      id: path.split("/").at(-1), exists: documents.has(path), data: () => documents.get(path),
    }), set,
  };
  const database = {
    collection: (name: string) => ({ doc: (id: string) => ref(`${name}/${id}`) }),
    runTransaction: async (callback: (value: typeof transaction) => Promise<void>) => callback(transaction),
  };
  return { claim, receipt, receiptPath, set, documents, input: {
    claim, preferenceDigest: "a".repeat(64), unsubscribeDigest: "b".repeat(64),
    capabilityExpiresAtMs: claim.claimedAtMs + WARM_RECONNECT_CAPABILITY_TTL_MS,
    correlationId: "capability-timing-regression", now: new Date(claim.claimedAtMs + 1_500), db: database as never,
  } };
}

function followOnExecutorFixture(cap: number) {
  const pilot = launchedPilot(undefined, undefined, undefined, "workspace_default_owner-1", "workspace_default_owner-1");
  pilot.tranche = "follow_on";
  pilot.parentPilotId = "completed-parent";
  pilot.batchSequence = 1;
  pilot.recipientCap = cap;
  pilot.followOnNotBeforeMs = RUN_AT.getTime() + 60_000;
  pilot.recipients = Array.from({ length: cap }, (_, index) => ({
    ...structuredClone(pilot.recipients[index % 5]),
    recipientId: `follow-recipient-${index}`, personId: `follow-person-${index}`,
    contactPointId: `follow-contact-${index}`, emailKey: `sha256:${(index + 30).toString(16).padStart(64, "0")}`,
  }));
  pilot.fingerprints = computeWarmReconnectPilotFingerprints(pilot);
  pilot.approval = { ...pilot.approval!, ...pilot.fingerprints, approvalScope: "exact_batch_one_time_reconnection_emails" };
  const fixture = capabilityReceiptFixture(pilot);
  const binding = reservationBindingFor(pilot);
  fixture.documents.set(`crm_warm_reconnect_campaign_locks/${warmReconnectFollowOnPilotLockId(pilot.workspaceId)}`, {
    schemaVersion: "crm.warm-reconnect-follow-on-lock.v1", workspaceId: pilot.workspaceId,
    campaignId: "marcus-warm-reconnect", campaignVersion: WARM_RECONNECT_CAMPAIGN_VERSION,
    tranche: "follow_on", state: "active", pilotId: pilot.pilotId, parentPilotId: pilot.parentPilotId,
    batchSequence: pilot.batchSequence, recipientCap: cap,
  });
  fixture.documents.set(`crm_warm_reconnect_invitation_ledger/${binding.reservationId}`, invitationLedger(binding, "provider_inflight"));
  fixture.documents.set(`crm_warm_reconnect_pilots/${pilot.pilotId}/executor/state`, {
    schemaVersion: "crm.warm-reconnect-executor-state.v1", workspaceId: pilot.workspaceId,
    pilotId: pilot.pilotId, activeReceiptId: fixture.claim.receiptId, claimedCount: cap,
    sentCount: cap - 1, complete: false, halted: false,
  });
  Object.assign(fixture.receipt, { status: "provider_inflight", providerStartedAtMs: RUN_AT.getTime() });
  return fixture;
}

describe("warm reconnect provider executor", () => {
  it.each([1, 4, 10])("completes a follow-on batch at its exact cap %i", async (cap) => {
    const fixture = followOnExecutorFixture(cap);
    const result = await recordWarmReconnectSent({ claim: fixture.claim, providerMessageId: "gmail-final", providerThreadId: "thread-final", correlationId: "batch-completion", now: RUN_AT, db: fixture.input.db });
    expect(result).toEqual({ complete: true });
    expect(fixture.set).toHaveBeenCalledWith(
      expect.objectContaining({ path: `crm_warm_reconnect_pilots/${fixture.claim.pilot.pilotId}/executor/state` }),
      expect.objectContaining({ sentCount: cap, complete: true }), { merge: true }
    );
  });

  it("does not complete a ten-person follow-on after the old five-person boundary", async () => {
    const fixture = followOnExecutorFixture(10);
    fixture.documents.get(`crm_warm_reconnect_pilots/${fixture.claim.pilot.pilotId}/executor/state`)!.sentCount = 4;
    const result = await recordWarmReconnectSent({ claim: fixture.claim, providerMessageId: "gmail-fifth", providerThreadId: "thread-fifth", correlationId: "batch-midpoint", now: RUN_AT, db: fixture.input.db });
    expect(result).toEqual({ complete: false });
  });

  it("waits for the parent cadence without creating an executor or claiming a recipient", async () => {
    const fixture = followOnExecutorFixture(1);
    fixture.documents.delete(`crm_warm_reconnect_pilots/${fixture.claim.pilot.pilotId}/executor/state`);
    fixture.documents.delete(fixture.receiptPath);
    const result = await claimNextWarmReconnectRecipient({ uid: fixture.claim.pilot.ownerUid, pilotId: fixture.claim.pilot.pilotId, correlationId: "parent-cadence", now: RUN_AT, db: fixture.input.db });
    expect(result).toEqual({ kind: "waiting", retryAfterMs: 60_000 });
    expect(fixture.set).not.toHaveBeenCalled();
  });

  it("refuses a stale follow-on worker after the chain lock advances", async () => {
    const fixture = followOnExecutorFixture(1);
    fixture.documents.get(`crm_warm_reconnect_campaign_locks/${warmReconnectFollowOnPilotLockId(fixture.claim.pilot.workspaceId)}`)!.pilotId = "new-batch";
    await expect(recordWarmReconnectSent({ claim: fixture.claim, providerMessageId: "gmail-id", providerThreadId: "thread-id", correlationId: "old-worker", now: RUN_AT, db: fixture.input.db })).rejects.toThrow(/batch changed/);
    expect(fixture.set).not.toHaveBeenCalled();
  });

  it("returns complete for a completed variable-size batch without another claim", async () => {
    const fixture = followOnExecutorFixture(1);
    const state = fixture.documents.get(`crm_warm_reconnect_pilots/${fixture.claim.pilot.pilotId}/executor/state`)!;
    Object.assign(state, { activeReceiptId: null, sentCount: 1, complete: true });
    const receiptId = warmReconnectBatchReceiptId(fixture.claim.pilot, fixture.claim.recipient.recipientId);
    fixture.documents.delete(fixture.receiptPath);
    fixture.documents.set(`crm_warm_reconnect_pilots/${fixture.claim.pilot.pilotId}/delivery_receipts/${receiptId}`, { ...fixture.receipt, receiptId, status: "sent" });
    const result = await claimNextWarmReconnectRecipient({ uid: fixture.claim.pilot.ownerUid, pilotId: fixture.claim.pilot.pilotId, correlationId: "completed-batch", now: RUN_AT, db: fixture.input.db });
    expect(result).toEqual({ kind: "complete" });
    expect(fixture.set).not.toHaveBeenCalled();
  });

  it.each([1_500, 10_000])("binds capabilities after %i ms without extending their lifetime", async (elapsedMs) => {
    const fixture = capabilityReceiptFixture();
    fixture.input.now = new Date(fixture.claim.claimedAtMs + elapsedMs);
    await markWarmReconnectCapabilitiesPrepared(fixture.input);
    expect(fixture.set).toHaveBeenCalledWith(
      expect.objectContaining({ path: fixture.receiptPath }),
      expect.objectContaining({ status: "capabilities_prepared", capabilityExpiresAtMs: fixture.input.capabilityExpiresAtMs }),
      { merge: true }
    );
    expect(fixture.set).toHaveBeenCalledTimes(2);
  });

  it.each(["shortened", "extended", "nan", "infinite", "fractional", "before_claim", "bad_claim", "expired", "equal_digests"])(
    "rejects %s capability timing without a receipt write", async (change) => {
      const fixture = capabilityReceiptFixture();
      if (change === "shortened") fixture.input.capabilityExpiresAtMs -= 1;
      if (change === "extended") fixture.input.capabilityExpiresAtMs += 1;
      if (change === "nan") fixture.input.capabilityExpiresAtMs = Number.NaN;
      if (change === "infinite") fixture.input.capabilityExpiresAtMs = Number.POSITIVE_INFINITY;
      if (change === "fractional") fixture.input.capabilityExpiresAtMs += 0.5;
      if (change === "before_claim") fixture.input.now = new Date(fixture.claim.claimedAtMs - 1);
      if (change === "bad_claim") fixture.receipt.claimedAtMs = Number.NaN;
      if (change === "expired") fixture.input.now = new Date(fixture.input.capabilityExpiresAtMs);
      if (change === "equal_digests") fixture.input.unsubscribeDigest = fixture.input.preferenceDigest;
      await expect(markWarmReconnectCapabilitiesPrepared(fixture.input)).rejects.toThrow();
      expect(fixture.set).not.toHaveBeenCalled();
    }
  );

  it("issues capability lifetime from the durable claim timestamp", async () => {
    const claim = { ...claimFor(launchedPilot()), claimedAtMs: RUN_AT.getTime() - 5_000 };
    const deps = dependencies({ claimNext: vi.fn(async () => ({ kind: "claimed" as const, claim })) });
    await runWarmReconnectPilotExecutor({ uid: "owner-1", pilotId: claim.pilot.pilotId,
      correlationId: "claim-lifetime", log, db, now: RUN_AT, dependencies: deps });
    expect(deps.issueCapabilities).toHaveBeenCalledWith(expect.objectContaining({
      capabilityExpiresAtMs: claim.claimedAtMs + WARM_RECONNECT_CAPABILITY_TTL_MS,
    }), db);
  });

  it("derives executor limits from the frozen shared execution policy", () => {
    expect(WARM_RECONNECT_MIN_CADENCE_MS).toBe(
      WARM_RECONNECT_EXECUTION_POLICY.minimumCadenceMs
    );
    expect(WARM_RECONNECT_CAPABILITY_TTL_MS).toBe(
      WARM_RECONNECT_EXECUTION_POLICY.capabilityTtlMs
    );
    expect(WARM_RECONNECT_INFLIGHT_RECONCILIATION_MS).toBe(
      WARM_RECONNECT_EXECUTION_POLICY.inflightReconciliationMs
    );
    expect(WARM_RECONNECT_MAX_CLAIMS_PER_INVOCATION).toBe(1);
    expect(WARM_RECONNECT_EXECUTION_POLICY.provider).toBe(
      "gmail.users.me.messages.send"
    );
    expect(WARM_RECONNECT_EXECUTION_POLICY.providerKillSwitchDefault).toBe(
      "disabled"
    );
  });

  it("requires the exact Gmail send-only grant", () => {
    const sendScope = "https://www.googleapis.com/auth/gmail.send";
    const emailIdentityScope =
      "https://www.googleapis.com/auth/userinfo.email";
    expect(
      isWarmReconnectGmailSendScopeExact(`${emailIdentityScope} ${sendScope}`)
    ).toBe(true);
    expect(
      isWarmReconnectGmailSendScopeExact(
        `${emailIdentityScope} ${sendScope} https://www.googleapis.com/auth/gmail.readonly`
      )
    ).toBe(false);
  });

  it("normalizes the bounded workspace email scan and fails closed on duplicates or truncation", () => {
    const workspaceId = "workspace-1";
    const emailKey = warmReconnectEmailKey(workspaceId, "person1@example.com");
    const target = {
      id: "contact-1",
      data: {
        workspaceId,
        type: "email",
        normalizedValue: " person1@EXAMPLE.com ",
      },
    };
    expect(
      reconcileWarmReconnectWorkspaceEmailUniqueness({
        workspaceId,
        targetContactPointId: "contact-1",
        expectedEmailKey: emailKey,
        scanSize: 1,
        documents: [target],
      })
    ).toEqual({ ok: true });
    expect(
      reconcileWarmReconnectWorkspaceEmailUniqueness({
        workspaceId,
        targetContactPointId: "contact-1",
        expectedEmailKey: emailKey,
        scanSize: 2,
        documents: [
          target,
          {
            id: "contact-duplicate",
            data: {
              workspaceId,
              type: "email",
              email: "PERSON1@example.COM",
            },
          },
        ],
      })
    ).toEqual({ ok: false, reason: "canonical_email_not_unique" });
    expect(
      reconcileWarmReconnectWorkspaceEmailUniqueness({
        workspaceId,
        targetContactPointId: "contact-1",
        expectedEmailKey: emailKey,
        scanSize: WARM_RECONNECT_CONTACT_SCAN_LIMIT,
        documents: [target],
      })
    ).toEqual({ ok: false, reason: "canonical_email_scan_truncated" });
  });

  it("normalizes bounded suppression email fields and fails closed at the cap", () => {
    expect(
      reconcileWarmReconnectWorkspaceSuppressionScan({
        workspaceId: "workspace-1",
        normalizedEmail: "person1@example.com",
        scanSize: 1,
        documents: [
          {
            workspaceId: "workspace-1",
            value: " Person1@Example.COM ",
            active: true,
          },
        ],
      })
    ).toEqual({ ok: false, reason: "canonical_suppression_present" });
    expect(
      reconcileWarmReconnectWorkspaceSuppressionScan({
        workspaceId: "workspace-1",
        normalizedEmail: "person1@example.com",
        scanSize: WARM_RECONNECT_SUPPRESSION_SCAN_LIMIT,
        documents: [],
      })
    ).toEqual({
      ok: false,
      reason: "canonical_suppression_scan_truncated",
    });
  });

  it("releases the initial-pilot lock only before any provider attempt", () => {
    expect(
      shouldReleaseWarmReconnectInitialPilotLock({
        lastProviderAttemptAtMs: null,
        receipts: [{ status: "stopped_before_provider" }],
      })
    ).toBe(true);
    expect(
      shouldReleaseWarmReconnectInitialPilotLock({
        lastProviderAttemptAtMs: RUN_AT.getTime(),
        receipts: [{ status: "sent" }],
      })
    ).toBe(false);
    expect(
      shouldReleaseWarmReconnectInitialPilotLock({
        lastProviderAttemptAtMs: null,
        receipts: [{ status: "delivery_unknown" }],
      })
    ).toBe(false);
  });

  it("reconciles unsupported permissions and added source evidence fail closed", () => {
    expect(
      reconcileWarmReconnectPermission({
        defaultPermissionState: "unknown",
        eventStates: ["unsupported_legacy_state"],
        latestPermissionState: "unsupported_legacy_state",
        approvedPermissionState: "unknown",
      })
    ).toEqual({ ok: false, reason: "unsupported_permission_state" });

    const approved = candidate(1).sourceEvidence;
    expect(
      reconcileWarmReconnectSourceEvidence({
        approved,
        current: [
          { evidence: approved[0], referencesRecipient: true },
          {
            evidence: {
              evidenceRef: "crm_source_records/new-source",
              sourceSystem: "blinq_csv",
              permissionBasis: "none",
              observedAt: "2026-08-11T00:00:00.000Z",
            },
            referencesRecipient: true,
          },
        ],
      })
    ).toEqual({ ok: false, reason: "source_evidence_drift" });
  });

  it("uses crmPersonId as a bounded scalar target alias for every safety collection", () => {
    const specs = warmReconnectRecipientTargetQuerySpecs({
      contactPointId: "contact-1",
      personId: "person-1",
    });
    expect(specs).toContainEqual({
      field: "crmPersonId",
      operator: "==",
      value: "person-1",
    });
    expect(specs).toHaveLength(5);
  });

  it("reconciles cadence and terminal receipt behavior without side effects", () => {
    const waiting = reconcileWarmReconnectExecutorProgress({
      state: {
        halted: false,
        complete: false,
        activeReceiptId: null,
        claimedCount: 1,
        nextEligibleAtMs: RUN_AT.getTime() + 60_000,
      },
      receipts: [null, null, null, null, null],
      nowMs: RUN_AT.getTime(),
      maxClaims: 5,
      staleAfterMs: 300_000,
    });
    expect(waiting).toEqual({ action: "waiting", retryAfterMs: 60_000 });

    const terminal = reconcileWarmReconnectExecutorProgress({
      state: {
        halted: false,
        complete: false,
        activeReceiptId: null,
        claimedCount: 5,
        nextEligibleAtMs: null,
      },
      receipts: [1, 2, 3, 4, 5].map((index) => ({
        receiptId: `receipt-${index}`,
        status: "stopped_before_provider" as const,
        claimedAtMs: RUN_AT.getTime(),
      })),
      nowMs: RUN_AT.getTime(),
      maxClaims: 5,
      staleAfterMs: 300_000,
    });
    expect(terminal).toEqual({
      action: "stopped",
      reason: "terminal_receipts_require_reconciliation",
    });
  });

  it("keeps sent and ambiguous invitation outcomes permanently excluded", () => {
    const pilot = launchedPilot();
    const binding = reservationBindingFor(pilot);
    expect(
      reconcileWarmReconnectInvitationTransition({
        existing: invitationLedger(binding, "sent"),
        expected: binding,
        target: "delivery_unknown",
      })
    ).toEqual({ ok: true, action: "already_applied", alreadySent: true });
    expect(
      reconcileWarmReconnectInvitationReservation(
        invitationLedger(binding, "delivery_unknown"),
        binding
      )
    ).toEqual({
      action: "conflict",
      reason: "cross_pilot_one_time_invitation_conflict",
    });
  });

  it("defaults the provider kill switch to off and accepts only explicit true", () => {
    expect(isWarmReconnectProviderSendEnabled({} as NodeJS.ProcessEnv)).toBe(false);
    expect(
      isWarmReconnectProviderSendEnabled({
        WARM_RECONNECT_PROVIDER_SEND_ENABLED: "false",
      } as unknown as NodeJS.ProcessEnv)
    ).toBe(false);
    expect(
      isWarmReconnectProviderSendEnabled({
        WARM_RECONNECT_PROVIDER_SEND_ENABLED: "true",
      } as unknown as NodeJS.ProcessEnv)
    ).toBe(true);
  });

  it("does not claim or call Gmail while disabled", async () => {
    const claimNext = vi.fn();
    const sendMessage = vi.fn();
    const result = await runWarmReconnectPilotExecutor({
      uid: "owner-1",
      pilotId: "wrp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      correlationId: "correlation-1",
      log,
      db,
      dependencies: {
        sendEnabled: () => false,
        claimNext,
        sendMessage,
      },
    });
    expect(result).toEqual({ ok: true, outcome: "disabled", providerCalled: false });
    expect(claimNext).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("issues two 90-day capabilities after one claim and sends exactly one message", async () => {
    const deps = dependencies();
    const result = await runWarmReconnectPilotExecutor({
      uid: "owner-1",
      pilotId: "wrp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      correlationId: "correlation-1",
      log,
      db,
      now: RUN_AT,
      dependencies: deps,
    });

    expect(result).toMatchObject({
      outcome: "sent",
      providerCalled: true,
      receiptId: "wre_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    });
    expect(deps.claimNext).toHaveBeenCalledOnce();
    expect(deps.issueCapabilities).toHaveBeenCalledOnce();
    expect(deps.issueCapabilities).toHaveBeenCalledWith(
      expect.objectContaining({
        legacyDncOrgId: "org-1",
        pilotId: "wrp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        recipientId: "recipient-1",
        recipientDecisionId: "decision-recipient-1",
        campaignApprovalId: "approval-1",
        actionFingerprint: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
        capabilityExpiresAtMs: RUN_AT.getTime() + WARM_RECONNECT_CAPABILITY_TTL_MS,
      }),
      db
    );
    const prepared = vi.mocked(deps.markCapabilitiesPrepared).mock.calls[0][0];
    expect(prepared.preferenceDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(prepared.unsubscribeDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(prepared)).not.toContain("p".repeat(43));
    expect(JSON.stringify(prepared)).not.toContain("u".repeat(43));
    expect(deps.sendMessage).toHaveBeenCalledOnce();
    expect(deps.renderMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        firstName: launchedPilot().recipients[0].greetingName,
      })
    );
    expect(deps.sendMessage).toHaveBeenCalledWith(
      "ephemeral-access-token",
      expect.objectContaining({
        to: "person1@example.com",
        from: "mrosser@rossergallery.com",
        senderName: "Marcus Rosser",
        replyTo: "marcus@example.com",
        preferencesUrl: expect.stringContaining("/preferences#token="),
        oneClickUnsubscribeUrl: expect.stringContaining("/unsubscribe/"),
      }),
      undefined
    );
    expect(deps.recordSent).toHaveBeenCalledOnce();
    expect(deps.recordDeliveryUnknown).not.toHaveBeenCalled();
  });

  it.each(["plain_text", "preference_buttons"] as const)("executes a reviewed %s pilot without an artwork attestation", async (contentMode) => {
    const pilot = launchedPilot("wrp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "approval-plain", contentMode);
    expect(pilot.artworkEmailApproval).toBeNull();
    expect(pilot.gates.some((gate) => gate.id === "artwork_email_channel_approval")).toBe(false);
    const deps = dependencies({
      claimNext: vi.fn(async () => ({ kind: "claimed" as const, claim: claimFor(pilot) })),
    });
    const result = await runWarmReconnectPilotExecutor({
      uid: "owner-1", pilotId: pilot.pilotId, correlationId: "plain-test", log, db,
      now: RUN_AT, dependencies: deps,
    });
    expect(result).toMatchObject({ outcome: "sent", providerCalled: true });
    expect(deps.sendMessage).toHaveBeenCalledOnce();
    expect(deps.renderMessage).toHaveBeenCalledWith(expect.objectContaining({ contentMode }));
    expect(deps.sendMessage).toHaveBeenCalledWith("ephemeral-access-token", expect.objectContaining({
      contentMode, html: contentMode === "plain_text" ? "" : "<p>html</p>",
    }), undefined);
  });

  it("invalidates the approved fingerprints when a plain-text pilot changes to artwork", () => {
    const pilot = launchedPilot("wrp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "approval-plain", "plain_text");
    expect(() => assertWarmReconnectPilotFingerprints(pilot)).not.toThrow();
    pilot.contentMode = "artwork_html";
    expect(() => assertWarmReconnectPilotFingerprints(pilot)).toThrow();
  });

  it("executes five frozen revised-design recipients with distinct production links and exact CID assets", async () => {
    const pilot = launchedPilot("wrp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "approval-design", "approved_design_v2");
    expect(pilot.artworkEmailApproval?.attested).toBe(true);
    expect(pilot.gates.find((gate) => gate.id === "artwork_email_channel_approval")?.status).toBe("verified");
    const baseCampaign = buildWarmReconnectCampaignDraft({
      schemaVersion: 1, sourceOfTruth: "firestore_portfolio_registry", dataClassification: "aggregate_only", readOnly: true,
      outreach: { status: "blocked", eligibleContacts: 0 }, permissions: { contactPointStates: { unknown: 0 }, sourceRecordsWithNoPermissionBasis: 0 },
      totals: { people: 0, contactPoints: 0, emailContactPoints: 0 }, brands: { unassigned: 0 }, freshness: { observedAt: START.toISOString() },
    } as never);
    const capabilitiesSeen = new Set<string>();
    for (const [index, recipient] of pilot.recipients.entries()) {
      const preferenceToken = "p".repeat(42) + index;
      const unsubscribeOnlyToken = "u".repeat(42) + index;
      const deps = dependencies({
        claimNext: vi.fn(async () => ({ kind: "claimed" as const, claim: { ...claimFor(pilot), recipient, email: `person${index + 1}@example.test` } })),
        issueCapabilities: vi.fn(async () => ({ preferenceToken, unsubscribeOnlyToken,
          preferenceFragment: `/preferences#token=${preferenceToken}`, oneClickPath: `/api/crm/warm-reconnect/unsubscribe/${unsubscribeOnlyToken}` })),
        renderMessage: vi.fn(renderWarmReconnectCampaignEmail),
        loadCampaign: vi.fn(async () => ({ ...baseCampaign, review: { ...baseCampaign.review, previewFingerprint: PREVIEW_FINGERPRINT } })),
      });
      const result = await runWarmReconnectPilotExecutor({ uid: "owner-1", pilotId: pilot.pilotId, correlationId: `design-${index}`, log, db, now: RUN_AT, dependencies: deps });
      expect(result).toMatchObject({ outcome: "sent", providerCalled: true });
      expect(deps.beginProviderAttempt).toHaveBeenCalledOnce(); expect(deps.sendMessage).toHaveBeenCalledOnce();
      expect(deps.issueCapabilities).toHaveBeenCalledWith(expect.objectContaining({ recipientId: recipient.recipientId, recipientDecisionId: recipient.decision.decisionId }), db);
      const outbound = vi.mocked(deps.sendMessage).mock.calls[0][1];
      expect(outbound).toMatchObject({
        contentMode: "approved_design_v2", purpose: "campaign", to: `person${index + 1}@example.test`,
        from: "mrosser@rossergallery.com", replyTo: "mrosser@rossergallery.com", senderName: "Marcus Rosser", subject: "A quick hello from Marcus",
      });
      expect(outbound.plainText).toContain(`Hi ${recipient.greetingName},`);
      expect(outbound.html).toContain(`Hi ${recipient.greetingName},`);
      expect(outbound.inlineAssets?.map((asset) => asset.sha256)).toEqual(warmReconnectCampaignAssetManifest().map((asset) => asset.sha256));
      expect(outbound.html).not.toMatch(/mode=qa|\/qa\//);
      const mime = buildWarmReconnectCampaignDeliveryMime(outbound);
      expect(mime.match(/Content-ID:/g)).toHaveLength(3);
      expect(mime).toContain(`List-Unsubscribe: <${outbound.oneClickUnsubscribeUrl}>`);
      capabilitiesSeen.add(outbound.preferencesUrl); capabilitiesSeen.add(outbound.oneClickUnsubscribeUrl);
    }
    expect(capabilitiesSeen.size).toBe(10);
  });

  it("rejects malformed revised CID rendering before sender refresh or provider-inflight marking", async () => {
    const pilot = launchedPilot("wrp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "approval-design", "approved_design_v2");
    const deps = dependencies({
      claimNext: vi.fn(async () => ({ kind: "claimed" as const, claim: claimFor(pilot) })),
      renderMessage: vi.fn(() => ({
        rendererVersion: "warm-reconnect-approved-design-renderer.v1" as const, contentMode: "approved_design_v2" as const, subject: "A quick hello from Marcus",
        html: '<img src="cid:missing@example.test">', plainText: "Invalid rendering", artworkUrl: "", contractFingerprint: `sha256:${"f".repeat(64)}`,
      })),
    });
    const result = await runWarmReconnectPilotExecutor({ uid: "owner-1", pilotId: pilot.pilotId, correlationId: "invalid-design", log, db, now: RUN_AT, dependencies: deps });
    expect(result).toMatchObject({ outcome: "stopped", providerCalled: false, reason: "pre_provider_readiness_failed" });
    expect(deps.resolveAccessToken).not.toHaveBeenCalled(); expect(deps.beginProviderAttempt).not.toHaveBeenCalled();
    expect(deps.sendMessage).not.toHaveBeenCalled(); expect(deps.recordDeliveryUnknown).not.toHaveBeenCalled();
    expect(deps.recordStoppedBeforeProvider).toHaveBeenCalledOnce();
  });

  it("stops before Gmail when the frozen preview or sender readiness drifts", async () => {
    const sendMessage = vi.fn();
    const recordStoppedBeforeProvider = vi.fn(async () => undefined);
    const deps = dependencies({
      loadCampaign: vi.fn(async () => ({
        review: { previewFingerprint: `sha256:${"b".repeat(64)}` },
      } as never)),
      sendMessage,
      recordStoppedBeforeProvider,
    });
    const result = await runWarmReconnectPilotExecutor({
      uid: "owner-1",
      pilotId: "wrp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      correlationId: "correlation-1",
      log,
      db,
      now: RUN_AT,
      dependencies: deps,
    });
    expect(result).toMatchObject({
      outcome: "stopped",
      providerCalled: false,
      reason: "pre_provider_readiness_failed",
    });
    expect(recordStoppedBeforeProvider).toHaveBeenCalledOnce();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("classifies every Gmail exception as delivery_unknown and never retries", async () => {
    const sendMessage = vi.fn(async () => {
      throw new Error("connection closed after request write");
    });
    const recordDeliveryUnknown = vi.fn(async () => ({ alreadySent: false }));
    const recordSent = vi.fn();
    const deps = dependencies({ sendMessage, recordDeliveryUnknown, recordSent });
    const result = await runWarmReconnectPilotExecutor({
      uid: "owner-1",
      pilotId: "wrp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      correlationId: "correlation-1",
      log,
      db,
      now: RUN_AT,
      dependencies: deps,
    });
    expect(result).toMatchObject({
      outcome: "delivery_unknown",
      providerCalled: true,
      reconciliationRequired: false,
    });
    expect(sendMessage).toHaveBeenCalledOnce();
    expect(recordDeliveryUnknown).toHaveBeenCalledOnce();
    expect(recordSent).not.toHaveBeenCalled();
  });

  it("blocks a second pilot for the same person and email after an ambiguous first outcome", async () => {
    const firstPilot = launchedPilot();
    const firstBinding = reservationBindingFor(firstPilot);
    const firstSend = vi.fn(async () => {
      throw new Error("provider response lost");
    });
    const first = await runWarmReconnectPilotExecutor({
      uid: "owner-1",
      pilotId: firstPilot.pilotId,
      correlationId: "correlation-1",
      log,
      db,
      now: RUN_AT,
      dependencies: dependencies({
        claimNext: vi.fn(async () => ({
          kind: "claimed" as const,
          claim: claimFor(firstPilot),
        })),
        sendMessage: firstSend,
      }),
    });
    expect(first).toMatchObject({
      outcome: "delivery_unknown",
      providerCalled: true,
    });
    expect(firstSend).toHaveBeenCalledOnce();

    const secondPilot = launchedPilot(
      "wrp_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      "approval-2"
    );
    const conflict = reconcileWarmReconnectInvitationReservation(
      invitationLedger(firstBinding, "delivery_unknown"),
      reservationBindingFor(secondPilot)
    );
    expect(conflict).toEqual({
      action: "conflict",
      reason: "cross_pilot_one_time_invitation_conflict",
    });

    const secondSend = vi.fn();
    const secondCapabilities = vi.fn();
    const second = await runWarmReconnectPilotExecutor({
      uid: "owner-1",
      pilotId: secondPilot.pilotId,
      correlationId: "correlation-2",
      log,
      db,
      now: RUN_AT,
      dependencies: dependencies({
        claimNext: vi.fn(async () => ({
          kind: "stopped" as const,
          reason:
            conflict.action === "conflict"
              ? conflict.reason
              : "unexpected_reservation",
        })),
        issueCapabilities: secondCapabilities,
        sendMessage: secondSend,
      }),
    });
    expect(second).toEqual({
      ok: true,
      outcome: "stopped",
      providerCalled: false,
      reason: "cross_pilot_one_time_invitation_conflict",
    });
    expect(secondCapabilities).not.toHaveBeenCalled();
    expect(secondSend).not.toHaveBeenCalled();
  });

  it("returns cadence waits without issuing capabilities or calling Gmail", async () => {
    const issueCapabilities = vi.fn();
    const sendMessage = vi.fn();
    const deps = dependencies({
      claimNext: vi.fn(async () => ({ kind: "waiting" as const, retryAfterMs: 42_000 })),
      issueCapabilities,
      sendMessage,
    });
    const result = await runWarmReconnectPilotExecutor({
      uid: "owner-1",
      pilotId: "wrp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      correlationId: "correlation-1",
      log,
      db,
      now: RUN_AT,
      dependencies: deps,
    });
    expect(result).toEqual({
      ok: true,
      outcome: "waiting",
      providerCalled: false,
      retryAfterMs: 42_000,
    });
    expect(issueCapabilities).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
  });
});
