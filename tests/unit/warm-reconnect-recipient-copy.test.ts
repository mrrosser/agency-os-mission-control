import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Firestore } from "firebase-admin/firestore";
import {
  assertWarmReconnectPilotFingerprints,
  buildWarmReconnectPilotEmailPreview,
  buildWarmReconnectPilotRecipientEmailPreviews,
  computeWarmReconnectPilotFingerprints,
  createWarmReconnectPilot,
  decideWarmReconnectPilotApproval,
  decideWarmReconnectRecipient,
  isWarmReconnectPilotApprovalReplay,
  materializeWarmReconnectPilot,
  requestWarmReconnectPilotLaunch,
  warmReconnectInitialPilotLockId,
} from "@/lib/crm/warm-reconnect-activation";
import type {
  CreateWarmReconnectPilotRequest,
  WarmReconnectCandidate,
  WarmReconnectPilot,
  WarmReconnectPilotApprovalRequest,
  WarmReconnectRecipientCopyInput,
} from "@/lib/crm/warm-reconnect-activation-types";
import { dedupeWarmReconnectCandidates } from "@/lib/crm/warm-reconnect-dedupe";
import { assertWarmReconnectFollowOnContent, warmReconnectBatchReceiptId } from "@/lib/crm/warm-reconnect-batches";
import { warmReconnectInvitationReservationBindingForPilot } from "@/lib/crm/warm-reconnect-invitation-ledger";
import { WARM_RECONNECT_CAMPAIGN_ID, WARM_RECONNECT_CAMPAIGN_VERSION } from "@/lib/crm/warm-reconnect-types";
import {
  applyWarmReconnectRecipientCopy,
  warmReconnectRecipientCopyContentFingerprint,
  warmReconnectRecipientCopyReviewFingerprint,
  warmReconnectRecipientRenderedOutputFingerprint,
} from "@/lib/crm/warm-reconnect-recipient-copy";
import { buildWarmReconnectCampaignDraft } from "@/lib/crm/warm-reconnect";
import { renderWarmReconnectCampaignEmail } from "@/lib/crm/warm-reconnect-campaign-design";

const mocks = vi.hoisted(() => ({ access: vi.fn(), account: vi.fn(), scope: vi.fn(), sender: vi.fn() }));
vi.mock("@/lib/crm/portfolio-registry", () => ({ assertPortfolioRegistryAccess: mocks.access }));
vi.mock("@/lib/google/account-token-store", () => ({ resolveGoogleAccountTokens: mocks.account }));
vi.mock("@/lib/google/oauth", () => ({ isGoogleTokenScopeBoundedForPreset: mocks.scope }));
vi.mock("@/lib/google/gmail-campaign-sender", () => ({ sendWarmReconnectCampaignEmail: mocks.sender }));
import { createWarmReconnectPilotForUid } from "@/lib/crm/warm-reconnect-repository";

const UID = "recipient-copy-owner";
const WORKSPACE = `workspace_default_${UID}`;
const START = new Date("2026-10-19T10:00:00.000Z");
const NOW = new Date("2026-10-19T10:10:00.000Z");
const SHA = `sha256:${"a".repeat(64)}`;
const DEFAULT_OPENING = "It's Marcus Rosser. I wanted to say hello and share a simple way to stay connected with my work.";
const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
type Data = Record<string, unknown>;
type Ref = { path: string; query?: boolean; filters?: Array<[string, unknown]>; cap?: number };

/** In-memory documents and atomic deferred writes; no SDK connection exists. */
function memoryFirestore() {
  const records = new Map<string, Data>();
  const writes: string[] = [];
  const put = (path: string, data: Data) => records.set(path, structuredClone(data));
  const snapshot = (path: string) => ({
    id: path.split("/").at(-1)!, exists: records.has(path),
    data: () => records.has(path) ? structuredClone(records.get(path)!) : undefined,
  });
  function read(ref: Ref) {
    if (!ref.query) return snapshot(ref.path);
    const paths = [...records.keys()].filter(path =>
      path.startsWith(`${ref.path}/`) && !path.slice(ref.path.length + 1).includes("/") &&
      (ref.filters || []).every(([field, value]) => records.get(path)?.[field] === value)
    ).slice(0, ref.cap);
    return { docs: paths.map(snapshot), size: paths.length, empty: paths.length === 0 };
  }
  function reference(path: string) {
    return { path, id: path.split("/").at(-1)!, get: async () => snapshot(path), collection: (name: string) => query(`${path}/${name}`) };
  }
  function query(path: string, filters: Array<[string, unknown]> = [], cap = Infinity) {
    return {
      path, query: true, filters, cap, doc: (id: string) => reference(`${path}/${id}`),
      where: (field: string, op: string, value: unknown) => {
        if (op !== "==") throw new Error(`Unsupported fixture query: ${op}`);
        return query(path, [...filters, [field, value]], cap);
      },
      limit: (n: number) => query(path, filters, n),
      get: async () => read({ path, query: true, filters, cap }),
    };
  }
  const db = {
    collection: (name: string) => query(name),
    getAll: async (...refs: Ref[]) => refs.map(ref => snapshot(ref.path)),
    runTransaction: async (callback: (transaction: unknown) => Promise<unknown>) => {
      const pending: Array<[string, Data]> = [];
      const tx = {
        get: async (ref: Ref) => {
          if (pending.length) throw new Error("Transaction read after write");
          return read(ref);
        },
        set: (ref: Ref, data: Data) => pending.push([ref.path, data]),
        create: (ref: Ref, data: Data) => {
          if (records.has(ref.path) || pending.some(([path]) => path === ref.path)) throw new Error("Document exists");
          pending.push([ref.path, data]);
        },
      };
      const result = await callback(tx);
      for (const [path, data] of pending) { put(path, data); writes.push(path); }
      return result;
    },
  } as unknown as Firestore;
  return { db, records, writes, put };
}

