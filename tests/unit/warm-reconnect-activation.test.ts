import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api/handler";
import {
  assertWarmReconnectStopBoundary,
  canReleaseWarmReconnectInitialPilotLock,
  computeWarmReconnectPilotFingerprints,
  buildWarmReconnectPilotEmailPreview,
  createWarmReconnectPilot,
  decideWarmReconnectPilotApproval,
  decideWarmReconnectRecipient,
  isWarmReconnectPilotApprovalReplay,
  isWarmReconnectPilotLaunchReplay,
  isWarmReconnectRecipientDecisionReplay,
  requestWarmReconnectPilotLaunch,
  WARM_RECONNECT_EXECUTION_POLICY,
} from "@/lib/crm/warm-reconnect-activation";
import {
  assertWarmReconnectInitialPilotLock,
  reconcileWarmReconnectOperationReplay,
  resolveWarmReconnectLegacyDncOrgId,
  sourceEvidenceFromDoc,
} from "@/lib/crm/warm-reconnect-repository";
import type {
  CreateWarmReconnectPilotRequest,
  WarmReconnectCandidate,
  WarmReconnectPilot,
} from "@/lib/crm/warm-reconnect-activation-types";
import { WARM_RECONNECT_CAMPAIGN_VERSION } from "@/lib/crm/warm-reconnect-types";

const PREVIEW_FINGERPRINT = `sha256:${"a".repeat(64)}`;

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

function request(
  overrides: Partial<Extract<CreateWarmReconnectPilotRequest, { tranche: "initial_5" }>> = {}
): CreateWarmReconnectPilotRequest {
  return {
    idempotencyKey: "pilot-1",
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
      legalEntity: "Rosser Gallery LLC",
      replyTo: "marcus@example.com",
      physicalPostalAddress: "2505 N Tonti St, New Orleans, LA 70117",
      businessId: "rosser_nft_gallery",
      profileId: "rosser_gallery_send",
    },
    artworkEmailApproval: {
      approvedForThisEmailCampaign: true,
      evidenceNote: "Approved by the artist for this exact campaign.",
    },
    ...overrides,
  };
}

function create(overrides: { candidates?: WarmReconnectCandidate[]; googleReady?: boolean; request?: CreateWarmReconnectPilotRequest; fromEmail?: string } = {}) {
  return createWarmReconnectPilot({
    pilotId: "pilot-1",
    workspaceId: "workspace-1",
    ownerUid: "owner-1",
    legacyDncOrgId: "org-1",
    request: overrides.request || request(),
    candidates: overrides.candidates || [1, 2, 3, 4, 5].map(candidate),
    googleReady: overrides.googleReady ?? true,
    fromEmail: overrides.fromEmail || "mrosser@rossergallery.com",
    accountId: "google-account-1",
    preferenceOrigin: "https://leadflow-review.web.app",
    now: new Date("2026-08-12T12:00:00.000Z"),
  });
}

function attestAll(pilot: WarmReconnectPilot): WarmReconnectPilot {
  let next = pilot;
  for (const recipient of pilot.recipients) {
    next = decideWarmReconnectRecipient({
      pilot: next,
      recipientId: recipient.recipientId,
      decisionId: `decision-${recipient.recipientId}`,
      request: {
        decision: "attest_relationship",
        expectedCandidateFingerprint: recipient.candidateFingerprint,
        personallyRecognizedRelationship: true,
        oneTimeReconnectionInvitationOnly: true,
        sourceEvidenceRefs: [...recipient.decision.sourceEvidenceRefs],
        note: "I personally recognize this relationship and source evidence.",
      },
      googleReady: true,
      now: new Date("2026-08-12T13:00:00.000Z"),
    });
  }
  return next;
}