function seedCandidates(memory: ReturnType<typeof memoryFirestore>, offset = 0, count = 20): WarmReconnectCandidate[] {
  const raw = Array.from({ length: count }, (_, index) => {
    const n = offset + index + 1;
    const row = {
      contactPointId: `contact-${n}`, personId: `person-${n}`, displayName: `Person ${n}`,
      email: `person${n}@example.test`, permissionState: "unknown", primary: true,
      evidenceUpdatedAt: START.toISOString(), sourcePersonIds: [`person-${n}`],
      suppressed: false, openImportConflict: false,
      sourceEvidence: [{ evidenceRef: `crm_source_records/source-${n}`, sourceSystem: "google_people", permissionBasis: "none", observedAt: START.toISOString() }],
    };
    memory.put(`crm_contact_points/${row.contactPointId}`, {
      workspaceId: WORKSPACE, personId: row.personId, type: "email", normalizedValue: row.email,
      defaultPermissionState: "unknown", primary: true, updatedAt: START.toISOString(),
    });
    memory.put(`crm_people/${row.personId}`, { displayName: row.displayName });
    memory.put(`crm_source_records/source-${n}`, {
      workspaceId: WORKSPACE, personId: row.personId, contactPointId: row.contactPointId,
      sourceSystem: "google_people", permissionBasis: "none", observedAt: START.toISOString(),
    });
    return row;
  });
  return dedupeWarmReconnectCandidates(WORKSPACE, raw).candidates;
}

function createRequest(candidates: WarmReconnectCandidate[], parent?: WarmReconnectPilot): CreateWarmReconnectPilotRequest {
  const common = {
    idempotencyKey: parent ? "reviewed-follow-on" : "reviewed-initial",
    campaignPreviewFingerprint: SHA,
    contentMode: "approved_design_v2" as const,
    artworkEmailApproval: { approvedForThisEmailCampaign: true as const, evidenceNote: "The existing campaign artwork is approved for email." },
    sender: {
      senderName: "Marcus Rosser", legalEntity: "Marcus Rosser / Rosser Gallery",
      replyTo: "mrosser@rossergallery.com", physicalPostalAddress: "2505 N Tonti St, New Orleans, LA 70117",
      businessId: "rosser_nft_gallery" as const, profileId: "rosser_gallery_send" as const,
    },
  };
  return parent ? {
    ...common, tranche: "follow_on", parentPilotId: parent.pilotId, batchSequence: (parent.batchSequence || 0) + 1,
    recipientCap: candidates.length, candidateRecipientIds: candidates.map(row => row.recipientId),
  } : {
    ...common, tranche: "initial_5", recipientCap: 5,
    candidateRecipientIds: candidates.map(row => row.recipientId) as [string, string, string, string, string],
  };
}

function create(candidates: WarmReconnectCandidate[], request = createRequest(candidates), pilotId = "synthetic-pilot") {
  return createWarmReconnectPilot({
    pilotId, workspaceId: WORKSPACE, ownerUid: UID, legacyDncOrgId: WORKSPACE, request, candidates,
    googleReady: true, fromEmail: "mrosser@rossergallery.com", accountId: "gallery-account",
    preferenceOrigin: "https://leadflow-review.web.app", now: START,
    ...(request.tranche === "follow_on" ? { followOnNotBeforeMs: START.getTime() + 300_000 } : {}),
  });
}

function attest(pilot: WarmReconnectPilot) {
  let next = pilot;
  for (const recipient of pilot.recipients) {
    next = decideWarmReconnectRecipient({
      pilot: next, recipientId: recipient.recipientId, decisionId: `decision-${recipient.recipientId}`,
      googleReady: true, now: START,
      request: {
        decision: "attest_relationship", expectedCandidateFingerprint: recipient.candidateFingerprint,
        personallyRecognizedRelationship: true, oneTimeReconnectionInvitationOnly: true,
        sourceEvidenceRefs: [...recipient.decision.sourceEvidenceRefs], note: "Synthetic relationship evidence reviewed for one invitation.",
      },
    });
  }
  return next;
}

function approvalRequest(pilot: WarmReconnectPilot): Extract<WarmReconnectPilotApprovalRequest, { decision: "approve" }> {
  return {
    decision: "approve", expectedArtifactFingerprint: pilot.fingerprints.artifactFingerprint,
    expectedAudienceFingerprint: pilot.fingerprints.audienceFingerprint, expectedActionFingerprint: pilot.fingerprints.actionFingerprint,
    approvalScope: pilot.tranche === "initial_5" ? "exact_five_one_time_reconnection_emails" : "exact_batch_one_time_reconnection_emails",
    confirmations: {
      senderLegalIdentityVerified: true, physicalPostalAddressVerified: true, preferencesAndUnsubscribeVerified: true,
      suppressionLedgerVerified: true, spfDkimDmarcVerified: true, replyToMonitored: true,
      artworkApprovedForEmail: true, exactAudienceReviewed: true,
    },
    note: "Synthetic exact audience and rendered message reviewed.",
  };
}

function approve(pilot: WarmReconnectPilot, request = approvalRequest(pilot)) {
  return decideWarmReconnectPilotApproval({ pilot, request, approvalId: `approval-${pilot.pilotId}`, googleReady: true, now: START });
}

function launch(pilot: WarmReconnectPilot) {
  return requestWarmReconnectPilotLaunch({
    pilot, googleReady: true, now: START,
    request: {
      approvalId: pilot.approval!.approvalId, expectedArtifactFingerprint: pilot.fingerprints.artifactFingerprint,
      expectedAudienceFingerprint: pilot.fingerprints.audienceFingerprint, expectedActionFingerprint: pilot.fingerprints.actionFingerprint,
      ...(pilot.tranche === "initial_5" ? { acknowledgeLaunchAuthorizesExactFiveEmailSend: true as const } : { acknowledgeLaunchAuthorizesExactBatchEmailSend: true as const }),
    },
  });
}

function seedCompletedParent(memory: ReturnType<typeof memoryFirestore>, personalized = false) {
  const candidates = seedCandidates(memory, 100, 5);
  const request = createRequest(candidates);
  if (personalized) request.recipientCopies = [copyFor(candidates[0])];
  const reviewed = attest(create(candidates, request, "completed-parent"));
  const parent = launch(approve(reviewed, personalized ? reviewApproval(reviewed) : approvalRequest(reviewed)));
  const base = `crm_warm_reconnect_pilots/${parent.pilotId}`;
  memory.put(base, parent as unknown as Data);
  memory.put(`crm_warm_reconnect_campaign_locks/${warmReconnectInitialPilotLockId(WORKSPACE)}`, {
    schemaVersion: 1, workspaceId: WORKSPACE, campaignId: WARM_RECONNECT_CAMPAIGN_ID,
    campaignVersion: WARM_RECONNECT_CAMPAIGN_VERSION, tranche: "initial_5", state: "active", pilotId: parent.pilotId,
  });
  parent.recipients.forEach((recipient, index) => {
    const receiptId = warmReconnectBatchReceiptId(parent, recipient.recipientId);
    const binding = warmReconnectInvitationReservationBindingForPilot(parent, recipient, receiptId);
    const started = START.getTime() + index * 60_000;
    memory.put(`${base}/delivery_receipts/${receiptId}`, {
      schemaVersion: "crm.warm-reconnect-delivery-receipt.v1", ...binding, ...parent.fingerprints,
      ownerUid: UID, recipientId: recipient.recipientId, contactPointId: recipient.contactPointId,
      invitationReservationId: binding.reservationId, status: "sent", claimedAtMs: started, providerStartedAtMs: started,
      sentAtMs: started + 100, providerMessageId: `a${index.toString(16).padStart(15, "0")}`,
      providerThreadId: `b${index.toString(16).padStart(15, "0")}`, correlationId: "synthetic-parent-completion",
    });
    memory.put(`crm_warm_reconnect_invitation_ledger/${binding.reservationId}`, {
      schemaVersion: "crm.warm-reconnect-invitation-ledger.v1", ...binding,
      status: "sent", reservationGeneration: 1, reservedAtMs: started, providerStartedAtMs: started,
      terminalAtMs: started + 100, correlationId: "synthetic-parent-completion",
    });
  });
  memory.put(`${base}/executor/state`, {
    schemaVersion: "crm.warm-reconnect-executor-state.v1", pilotId: parent.pilotId, workspaceId: WORKSPACE,
    activeReceiptId: null, claimedCount: 5, sentCount: 5, lastProviderAttemptAtMs: START.getTime() + 240_000,
    nextEligibleAtMs: START.getTime() + 300_000, halted: false, complete: true,
  });
  return parent;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.clearAllMocks();
  vi.stubEnv("WARM_RECONNECT_PUBLIC_ORIGIN", "https://leadflow-review.web.app");
  mocks.access.mockResolvedValue({ workspaceId: WORKSPACE, role: "owner" });
  mocks.account.mockResolvedValue({ record: { accountId: "gallery-account", tokens: { refreshToken: "synthetic-only", scope: "https://www.googleapis.com/auth/gmail.send", accountEmail: "mrosser@rossergallery.com" } } });
  mocks.scope.mockReturnValue(true);
  mocks.sender.mockRejectedValue(new Error("Provider access is forbidden in this test"));
});