function approve(pilot: WarmReconnectPilot, now = new Date("2026-08-12T14:00:00.000Z"), confirmationOverrides: Record<string, unknown> = {}) {
  return decideWarmReconnectPilotApproval({
    pilot,
    approvalId: "approval-1",
    googleReady: true,
    now,
    request: {
      decision: "approve",
      expectedArtifactFingerprint: pilot.fingerprints.artifactFingerprint,
      expectedAudienceFingerprint: pilot.fingerprints.audienceFingerprint,
      expectedActionFingerprint: pilot.fingerprints.actionFingerprint,
      approvalScope: pilot.tranche === "follow_on" ? "exact_batch_one_time_reconnection_emails" : "exact_five_one_time_reconnection_emails",
      confirmations: {
        senderLegalIdentityVerified: true,
        physicalPostalAddressVerified: true,
        preferencesAndUnsubscribeVerified: true,
        suppressionLedgerVerified: true,
        spfDkimDmarcVerified: true,
        replyToMonitored: true,
        ...((pilot.contentMode ?? "artwork_html") === "artwork_html" ? { artworkApprovedForEmail: true as const } : {}),
        exactAudienceReviewed: true,
        ...confirmationOverrides,
      },
      note: "Approved for this exact five-person pilot only.",
    },
  });
}