afterEach(() => {
  expect(mocks.sender).not.toHaveBeenCalled();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

function copyFor(candidate: WarmReconnectCandidate, patch: Partial<Omit<WarmReconnectRecipientCopyInput, "expectedContentFingerprint">> = {}): WarmReconnectRecipientCopyInput {
  const content = {
    version: "warm-reconnect-recipient-copy.v1" as const,
    recipientId: candidate.recipientId, personId: candidate.personId, contactPointId: candidate.contactPointId,
    emailKey: candidate.emailKey, expectedCandidateFingerprint: candidate.candidateFingerprint,
    greetingName: "Sky Blue", openingParagraph: "It's Marcus Rosser. We met at the community workshop in May 2025. I wanted to say hello and share a simple way to stay connected with my work.",
    ...patch,
  };
  return { ...content, expectedContentFingerprint: warmReconnectRecipientCopyContentFingerprint(content) };
}

function reviewApproval(pilot: WarmReconnectPilot) {
  const request = approvalRequest(pilot);
  return {
    ...request, expectedRecipientCopyReviewFingerprint: warmReconnectRecipientCopyReviewFingerprint(pilot.recipients),
    confirmations: { ...request.confirmations, exactRecipientCopyReviewed: true as const },
  };
}

function twentyFixture() {
  const memory = memoryFirestore();
  const parent = create(seedCandidates(memory, 100, 5), undefined, "completed-parent");
  const candidates = seedCandidates(memory);
  const request = createRequest(candidates, parent);
  const recipientCopies = [0, 1, 2, 6, 16].map(index => copyFor(candidates[index], {
    greetingName: index === 1 ? "Sky Blue" : index === 6 ? "River Amber" : "Person",
    openingParagraph: index === 6 ? DEFAULT_OPENING : `It's Marcus Rosser. We met at the community workshop number ${index + 1}. I wanted to say hello and share a simple way to stay connected with my work.`,
  }));
  return { memory, parent, candidates, request, recipientCopies,
    pilot: create(candidates, { ...request, recipientCopies }, "reviewed-follow-on") };
}

describe("reviewed recipient copy remains separate from the inherited base campaign", () => {
  it("keeps the historical base artifact, sender, permission, and source data unchanged", () => {
    const f = twentyFixture();
    const baseline = create(f.candidates, f.request, "reviewed-follow-on");
    expect(f.pilot.fingerprints.artifactFingerprint).toBe(baseline.fingerprints.artifactFingerprint);
    expect(f.pilot.fingerprints.artifactFingerprint).toBe(f.parent.fingerprints.artifactFingerprint);
    expect(f.pilot.fingerprints.audienceFingerprint).not.toBe(baseline.fingerprints.audienceFingerprint);
    expect(f.pilot.fingerprints.actionFingerprint).not.toBe(baseline.fingerprints.actionFingerprint);
    expect(() => assertWarmReconnectFollowOnContent(f.parent, f.pilot)).not.toThrow();
    expect(f.pilot.sender).toEqual(baseline.sender);
    expect(f.pilot.preferenceContract).toEqual(baseline.preferenceContract);
    expect(f.pilot.recipients.map(row => row.decision)).toEqual(baseline.recipients.map(row => row.decision));
    expect(f.pilot.recipients.map(row => row.sourceEvidence)).toEqual(baseline.recipients.map(row => row.sourceEvidence));
    expect(f.pilot.approval).toBeNull();
    expect(f.pilot.recipients.every(row => row.decision.permissionState === "unknown")).toBe(true);
    expect(baseline.recipients.every(row => row.recipientCopy === undefined)).toBe(true);
    expect(warmReconnectRecipientCopyReviewFingerprint(baseline.recipients)).toBeUndefined();
    expect(assertWarmReconnectPilotFingerprints(baseline)).toEqual(baseline.fingerprints);
    expect(computeWarmReconnectPilotFingerprints(baseline)).toEqual(baseline.fingerprints);
  });

  it.each(["sender", "preferences", "preview", "artifact"])("still rejects changed inherited %s", field => {
    const f = twentyFixture();
    const changed = structuredClone(f.pilot);
    if (field === "sender") changed.sender.replyTo = "other@example.test";
    if (field === "preferences") changed.preferenceContract.origin = "https://other.example.test";
    if (field === "preview") changed.campaignPreviewFingerprint = `sha256:${"b".repeat(64)}`;
    if (field === "artifact") changed.fingerprints.artifactFingerprint = `sha256:${"b".repeat(64)}`;
    expect(() => assertWarmReconnectFollowOnContent(f.parent, changed)).toThrow();
  });

  it("returns every exact preview, including a late opening and both full-handle greetings", () => {
    const f = twentyFixture();
    const previews = buildWarmReconnectPilotRecipientEmailPreviews(f.pilot);
    expect(previews).toHaveLength(20);
    expect(previews!.map(preview => preview.recipientId)).toEqual(f.candidates.map(candidate => candidate.recipientId));
    expect(previews![1].plainText).toContain("Hi Sky Blue,");
    expect(previews![6].plainText).toContain("Hi River Amber,");
    expect(previews![16].plainText).toContain(f.recipientCopies[4].openingParagraph);
    expect(previews![19].plainText).toContain(DEFAULT_OPENING);
    for (const preview of previews!) {
      expect(buildWarmReconnectPilotEmailPreview(f.pilot, preview.recipientId)!.html).not.toMatch(/\bhref\s*=/i);
      expect(preview.plainText).toContain("This invitation doesn't subscribe you to anything.");
      expect(preview.plainText).toContain("2505 N Tonti St");
    }
    expect(buildWarmReconnectPilotEmailPreview(f.pilot, f.candidates[16].recipientId)).toMatchObject(previews![16]);
  });

  it("changes only the two reviewed text slots and safely renders literal ampersands and replacement syntax", () => {
    const f = twentyFixture();
    const copy = copyFor(f.candidates[0], { greetingName: "Sky & Blue", openingParagraph: "It's Marcus Rosser. We discussed art & the literal phrase $& at a workshop." });
    const baseline = create(f.candidates, f.request);
    const changed = create(f.candidates, { ...f.request, recipientCopies: [copy] });
    const before = buildWarmReconnectPilotEmailPreview(baseline)!;
    const after = buildWarmReconnectPilotEmailPreview(changed)!;
    expect(after.plainText).toBe(before.plainText.replace("Hi Person,", () => "Hi Sky & Blue,").replace(DEFAULT_OPENING, () => copy.openingParagraph));
    const originalParagraph = 'It\'s Marcus Rosser. I wanted to say hello and share a simple way to <strong style="color:#774359">stay connected with my work.</strong>';
    expect(before.html).toContain(originalParagraph);
    expect(after.html).toBe(before.html.replace("Hi Person,", () => "Hi Sky &amp; Blue,").replace(originalParagraph, () => "It&#39;s Marcus Rosser. We discussed art &amp; the literal phrase $&amp; at a workshop."));
    expect(after.subject).toBe(before.subject);
    expect(after.html.match(/src="data:image\//g)).toHaveLength(3);
  });

  it("preserves every opening HTML byte for a greeting-only correction", () => {
    const f = twentyFixture();
    const before = buildWarmReconnectPilotEmailPreview(create(f.candidates, f.request), f.candidates[6].recipientId)!;
    const after = buildWarmReconnectPilotEmailPreview(f.pilot, f.candidates[6].recipientId)!;
    expect(after.html).toBe(before.html.replace("Hi Person,", "Hi River Amber,"));
    expect(after.plainText).toBe(before.plainText.replace("Hi Person,", "Hi River Amber,"));
  });

  it("normalizes only this recipient's capability URLs while preserving CTA choices and copy", () => {
    const { pilot } = twentyFixture();
    const recipient = pilot.recipients[0];
    const campaign = buildWarmReconnectCampaignDraft({
      schemaVersion: 1, sourceOfTruth: "firestore_portfolio_registry", dataClassification: "aggregate_only", readOnly: true,
      outreach: { status: "blocked", eligibleContacts: 0 }, permissions: { contactPointStates: { unknown: 0 }, sourceRecordsWithNoPermissionBasis: 0 },
      totals: { people: 0, contactPoints: 0, emailContactPoints: 0 }, brands: { unassigned: 0 }, freshness: { observedAt: START.toISOString() },
    } as never);
    const render = (preferenceToken: string, unsubscribeToken: string) => {
      const origin = pilot.preferenceContract.origin;
      const preferencesUrl = `${origin}/preferences#token=${preferenceToken}`;
      const unsubscribeUrl = `${origin}/api/crm/warm-reconnect/unsubscribe/${unsubscribeToken}`;
      const rendered = applyWarmReconnectRecipientCopy(renderWarmReconnectCampaignEmail({
        contentMode: "approved_design_v2", campaign, firstName: recipient.greetingName,
        senderName: pilot.sender.senderName, legalEntity: pilot.sender.legalEntity, physicalPostalAddress: pilot.sender.physicalPostalAddress,
        publicOrigin: origin, preferencesUrl, unsubscribeUrl,
      }), recipient);
      return { rendered, preferencesUrl, unsubscribeUrl,
        fingerprint: warmReconnectRecipientRenderedOutputFingerprint(rendered, preferencesUrl, unsubscribeUrl) };
    };
    const first = render("p".repeat(43), "u".repeat(43));
    const second = render("q".repeat(43), "v".repeat(43));
    expect(second.fingerprint).toBe(first.fingerprint);
    expect(first.fingerprint).toBe(recipient.recipientCopy!.renderedOutputFingerprint);
    for (const choice of ["rosser_gallery", "rt_solutions", "both"]) expect(second.rendered.html).toContain(`${"q".repeat(43)}&amp;choice=${choice}`);
    expect(second.rendered.html).not.toContain("p".repeat(43));
    const changedChoice = { ...second.rendered, html: second.rendered.html.replace("&amp;choice=both", "&amp;choice=rosser_gallery") };
    expect(warmReconnectRecipientRenderedOutputFingerprint(changedChoice, second.preferencesUrl, second.unsubscribeUrl)).not.toBe(first.fingerprint);
    const changedText = { ...second.rendered, plainText: `${second.rendered.plainText}\nUnreviewed text` };
    expect(warmReconnectRecipientRenderedOutputFingerprint(changedText, second.preferencesUrl, second.unsubscribeUrl)).not.toBe(first.fingerprint);
  });

  it("materialization preserves saved copies and never creates approval", () => {
    const { pilot } = twentyFixture();
    const original = structuredClone(pilot);
    const result = materializeWarmReconnectPilot(pilot, { googleReady: true, now: NOW });
    expect(result.recipients).toEqual(original.recipients);
    expect(result.fingerprints).toEqual(original.fingerprints);
    expect(result.approval).toBeNull();
    expect(pilot).toEqual(original);
  });
});

describe("recipient copy fails closed on identity, text, or frozen-render drift", () => {
  it.each(["recipientId", "personId", "contactPointId", "emailKey", "expectedCandidateFingerprint"] as const)("rejects a proposed %s mismatch", field => {
    const f = twentyFixture();
    const copy = copyFor(f.candidates[0], { [field]: field.endsWith("Fingerprint") || field === "emailKey" ? `sha256:${"f".repeat(64)}` : "foreign-recipient" });
    expect(() => create(f.candidates, { ...f.request, recipientCopies: [copy] })).toThrow();
  });

  it.each([undefined, `sha256:${"f".repeat(64)}`])("rejects a missing or stale expected content fingerprint: %s", fingerprint => {
    const f = twentyFixture();
    const copy = { ...f.recipientCopies[0], expectedContentFingerprint: fingerprint } as WarmReconnectRecipientCopyInput;
    expect(() => create(f.candidates, { ...f.request, recipientCopies: [copy] })).toThrow();
  });

  it("rejects duplicate, empty, extra-authority, and wrong-design proposals", () => {
    const f = twentyFixture();
    for (const recipientCopies of [[], [f.recipientCopies[0], f.recipientCopies[0]], [{ ...f.recipientCopies[0], subject: "Unauthorized subject" }]]) {
      expect(() => create(f.candidates, { ...f.request, recipientCopies })).toThrow();
    }
    expect(() => create(f.candidates, { ...f.request, contentMode: "artwork_html", recipientCopies: f.recipientCopies })).toThrow();
  });

  it.each([
    "<b>Unsafe</b>", "One\nTwo", " Leading", "Trailing ", "Click https://example.test", "Visit example.test",
    "Hello\u202eWorld", "[recipient]", "x".repeat(601),
  ])("rejects text outside the bounded plain-text contract: %j", openingParagraph => {
    const f = twentyFixture();
    expect(() => copyFor(f.candidates[0], { openingParagraph })).toThrow();
  });

  it.each(["openingParagraph", "greetingName", "contentFingerprint", "implementationFingerprint", "renderedOutputFingerprint", "expectedCandidateFingerprint", "personId"] as const)("rejects stored %s tampering before preview or fingerprint approval", field => {
    const { pilot } = twentyFixture();
    const changed = structuredClone(pilot);
    changed.recipients[0].recipientCopy![field] = field.endsWith("Fingerprint") ? `sha256:${"f".repeat(64)}` : "Changed review text";
    expect(() => assertWarmReconnectPilotFingerprints(changed)).toThrow();
    expect(() => buildWarmReconnectPilotEmailPreview(changed)).toThrow();
  });

  it("rejects deletion of a frozen override and an attempted copy transplant", () => {
    const { pilot } = twentyFixture();
    const removed = structuredClone(pilot);
    delete removed.recipients[0].recipientCopy;
    expect(() => assertWarmReconnectPilotFingerprints(removed)).toThrow();
    const moved = structuredClone(pilot);
    moved.recipients[19].recipientCopy = moved.recipients[0].recipientCopy;
    expect(() => assertWarmReconnectPilotFingerprints(moved)).toThrow();
  });
});

describe("exact recipient copy requires its own explicit approval", () => {
  it("requires relationship attestation and both exact-copy approval fields", () => {
    const { pilot } = twentyFixture();
    expect(() => approve(pilot, reviewApproval(pilot))).toThrow(/attested/i);
    const reviewed = attest(pilot);
    const exact = reviewApproval(reviewed);
    expect(() => approve(reviewed)).toThrow();
    const withoutConfirmation = structuredClone(exact);
    delete (withoutConfirmation.confirmations as { exactRecipientCopyReviewed?: true }).exactRecipientCopyReviewed;
    expect(() => approve(reviewed, withoutConfirmation)).toThrow();
    const withoutFingerprint = { ...exact, expectedRecipientCopyReviewFingerprint: undefined };
    expect(() => approve(reviewed, withoutFingerprint)).toThrow();
    expect(() => approve(reviewed, { ...exact, expectedRecipientCopyReviewFingerprint: `sha256:${"f".repeat(64)}` })).toThrow();
    const approved = approve(reviewed, exact);
    expect(approved.status).toBe("approved");
    expect(approved.approval).toMatchObject(approved.fingerprints);
    expect(approved.availableActions.canLaunch).toBe(true);
    expect(launch(approved).status).toBe("launch_requested");
  });

  it("requires the same copy authority on approval replay and rejects changed saved copy", () => {
    const reviewed = attest(twentyFixture().pilot);
    const request = reviewApproval(reviewed);
    const approved = approve(reviewed, request);
    expect(isWarmReconnectPilotApprovalReplay({ pilot: approved, request, now: NOW })).toBe(true);
    expect(isWarmReconnectPilotApprovalReplay({ pilot: approved, request: approvalRequest(approved), now: NOW })).toBe(false);
    const changed = structuredClone(approved);
    changed.recipients[16].recipientCopy!.openingParagraph = "A different local draft.";
    expect(isWarmReconnectPilotApprovalReplay({ pilot: changed, request, now: NOW })).toBe(false);
  });

  it("binds a new full-handle correction to a new audience, action, and review fingerprint", () => {
    const f = twentyFixture();
    const changedCopies = f.recipientCopies.map((copy, index) => index === 3 ? copyFor(f.candidates[6], { greetingName: "River Amber Two", openingParagraph: DEFAULT_OPENING }) : copy);
    const changed = create(f.candidates, { ...f.request, recipientCopies: changedCopies }, f.pilot.pilotId);
    expect(changed.fingerprints.artifactFingerprint).toBe(f.pilot.fingerprints.artifactFingerprint);
    expect(changed.fingerprints.audienceFingerprint).not.toBe(f.pilot.fingerprints.audienceFingerprint);
    expect(changed.fingerprints.actionFingerprint).not.toBe(f.pilot.fingerprints.actionFingerprint);
    expect(warmReconnectRecipientCopyReviewFingerprint(changed.recipients)).not.toBe(warmReconnectRecipientCopyReviewFingerprint(f.pilot.recipients));
    expect(() => approve(attest(changed), reviewApproval(attest(f.pilot)))).toThrow();
  });
});

describe.each(["initial_5", "follow_on"] as const)("%s repository creation replay binds exact recipient copy", tranche => {
  function setup() {
    const memory = memoryFirestore();
    const parent = tranche === "follow_on" ? seedCompletedParent(memory) : undefined;
    const candidates = seedCandidates(memory, 0, tranche === "initial_5" ? 5 : 20);
    const recipientCopies = [copyFor(candidates[0])];
    const request = { ...createRequest(candidates, parent), recipientCopies };
    const run = (body: CreateWarmReconnectPilotRequest = request) => createWarmReconnectPilotForUid({ uid: UID, request: body, correlationId: "synthetic-recipient-copy", log, db: memory.db });
    return { memory, parent, candidates, request, run };
  }

  it("replays identical creation without another write and exposes every review preview", async () => {
    const f = setup();
    const first = await f.run();
    const count = f.memory.writes.length;
    const replay = await f.run();
    expect(first.replayed).toBe(false);
    expect(replay.replayed).toBe(true);
    expect(f.memory.writes).toHaveLength(count);
    expect(replay.pilot.recipients).toEqual(first.pilot.recipients);
    expect(replay.pilot.recipientEmailPreviews).toHaveLength(f.candidates.length);
    expect(replay.pilot.approval).toBeNull();
    expect(replay.pilot.recipients.every(row => row.decision.permissionState === "unknown")).toBe(true);
  });

  it.each(["opening", "greeting", "omitted"])("rejects reuse of the creation key with %s copy changed", async field => {
    const f = setup();
    await f.run();
    const count = f.memory.writes.length;
    const recipientCopies = field === "omitted" ? undefined : [copyFor(f.candidates[0], field === "opening" ? { openingParagraph: "It's Marcus Rosser. We discussed another workshop." } : { greetingName: "Sky Blue Two" })];
    await expect(f.run({ ...f.request, recipientCopies })).rejects.toThrow(/idempotency|changed|copy/i);
    expect(f.memory.writes).toHaveLength(count);
  });

  it("rejects a tampered saved copy before accepting a creation replay", async () => {
    const f = setup();
    const result = await f.run();
    const path = `crm_warm_reconnect_pilots/${result.pilot.pilotId}`;
    const saved = f.memory.records.get(path) as unknown as WarmReconnectPilot;
    saved.recipients[0].recipientCopy!.openingParagraph = "A changed saved opening.";
    const count = f.memory.writes.length;
    await expect(f.run()).rejects.toThrow();
    expect(f.memory.writes).toHaveLength(count);
  });

  it("still rejects changed candidate evidence and active suppression without writes", async () => {
    const f = setup();
    const person = f.candidates[0];
    const sourcePath = person.sourceEvidence[0].evidenceRef;
    f.memory.put(sourcePath, {
      ...f.memory.records.get(sourcePath), observedAt: NOW.toISOString(),
    });
    await expect(f.run()).rejects.toThrow();
    expect(f.memory.writes).toEqual([]);
    const suppressed = setup();
    suppressed.memory.put("crm_suppressions/active", { workspaceId: WORKSPACE, contactPointId: suppressed.candidates[0].contactPointId, active: true });
    await expect(suppressed.run()).rejects.toThrow();
    expect(suppressed.memory.writes).toEqual([]);
  });
});

describe("a completed personalized parent retains exact copy approval", () => {
  function setup() {
    const memory = memoryFirestore();
    const parent = seedCompletedParent(memory, true);
    const candidates = seedCandidates(memory);
    const request = { ...createRequest(candidates, parent), recipientCopies: [copyFor(candidates[16])] };
    const run = () => createWarmReconnectPilotForUid({ uid: UID, request, correlationId: "synthetic-parent-copy", log, db: memory.db });
    return { memory, parent, run };
  }

  it("accepts exact personalized completion and preserves all predecessor records", async () => {
    const f = setup();
    const before = structuredClone(f.memory.records);
    expect(f.parent.approval!.recipientCopyReviewFingerprint).toBe(warmReconnectRecipientCopyReviewFingerprint(f.parent.recipients));
    const result = await f.run();
    expect(result.replayed).toBe(false);
    expect(result.pilot.approval).toBeNull();
    expect(result.pilot.fingerprints.artifactFingerprint).toBe(f.parent.fingerprints.artifactFingerprint);
    for (const [path, original] of before) expect(f.memory.records.get(path)).toEqual(original);
  });

  it.each(["missing", "stale"])("rejects %s parent copy approval with the original three fingerprints intact", async variant => {
    const f = setup();
    const path = `crm_warm_reconnect_pilots/${f.parent.pilotId}`;
    const stored = f.memory.records.get(path) as unknown as WarmReconnectPilot;
    if (variant === "missing") delete stored.approval!.recipientCopyReviewFingerprint;
    else stored.approval!.recipientCopyReviewFingerprint = `sha256:${"f".repeat(64)}`;
    expect(stored.approval).toMatchObject(stored.fingerprints);
    expect(assertWarmReconnectPilotFingerprints(stored)).toEqual(stored.fingerprints);
    await expect(f.run()).rejects.toThrow(/copy|approval|predecessor|parent/i);
    expect(f.memory.writes).toEqual([]);
  });
});