describe("warm reconnect activation state machine", () => {
  it.each([1, 4, 10, 11, 20])("requires fresh exact audience approval and the batch launch acknowledgement for %i follow-on recipients", (size) => {
    const candidates = Array.from({ length: size }, (_, index) => candidate(index + 20));
    const pilot = createWarmReconnectPilot({
      pilotId: "follow-on", workspaceId: "workspace-1", ownerUid: "owner-1", legacyDncOrgId: "org-1",
      googleReady: true, preferenceOrigin: "https://leadflow-review.web.app", fromEmail: "mrosser@rossergallery.com",
      accountId: "google-account-1", followOnNotBeforeMs: Date.parse("2026-08-12T11:59:00.000Z"),
      candidates, now: new Date("2026-08-12T12:00:00.000Z"),
      request: { ...request(), tranche: "follow_on", parentPilotId: "completed-parent", batchSequence: 1,
        recipientCap: size, candidateRecipientIds: candidates.map(row => row.recipientId) },
    });
    expect(pilot.approval).toBeNull();
    expect(pilot.recipients.every(row => !row.decision.relationshipAttested)).toBe(true);
    expect(() => approve(pilot)).toThrow(/relationships must be attested/);
    const approved = approve(attestAll(pilot));
    expect(approved.approval?.approvalScope).toBe("exact_batch_one_time_reconnection_emails");
    const launchRequest = { approvalId: approved.approval!.approvalId,
      expectedArtifactFingerprint: approved.fingerprints.artifactFingerprint,
      expectedAudienceFingerprint: approved.fingerprints.audienceFingerprint,
      expectedActionFingerprint: approved.fingerprints.actionFingerprint };
    expect(() => requestWarmReconnectPilotLaunch({ pilot: approved, googleReady: true,
      now: new Date("2026-08-12T14:01:00.000Z"), request: { ...launchRequest, acknowledgeLaunchAuthorizesExactFiveEmailSend: true },
    })).toThrow(/exact batch scope/);
    expect(requestWarmReconnectPilotLaunch({ pilot: approved, googleReady: true,
      now: new Date("2026-08-12T14:01:00.000Z"), request: { ...launchRequest, acknowledgeLaunchAuthorizesExactBatchEmailSend: true },
    }).status).toBe("launch_requested");
  });

  it("binds the approved inline design to named greetings while retaining every activation gate", () => {
    const candidates = [1, 2, 3, 4, 5].map(candidate);
    candidates[0].displayName = "alex Example";
    const approvedDesignRequest = request({
      contentMode: "approved_design_v2",
      sender: { ...request().sender, legalEntity: "Marcus Rosser / Rosser Gallery", replyTo: "mrosser@rossergallery.com" },
    });
    const draft = create({ candidates, request: approvedDesignRequest });
    expect(draft.contentMode).toBe("approved_design_v2");
    expect(draft.recipients[0].greetingName).toBe("Alex");
    expect(draft.recipients.every((row) => row.decision.permissionState === "unknown")).toBe(true);
    expect(draft.gates).toHaveLength(9);
    expect(draft.gates.find((row) => row.id === "artwork_email_channel_approval")?.status).toBe("pending_approval");
    expect(() => create({ request: { ...approvedDesignRequest, artworkEmailApproval: undefined } })).toThrow("requires artwork approval");
    expect(() => create({ request: { ...approvedDesignRequest, sender: { ...approvedDesignRequest.sender, replyTo: "other@example.test" } } })).toThrow("reviewed Gallery sender");
    const attested = attestAll(draft);
    expect(() => approve(attested)).toThrow("Every activation gate must be verified");
    for (const key of ["spfDkimDmarcVerified", "physicalPostalAddressVerified", "preferencesAndUnsubscribeVerified", "suppressionLedgerVerified", "replyToMonitored", "artworkApprovedForEmail"]) {
      expect(() => approve(attested, undefined, { artworkApprovedForEmail: true, [key]: undefined })).toThrow("Every activation gate must be verified");
    }
    const approved = approve(attested, undefined, { artworkApprovedForEmail: true });
    expect(approved.status).toBe("approved");
    const preview = buildWarmReconnectPilotEmailPreview(approved)!;
    expect(preview.greetingName).toBe("Alex");
    expect(preview.subject).toBe("A quick hello from Marcus");
    expect(preview.html).toContain("Hi Alex,");
    expect(preview.html).toContain("data:image/jpeg;base64,");
    expect(preview.html).not.toMatch(/\shref=|\bcid:|mode=qa|\/qa\//i);
    expect(preview.plainText).toContain("Hi Alex,");
    const ordinary = create({ request: { ...approvedDesignRequest, contentMode: "preference_buttons", artworkEmailApproval: undefined } });
    expect(ordinary.fingerprints.artifactFingerprint).not.toBe(draft.fingerprints.artifactFingerprint);
    const changedGreeting = structuredClone(approved);
    changedGreeting.recipients[0].greetingName = "Different";
    expect(computeWarmReconnectPilotFingerprints(changedGreeting).audienceFingerprint).not.toBe(approved.fingerprints.audienceFingerprint);
  });

  it("freezes capitalized first-name greetings without changing candidate names or permissions", () => {
    const candidates = [1, 2, 3, 4, 5].map(candidate);
    candidates[0].displayName = "cody lestelle w @Example";
    const buttons = create({ candidates, request: request({ contentMode: "preference_buttons", artworkEmailApproval: undefined }) });
    expect(buttons.recipients[0].greetingName).toBe("Cody");
    expect(candidates[0].displayName).toBe("cody lestelle w @Example");
    expect(buttons.recipients[0].decision.permissionState).toBe("unknown");
    expect(buttons.recipients[0].decision.relationshipAttested).toBe(false);
    expect(buttons.artworkEmailApproval).toBeNull();
    expect(buttons.gates).toHaveLength(8);
    expect(() => approve(buttons)).toThrow("All five recipient relationships");
    const attested = attestAll(buttons);
    for (const key of ["spfDkimDmarcVerified", "physicalPostalAddressVerified", "preferencesAndUnsubscribeVerified", "suppressionLedgerVerified", "replyToMonitored"]) {
      expect(() => approve(attested, undefined, { [key]: undefined })).toThrow("Every activation gate must be verified");
    }
    const approved = approve(attested);
    expect(approved.status).toBe("approved");
    expect(approved.fingerprints.artifactFingerprint).not.toBe(create({ request: request({ contentMode: "plain_text", artworkEmailApproval: undefined }) }).fingerprints.artifactFingerprint);
    expect(() => create({ request: request({ contentMode: "preference_buttons" }) })).toThrow("formats without artwork must omit it");
    expect(() => approve(attested, undefined, { artworkApprovedForEmail: true })).toThrow("must omit artwork confirmation");
  });
  it("creates and approves plain text without an artwork attestation, retaining every other gate", () => {
    const plain = create({ request: request({ contentMode: "plain_text", artworkEmailApproval: undefined }) });
    expect(plain.contentMode).toBe("plain_text");
    expect(plain.artworkEmailApproval).toBeNull();
    expect(plain.gates).toHaveLength(8);
    expect(plain.gates.some((gate) => gate.id === "artwork_email_channel_approval")).toBe(false);
    expect(() => approve(plain)).toThrow("All five recipient relationships");
    const approved = approve(attestAll(plain));
    expect(approved.status).toBe("approved");
    expect(approved.gates.every((gate) => gate.status === "verified")).toBe(true);
    const artwork = create();
    expect(artwork.contentMode).toBe("artwork_html");
    expect(artwork.gates.some((gate) => gate.id === "artwork_email_channel_approval")).toBe(true);
    expect(plain.fingerprints.artifactFingerprint).not.toBe(artwork.fingerprints.artifactFingerprint);
    expect(plain.fingerprints.actionFingerprint).not.toBe(artwork.fingerprints.actionFingerprint);
    expect(plain.fingerprints.audienceFingerprint).toBe(artwork.fingerprints.audienceFingerprint);
    expect(() => computeWarmReconnectPilotFingerprints({ ...approved, contentMode: "artwork_html" }))
      .toThrow("Artwork approval must match");
  });

  it("rejects absent artwork approval in legacy/artwork mode and rejects false artwork approval in plain mode", () => {
    for (const contentMode of [undefined, "artwork_html"] as const) {
      expect(() => create({ request: request({ contentMode, artworkEmailApproval: undefined }) }))
        .toThrow("Artwork mode requires artwork approval");
    }
    expect(() => create({ request: request({ contentMode: "plain_text" }) }))
      .toThrow("formats without artwork must omit it");
    expect(() => create({ request: request({ contentMode: "unknown" as never }) }))
      .toThrow("Invalid warm reconnect content mode");
  });

  it("requires actual artwork confirmation for artwork and retains safety confirmations for plain text", () => {
    const artwork = attestAll(create());
    expect(() => approve(artwork, undefined, { artworkApprovedForEmail: undefined }))
      .toThrow("Every activation gate must be verified");
    const plain = attestAll(create({ request: request({ contentMode: "plain_text", artworkEmailApproval: undefined }) }));
    expect(() => approve(plain, undefined, { artworkApprovedForEmail: true }))
      .toThrow("Approval for a format without artwork must omit artwork confirmation");
    for (const confirmation of ["suppressionLedgerVerified", "preferencesAndUnsubscribeVerified", "physicalPostalAddressVerified", "exactAudienceReviewed"]) {
      expect(() => approve(plain, undefined, { [confirmation]: undefined }))
        .toThrow("Every activation gate must be verified");
    }
  });

  it("accepts only the dedicated RT sending profile and exact RT account address", () => {
    const rtRequest = request({ sender: { ...request().sender, businessId: "rt_solutions", profileId: "rt_solutions_send", replyTo: "mrosser@rt.solutions", legalEntity: "RT.Solutions" } });
    expect(create({ request: rtRequest, fromEmail: "mrosser@rt.solutions" }).sender.profileId)
      .toBe("rt_solutions_send");
    expect(() => create({ request: { ...rtRequest, sender: { ...rtRequest.sender, profileId: "rt_solutions_work" as never } }, fromEmail: "mrosser@rt.solutions" }))
      .toThrow(ApiError);
    expect(() => create({ request: rtRequest, fromEmail: "wrong@example.com" })).toThrow(ApiError);
  });

  it.each(["old-work-profile", "wrong-sender"])("rejects Gallery %s when creating a pilot", (kind) => {
    const input = request();
    if (kind === "old-work-profile") input.sender.profileId = "rosser_gallery_work" as never;
    expect(() => createWarmReconnectPilot({
      pilotId: "pilot-1", workspaceId: "workspace-1", ownerUid: "owner-1", legacyDncOrgId: "org-1",
      request: input, candidates: [1, 2, 3, 4, 5].map(candidate), googleReady: true,
      fromEmail: kind === "wrong-sender" ? "personal@example.com" : "mrosser@rossergallery.com",
      accountId: "gallery-send-account", preferenceOrigin: "https://leadflow-review.web.app",
    })).toThrow(ApiError);
  });
  it("creates only an exact five-person first tranche without duplicating PII", () => {
    const pilot = create();

    expect(pilot.status).toBe("needs_recipient_review");
    expect(pilot.recipients).toHaveLength(5);
    expect(new Set(pilot.recipients.map((value) => value.personId)).size).toBe(5);
    expect(new Set(pilot.recipients.map((value) => value.emailKey)).size).toBe(5);
    expect(pilot.recipients[0]).not.toHaveProperty("email");
    expect(pilot.recipients[0]).not.toHaveProperty("displayName");
    expect(JSON.stringify(pilot)).not.toContain("person1@example.com");
    expect(pilot.availableActions).toMatchObject({
      canReviewRecipients: true,
      canApprove: false,
      canLaunch: false,
      launchAuthorizesExactProviderExecution: true,
    });

    expect(() => create({ candidates: [1, 2, 3, 4].map(candidate) })).toThrow(
      ApiError
    );
    expect(() => create({ candidates: [1, 2, 3, 4, 5, 6].map(candidate) })).toThrow(
      /exactly five/
    );
  });

  it("binds the initial campaign to one exact pilot and a server-owned suppression workspace", () => {
    expect(
      resolveWarmReconnectLegacyDncOrgId(
        "owner-1",
        "workspace_default_owner-1"
      )
    ).toBe("workspace_default_owner-1");
    expect(() =>
      resolveWarmReconnectLegacyDncOrgId("owner-1", "workspace_default_other-owner")
    ).toThrow(/server-owned suppression workspace/);

    const lock = {
      schemaVersion: 1,
      campaignId: "marcus-warm-reconnect",
      campaignVersion: WARM_RECONNECT_CAMPAIGN_VERSION,
      tranche: "initial_5",
      state: "active",
      pilotId: "pilot-first",
    };
    expect(() => assertWarmReconnectInitialPilotLock(lock, "pilot-first")).not.toThrow();
    expect(() => assertWarmReconnectInitialPilotLock(lock, "pilot-second")).toThrow(
      /initial warm reconnect cohort already exists/
    );
    expect(() =>
      assertWarmReconnectInitialPilotLock(
        { ...lock, state: "released_before_provider" },
        "pilot-second"
      )
    ).not.toThrow();
  });

  it("bounds imported source evidence before it can enter a pilot document", () => {
    expect(
      sourceEvidenceFromDoc({
        id: "source-1",
        data: () => ({
          sourceSystem: "google_people",
          permissionBasis: "none",
          observedAt: "2026-08-01T00:00:00.000Z",
        }),
      } as never)
    ).toMatchObject({
      evidenceRef: "crm_source_records/source-1",
      sourceSystem: "google_people",
      permissionBasis: "none",
    });
    expect(() =>
      sourceEvidenceFromDoc({
        id: "source-1",
        data: () => ({ sourceSystem: "google_people\nforged", permissionBasis: "none" }),
      } as never)
    ).toThrow(/unsupported identifier or value/);
    expect(() =>
      sourceEvidenceFromDoc({
        id: "x".repeat(161),
        data: () => ({ sourceSystem: "google_people", permissionBasis: "none" }),
      } as never)
    ).toThrow(/unsupported identifier or value/);
  });

  it("keeps unknown permission explicit after a personal-relationship attestation", () => {
    const first = create();
    const decided = decideWarmReconnectRecipient({
      pilot: first,
      recipientId: first.recipients[0].recipientId,
      decisionId: "decision-1",
      request: {
        decision: "attest_relationship",
        expectedCandidateFingerprint: first.recipients[0].candidateFingerprint,
        personallyRecognizedRelationship: true,
        oneTimeReconnectionInvitationOnly: true,
        sourceEvidenceRefs: [...first.recipients[0].decision.sourceEvidenceRefs],
        note: "Recognized relationship for one invitation only.",
      },
      googleReady: true,
    });

    expect(decided.recipients[0].decision).toMatchObject({
      status: "eligible_one_time_reconnection",
      relationshipAttested: true,
      permissionState: "unknown",
    });
    expect(decided.recipients[0].decision.permissionState).not.toBe("opted_in");
  });

  it("requires all gates, binds immutable fingerprints, and expires approval after 24 hours", () => {
    const reviewed = attestAll(create());
    expect(reviewed.status).toBe("needs_campaign_approval");
    expect(reviewed.availableActions.canApprove).toBe(true);

    const approved = approve(reviewed);
    expect(approved.status).toBe("approved");
    expect(approved.gates.every((gate) => gate.status === "verified")).toBe(true);
    expect(approved.availableActions.canLaunch).toBe(true);
    expect(approved.approval?.expiresAt).toBe("2026-08-13T14:00:00.000Z");
    expect(approved.approval).toMatchObject(approved.fingerprints);

    const changedAddress = createWarmReconnectPilot({
      pilotId: "pilot-1",
      workspaceId: "workspace-1",
      ownerUid: "owner-1",
      legacyDncOrgId: "org-1",
      request: request({
        sender: {
          ...request().sender,
          physicalPostalAddress: "A different verified postal address",
        },
      }),
      candidates: [1, 2, 3, 4, 5].map(candidate),
      googleReady: true,
      fromEmail: "mrosser@rossergallery.com",
      accountId: "google-account-1",
      preferenceOrigin: "https://leadflow-review.web.app",
    });
    expect(changedAddress.fingerprints.artifactFingerprint).not.toBe(
      create().fingerprints.artifactFingerprint
    );

    expect(() =>
      requestWarmReconnectPilotLaunch({
        pilot: approved,
        googleReady: true,
        now: new Date("2026-08-13T14:00:00.001Z"),
        request: {
          approvalId: approved.approval!.approvalId,
          expectedArtifactFingerprint: approved.fingerprints.artifactFingerprint,
          expectedAudienceFingerprint: approved.fingerprints.audienceFingerprint,
          expectedActionFingerprint: approved.fingerprints.actionFingerprint,
          acknowledgeLaunchAuthorizesExactFiveEmailSend: true,
        },
      })
    ).toThrow(/Approval or Google readiness changed/);
  });

  it("binds one-at-a-time cadence, receipt, stop, and ambiguity policy into approval", () => {
    const pilot = create();
    const drifted = computeWarmReconnectPilotFingerprints(pilot, {
      ...WARM_RECONNECT_EXECUTION_POLICY,
      minimumCadenceMs: 30_000,
    } as unknown as typeof WARM_RECONNECT_EXECUTION_POLICY);
    expect(drifted.actionFingerprint).not.toBe(pilot.fingerprints.actionFingerprint);
    expect(drifted.artifactFingerprint).toBe(pilot.fingerprints.artifactFingerprint);
    expect(drifted.audienceFingerprint).toBe(pilot.fingerprints.audienceFingerprint);

    const implementationDrift = computeWarmReconnectPilotFingerprints(
      pilot,
      WARM_RECONNECT_EXECUTION_POLICY,
      {
        renderer: `sha256:${"d".repeat(64)}`,
        mime: `sha256:${"e".repeat(64)}`,
      }
    );
    expect(implementationDrift.artifactFingerprint).not.toBe(
      pilot.fingerprints.artifactFingerprint
    );
    expect(implementationDrift.actionFingerprint).not.toBe(
      pilot.fingerprints.actionFingerprint
    );
  });

  it("keeps approval and launch separate; launch only records a request", () => {
    const approved = approve(attestAll(create()));
    expect(approved.launchRequestedAt).toBeNull();

    const launched = requestWarmReconnectPilotLaunch({
      pilot: approved,
      googleReady: true,
      now: new Date("2026-08-12T15:00:00.000Z"),
      request: {
        approvalId: approved.approval!.approvalId,
        expectedArtifactFingerprint: approved.fingerprints.artifactFingerprint,
        expectedAudienceFingerprint: approved.fingerprints.audienceFingerprint,
        expectedActionFingerprint: approved.fingerprints.actionFingerprint,
        acknowledgeLaunchAuthorizesExactFiveEmailSend: true,
      },
    });

    expect(launched.status).toBe("launch_requested");
    expect(launched.launchRequestedAt).toBe("2026-08-12T15:00:00.000Z");
    expect(launched.availableActions).toMatchObject({
      canLaunch: false,
      launchAuthorizesExactProviderExecution: true,
    });
    expect(launched).not.toHaveProperty("providerReceipt");
    expect(
      isWarmReconnectPilotLaunchReplay({
        pilot: launched,
        request: {
          approvalId: approved.approval!.approvalId,
          expectedArtifactFingerprint: approved.fingerprints.artifactFingerprint,
          expectedAudienceFingerprint: approved.fingerprints.audienceFingerprint,
          expectedActionFingerprint: approved.fingerprints.actionFingerprint,
          acknowledgeLaunchAuthorizesExactFiveEmailSend: true,
        },
      })
    ).toBe(true);
  });

  it("allows a stop before the provider boundary and refuses an in-flight stop", () => {
    expect(() =>
      assertWarmReconnectStopBoundary(
        { activeReceiptId: "receipt-1" },
        { receiptId: "receipt-1", status: "capabilities_prepared" }
      )
    ).not.toThrow();
    expect(() =>
      assertWarmReconnectStopBoundary(
        { activeReceiptId: "receipt-1" },
        { receiptId: "receipt-1", status: "provider_inflight" }
      )
    ).toThrow(/already in flight or unresolved/);
    expect(() =>
      assertWarmReconnectStopBoundary(
        { activeReceiptId: "receipt-1" },
        undefined
      )
    ).toThrow(/must be reconciled/);

    expect(
      canReleaseWarmReconnectInitialPilotLock({
        executorState: {
          activeReceiptId: "receipt-1",
          sentCount: 0,
          lastProviderAttemptAtMs: null,
        },
        receipts: [
          {
            receiptId: "receipt-1",
            status: "capabilities_prepared",
            providerStartedAtMs: null,
          },
        ],
      })
    ).toBe(true);
    expect(
      canReleaseWarmReconnectInitialPilotLock({
        executorState: {
          activeReceiptId: null,
          sentCount: 1,
          lastProviderAttemptAtMs: Date.parse("2026-08-12T14:00:00.000Z"),
        },
        receipts: [{ receiptId: "receipt-1", status: "sent" }],
      })
    ).toBe(false);
    expect(
      canReleaseWarmReconnectInitialPilotLock({
        executorState: {
          activeReceiptId: null,
          sentCount: 0,
          lastProviderAttemptAtMs: Date.parse("2026-08-12T14:00:00.000Z"),
        },
        receipts: [{ receiptId: "receipt-1", status: "delivery_unknown" }],
      })
    ).toBe(false);
  });

  it("recognizes semantic retries and rejects conflicting idempotency reuse", () => {
    const created = create();
    const recipient = created.recipients[0];
    const decisionRequest = {
      decision: "attest_relationship" as const,
      expectedCandidateFingerprint: recipient.candidateFingerprint,
      personallyRecognizedRelationship: true as const,
      oneTimeReconnectionInvitationOnly: true as const,
      sourceEvidenceRefs: [...recipient.decision.sourceEvidenceRefs],
      note: "Recognized relationship for one invitation.",
    };
    const decided = decideWarmReconnectRecipient({
      pilot: created,
      recipientId: recipient.recipientId,
      decisionId: "decision-1",
      request: decisionRequest,
      googleReady: true,
    });
    expect(
      isWarmReconnectRecipientDecisionReplay({
        pilot: decided,
        recipientId: recipient.recipientId,
        request: decisionRequest,
      })
    ).toBe(true);
    expect(
      isWarmReconnectRecipientDecisionReplay({
        pilot: decided,
        recipientId: recipient.recipientId,
        request: { ...decisionRequest, note: "Different note" },
      })
    ).toBe(false);

    const reviewed = attestAll(create());
    const approved = approve(reviewed);
    const approvalRequest = {
      decision: "approve" as const,
      expectedArtifactFingerprint: reviewed.fingerprints.artifactFingerprint,
      expectedAudienceFingerprint: reviewed.fingerprints.audienceFingerprint,
      expectedActionFingerprint: reviewed.fingerprints.actionFingerprint,
      approvalScope: "exact_five_one_time_reconnection_emails" as const,
      confirmations: {
        senderLegalIdentityVerified: true as const,
        physicalPostalAddressVerified: true as const,
        preferencesAndUnsubscribeVerified: true as const,
        suppressionLedgerVerified: true as const,
        spfDkimDmarcVerified: true as const,
        replyToMonitored: true as const,
        artworkApprovedForEmail: true as const,
        exactAudienceReviewed: true as const,
      },
      note: "Approved for this exact five-person pilot only.",
    };
    expect(
      isWarmReconnectPilotApprovalReplay({
        pilot: approved,
        request: approvalRequest,
        now: new Date("2026-08-12T15:00:00.000Z"),
      })
    ).toBe(true);

    expect(
      reconcileWarmReconnectOperationReplay(
        { requestFingerprint: PREVIEW_FINGERPRINT, resultPilot: approved },
        PREVIEW_FINGERPRINT
      )
    ).toEqual(approved);
    expect(() =>
      reconcileWarmReconnectOperationReplay(
        { requestFingerprint: PREVIEW_FINGERPRINT, resultPilot: approved },
        `sha256:${"b".repeat(64)}`
      )
    ).toThrow(/idempotency key was already used differently/);
  });
});
