import { loadWarmReconnectHistory, validateWarmReconnectHistoryCursor } from "@/lib/crm/warm-reconnect-history";
import { describe, expect, it } from "vitest";
import type { Firestore } from "firebase-admin/firestore";
import {
  computeWarmReconnectPilotFingerprints,
  createWarmReconnectPilot,
  warmReconnectInitialPilotLockId,
} from "@/lib/crm/warm-reconnect-activation";
import type { WarmReconnectCandidate, WarmReconnectPilot } from "@/lib/crm/warm-reconnect-activation-types";
import { reserveWarmReconnectFollowOnBatch } from "@/lib/crm/warm-reconnect-batch-repository";
import { warmReconnectBatchReceiptId, warmReconnectFollowOnPilotLockId } from "@/lib/crm/warm-reconnect-batches";
import { warmReconnectInvitationReservationBindingForPilot, warmReconnectInvitationReservationId } from "@/lib/crm/warm-reconnect-invitation-ledger";
import { WARM_RECONNECT_CAMPAIGN_ID, WARM_RECONNECT_CAMPAIGN_VERSION } from "@/lib/crm/warm-reconnect-types";

type Data = Record<string, unknown>;
type Ref = { path: string; query?: boolean; filters?: Array<[string, unknown]>; cap?: number; ordered?: boolean; after?: string };
const UID = "batch-repository-owner";
const WORKSPACE = `workspace_default_${UID}`;
const START = Date.parse("2026-10-08T12:00:00Z");
const CADENCE = 60_000;
const PILOTS = "crm_warm_reconnect_pilots";
const LEDGERS = "crm_warm_reconnect_invitation_ledger";
const INITIAL_LOCK = `crm_warm_reconnect_campaign_locks/${warmReconnectInitialPilotLockId(WORKSPACE)}`;
const FOLLOW_ON_LOCK = `crm_warm_reconnect_campaign_locks/${warmReconnectFollowOnPilotLockId(WORKSPACE)}`;

/** Snapshot reads and deferred atomic writes. A competing commit invalidates
 * document AND query reads and retries the real repository callback. */
function memoryFirestore() {
  const records = new Map<string, Data>();
  const versions = new Map<string, number>();
  const writes: string[] = [];
  let attempts = 0;
  const transactionOptions: unknown[] = [];
  let beforeCommit: (() => void) | undefined;
  function touch(path: string) {
    versions.set(path, (versions.get(path) || 0) + 1);
    const collection = path.slice(0, path.lastIndexOf("/"));
    versions.set(collection, (versions.get(collection) || 0) + 1);
  }
  function put(path: string, data: Data) {
    records.set(path, structuredClone(data));
    touch(path);
  }
  function remove(path: string) { records.delete(path); touch(path); }
  function snapshot(path: string, store: Map<string, Data>) {
    return {
      id: path.split("/").at(-1)!,
      exists: store.has(path),
      data: () => store.has(path) ? structuredClone(store.get(path)!) : undefined,
    };
  }
  function reference(path: string) {
    return { path, id: path.split("/").at(-1)!, collection: (name: string) => query(`${path}/${name}`) };
  }
  function query(path: string, filters: Array<[string, unknown]> = [], cap = Infinity, ordered = false, after?: string) {
    return {
      path, query: true, filters, cap, ordered, after,
      doc: (id: string) => reference(`${path}/${id}`),
      where: (field: string, operation: string, value: unknown) => {
        if (operation !== "==") throw new Error(`Unsupported test query operator ${operation}`);
        return query(path, [...filters, [field, value]], cap, ordered, after);
      },
      limit: (limit: number) => query(path, filters, limit, ordered, after),
      orderBy: () => query(path, filters, cap, true, after),
      startAfter: (cursor: string) => query(path, filters, cap, ordered, cursor),
    };
  }
  function read(ref: Ref, store: Map<string, Data>) {
    if (!ref.query) return snapshot(ref.path, store);
    let paths = [...store.keys()].filter((path) =>
      path.startsWith(`${ref.path}/`) && !path.slice(ref.path.length + 1).includes("/") &&
      (ref.filters || []).every(([field, value]) => store.get(path)?.[field] === value)
    );
    if (ref.ordered) paths.sort();
    if (ref.after) paths = paths.filter(path => path.split("/").at(-1)! > ref.after!);
    paths = paths.slice(0, ref.cap);
    return { docs: paths.map((path) => snapshot(path, store)), size: paths.length, empty: paths.length === 0 };
  }
  const db = {
    collection: (name: string) => query(name),
    runTransaction: async (callback: (transaction: unknown) => Promise<unknown>, options?: unknown) => {
      transactionOptions.push(options);
      for (let retry = 0; retry < 5; retry += 1) {
        attempts += 1;
        const store = new Map([...records].map(([path, data]) => [path, structuredClone(data)]));
        const captured = new Map(versions);
        const reads = new Set<string>();
        const pending: Array<{ path: string; data: Data; create: boolean }> = [];
        const transaction = {
          get: async (ref: Ref) => {
            if (pending.length) throw new Error("Firestore transactions require all reads before writes");
            reads.add(ref.path);
            return read(ref, store);
          },
          set: (ref: Ref, data: Data) => pending.push({ path: ref.path, data, create: false }),
          create: (ref: Ref, data: Data) => {
            if (store.has(ref.path) || pending.some((write) => write.path === ref.path)) throw new Error("Document already exists");
            pending.push({ path: ref.path, data, create: true });
          },
        };
        const result = await callback(transaction);
        const hook = beforeCommit;
        beforeCommit = undefined;
        hook?.();
        if ([...reads].some((path) => versions.get(path) !== captured.get(path))) continue;
        if (pending.some((write) => write.create && records.has(write.path))) continue;
        for (const write of pending) { put(write.path, write.data); writes.push(write.path); }
        return result;
      }
      throw new Error("Test transaction retry limit exceeded");
    },
  } as unknown as Firestore;
  return {
    db, records, writes, put, remove, transactionOptions,
    attempts: () => attempts,
    beforeCommit: (hook: () => void) => { beforeCommit = hook; },
  };
}

function candidate(index: number): WarmReconnectCandidate {
  return {
    recipientId: `recipient-${index}`, personId: `person-${index}`, contactPointId: `contact-${index}`,
    displayName: `Person ${index}`, email: `person${index}@example.test`,
    emailKey: `sha256:${index.toString(16).padStart(64, "0")}`,
    candidateFingerprint: `sha256:${(index + 100).toString(16).padStart(64, "0")}`,
    permissionState: "unknown", permissionRemainsExplicit: true,
    sourceEvidence: [{ evidenceRef: `crm_source_records/source-${index}`, sourceSystem: "google_people", permissionBasis: "none", observedAt: new Date(START).toISOString() }],
    reviewStatus: "requires_operator_attestation",
  };
}

function createPilot(pilotId: string, candidates: WarmReconnectCandidate[], parent?: WarmReconnectPilot, notBeforeMs?: number) {
  const common = {
    idempotencyKey: pilotId, campaignPreviewFingerprint: `sha256:${"a".repeat(64)}`,
    contentMode: "plain_text" as const,
    sender: {
      senderName: "Marcus Rosser", legalEntity: "Marcus Rosser / Rosser Gallery",
      businessId: "rosser_nft_gallery" as const, profileId: "rosser_gallery_send" as const,
      replyTo: "mrosser@rossergallery.com", physicalPostalAddress: "2505 N Tonti St, New Orleans, LA 70117",
    },
  };
  return createWarmReconnectPilot({
    pilotId, workspaceId: WORKSPACE, ownerUid: UID, legacyDncOrgId: WORKSPACE,
    googleReady: true, fromEmail: "mrosser@rossergallery.com", accountId: "gallery-account",
    preferenceOrigin: "https://leadflow-review.web.app", now: new Date(START), candidates,
    followOnNotBeforeMs: notBeforeMs,
    request: parent ? {
      ...common, tranche: "follow_on", recipientCap: candidates.length,
      candidateRecipientIds: candidates.map((row) => row.recipientId),
      parentPilotId: parent.pilotId, batchSequence: (parent.batchSequence || 0) + 1,
    } : {
      ...common, tranche: "initial_5", recipientCap: 5,
      candidateRecipientIds: candidates.map((row) => row.recipientId) as [string, string, string, string, string],
    },
  });
}

function fixture() {
  const memory = memoryFirestore();
  const parent = createPilot("parent-initial", [1, 2, 3, 4, 5].map(candidate));
  parent.recipients = parent.recipients.map((row) => ({
    ...row,
    decision: {
      status: "eligible_one_time_reconnection", decisionId: `decision-${row.recipientId}`,
      decidedAt: new Date(START).toISOString(), relationshipAttested: true, permissionState: "unknown",
      sourceEvidenceRefs: row.sourceEvidence.map((source) => source.evidenceRef), note: "Reviewed one-time relationship.",
    },
  }));
  parent.fingerprints = computeWarmReconnectPilotFingerprints(parent);
  parent.status = "launch_requested";
  parent.launchRequestedAt = new Date(START).toISOString();
  parent.gates = parent.gates.map((gate) => ({ ...gate, status: "verified" }));
  parent.approval = {
    approvalId: "parent-approval", decision: "approved", approvedAt: new Date(START).toISOString(),
    expiresAt: new Date(START + 86_400_000).toISOString(), note: "Reviewed first five.",
    ...parent.fingerprints, approvalScope: "exact_five_one_time_reconnection_emails",
    excludedScope: ["audience_expansion", "provider_draft_create", "sms_send", "phone_call", "social_lookup", "social_direct_message", "ambiguous_outcome_retry"],
  };
  const parentPath = `${PILOTS}/${parent.pilotId}`;
  const statePath = `${parentPath}/executor/state`;
  memory.put(parentPath, parent as unknown as Data);
  memory.put(INITIAL_LOCK, {
    schemaVersion: 1, workspaceId: WORKSPACE, campaignId: WARM_RECONNECT_CAMPAIGN_ID,
    campaignVersion: WARM_RECONNECT_CAMPAIGN_VERSION, tranche: "initial_5", state: "active", pilotId: parent.pilotId,
  });
  const receiptPaths: string[] = [];
  const ledgerPaths: string[] = [];
  parent.recipients.forEach((recipient, index) => {
    const receiptId = warmReconnectBatchReceiptId(parent, recipient.recipientId);
    const binding = warmReconnectInvitationReservationBindingForPilot(parent, recipient, receiptId);
    const providerStartedAtMs = START + index * CADENCE;
    const receiptPath = `${parentPath}/delivery_receipts/${receiptId}`;
    const ledgerPath = `${LEDGERS}/${binding.reservationId}`;
    receiptPaths.push(receiptPath);
    ledgerPaths.push(ledgerPath);
    memory.put(receiptPath, {
      schemaVersion: "crm.warm-reconnect-delivery-receipt.v1", ...binding, ...parent.fingerprints,
      ownerUid: UID, recipientId: recipient.recipientId, contactPointId: recipient.contactPointId,
      invitationReservationId: binding.reservationId, status: "sent", claimedAtMs: providerStartedAtMs,
      providerStartedAtMs, sentAtMs: providerStartedAtMs + 100,
      providerMessageId: `a${index.toString(16).padStart(15, "0")}`,
      providerThreadId: `b${index.toString(16).padStart(15, "0")}`, correlationId: "parent-test",
    });
    memory.put(ledgerPath, {
      schemaVersion: "crm.warm-reconnect-invitation-ledger.v1", ...binding,
      status: "sent", reservationGeneration: 1, reservedAtMs: providerStartedAtMs,
      providerStartedAtMs, terminalAtMs: providerStartedAtMs + 100, correlationId: "parent-test",
    });
  });
  const notBeforeMs = START + 5 * CADENCE;
  memory.put(statePath, {
    schemaVersion: "crm.warm-reconnect-executor-state.v1", pilotId: parent.pilotId, workspaceId: WORKSPACE,
    activeReceiptId: null, claimedCount: 5, sentCount: 5, lastProviderAttemptAtMs: START + 4 * CADENCE,
    nextEligibleAtMs: notBeforeMs, halted: false, complete: true,
  });
  const nextCandidates = [20, 21, 22, 23].map(candidate);
  const reserve = (pilotId = "child-a", candidates = nextCandidates, parentPilotId = parent.pilotId) => reserveWarmReconnectFollowOnBatch({
    db: memory.db, uid: UID, workspaceId: WORKSPACE, pilotId, parentPilotId, correlationId: `test-${pilotId}`,
    makePilot: (bound) => createPilot(pilotId, candidates, parent, bound),
  });
  return { ...memory, parent, parentPath, statePath, receiptPaths, ledgerPaths, reserve, nextCandidates, notBeforeMs };
}

function load(f: ReturnType<typeof fixture>, historyAfter?: string) {
  return loadWarmReconnectHistory({ db: f.db, workspaceId: WORKSPACE, uid: UID, historyAfter });
}

function addChild(f: ReturnType<typeof fixture>, id = "zz-current-head") {
  const child = createPilot(id, f.nextCandidates, f.parent, f.notBeforeMs);
  f.put(`${PILOTS}/${id}`, child as unknown as Data);
  f.put(FOLLOW_ON_LOCK, {
    schemaVersion: "crm.warm-reconnect-follow-on-lock.v1", workspaceId: WORKSPACE,
    campaignId: WARM_RECONNECT_CAMPAIGN_ID, campaignVersion: WARM_RECONNECT_CAMPAIGN_VERSION,
    tranche: "follow_on", state: "active", pilotId: id, parentPilotId: f.parent.pilotId,
    batchSequence: 1, recipientCap: child.recipientCap,
  });
  return child;
}

describe("authoritative warm reconnect history", () => {
  it("keeps the exact head visible beyond 100 historical rows and on every bounded document-ID page", async () => {
    const f = fixture();
    const head = addChild(f);
    // Deliberately insert in reverse order, with creation timestamps that do not
    // match document-ID order. Neither insertion nor local timestamp sort wins.
    for (let index = 104; index >= 0; index--) {
      const id = `history-${index.toString().padStart(3, "0")}`;
      const pilot = createPilot(id, [1, 2, 3, 4, 5].map(candidate));
      pilot.status = "stopped";
      f.put(`${PILOTS}/${id}`, pilot as unknown as Data);
    }
    const before = JSON.stringify([...f.records]);
    let after: string | undefined;
    const seen: string[] = [];
    do {
      const result = await load(f, after);
      expect(result.control.activePilotId).toBe(head.pilotId);
      expect(result.control.followOnParentPilotId).toBeNull();
      expect(result.control.canCreateInitialPilot).toBe(false);
      expect(result.pilots.some(pilot => pilot.pilotId === head.pilotId)).toBe(true);
      expect(result.history.pilotIds.length).toBeLessThanOrEqual(20);
      expect(result.excludedPersonIds).toEqual(new Set(f.parent.recipients.map(row => row.personId)));
      expect(result.excludedEmailKeys).toEqual(new Set(f.parent.recipients.map(row => row.emailKey)));
      seen.push(...result.history.pilotIds);
      after = result.history.nextCursor ?? undefined;
    } while (after);
    expect(seen).toHaveLength(107);
    expect(new Set(seen).size).toBe(107);
    expect(seen).toEqual([...seen].sort());
    const exhausted = await load(f, "zzzz");
    expect(exhausted.history.pilotIds).toEqual([]);
    expect(exhausted.control.activePilotId).toBe(head.pilotId);
    expect(JSON.stringify([...f.records])).toBe(before);
    expect(f.writes).toEqual([]);
    expect(f.transactionOptions.every(options => JSON.stringify(options) === '{"readOnly":true}')).toBe(true);
  });

  it("exposes only a durably completed exact parent, independent of the requested history page", async () => {
    const f = fixture();
    const result = await load(f, "zzzz");
    expect(result.history.pilotIds).toEqual([]);
    expect(result.control).toEqual({ initialPilotId: f.parent.pilotId, activePilotId: null,
      followOnParentPilotId: f.parent.pilotId, canCreateInitialPilot: false, blockedReason: null });
  });

  it("selects the completed nineteenth follow-on head rather than its predecessor or the original initial pilot", async () => {
    const f = fixture();
    const predecessor = createPilot("sequence-18", [200, 201].map(candidate), f.parent, f.notBeforeMs);
    predecessor.parentPilotId = "sequence-17";
    predecessor.batchSequence = 18;
    predecessor.fingerprints = computeWarmReconnectPilotFingerprints(predecessor);
    f.put(`${PILOTS}/${predecessor.pilotId}`, predecessor as unknown as Data);
    const head = createPilot("sequence-19", [210, 211].map(candidate), predecessor, f.notBeforeMs);
    head.recipients = head.recipients.map(recipient => ({ ...recipient, decision: {
      status: "eligible_one_time_reconnection", decisionId: `decision-${recipient.recipientId}`,
      decidedAt: new Date(START).toISOString(), relationshipAttested: true, permissionState: "unknown",
      note: "Reviewed one-time relationship.",
      sourceEvidenceRefs: recipient.sourceEvidence.map(source => source.evidenceRef),
    } }));
    head.fingerprints = computeWarmReconnectPilotFingerprints(head);
    head.status = "launch_requested";
    head.launchRequestedAt = new Date(START).toISOString();
    head.approval = { ...f.parent.approval!, ...head.fingerprints, approvalId: "head-approval", approvalScope: "exact_batch_one_time_reconnection_emails" };
    const path = `${PILOTS}/${head.pilotId}`;
    f.put(path, head as unknown as Data);
    f.put(FOLLOW_ON_LOCK, { schemaVersion: "crm.warm-reconnect-follow-on-lock.v1", workspaceId: WORKSPACE,
      campaignId: WARM_RECONNECT_CAMPAIGN_ID, campaignVersion: WARM_RECONNECT_CAMPAIGN_VERSION,
      tranche: "follow_on", state: "active", pilotId: head.pilotId, parentPilotId: predecessor.pilotId,
      batchSequence: 19, recipientCap: 2 });
    head.recipients.forEach((recipient, index) => {
      const receiptId = warmReconnectBatchReceiptId(head, recipient.recipientId);
      const binding = warmReconnectInvitationReservationBindingForPilot(head, recipient, receiptId);
      const started = START + index * CADENCE;
      f.put(`${path}/delivery_receipts/${receiptId}`, { ...f.records.get(f.receiptPaths[index])!,
        ...binding, ...head.fingerprints, recipientId: recipient.recipientId, contactPointId: recipient.contactPointId,
        invitationReservationId: binding.reservationId, claimedAtMs: started, providerStartedAtMs: started, sentAtMs: started + 100 });
      f.put(`${LEDGERS}/${binding.reservationId}`, { ...f.records.get(f.ledgerPaths[index])!, ...binding,
        reservedAtMs: started, providerStartedAtMs: started, terminalAtMs: started + 100 });
    });
    f.put(`${path}/executor/state`, { ...f.records.get(f.statePath)!, pilotId: head.pilotId,
      claimedCount: 2, sentCount: 2, lastProviderAttemptAtMs: START + CADENCE, nextEligibleAtMs: START + 2 * CADENCE });
    const originalLock = JSON.stringify(f.records.get(INITIAL_LOCK));
    const result = await load(f, "zzzz");
    expect(result.control.followOnParentPilotId).toBe(head.pilotId);
    expect(result.control.activePilotId).toBeNull();
    expect(result.pilots.map(pilot => pilot.pilotId)).toEqual(expect.arrayContaining([f.parent.pilotId, predecessor.pilotId, head.pilotId]));
    expect(JSON.stringify(f.records.get(INITIAL_LOCK))).toBe(originalLock);
    expect(f.writes).toEqual([]);
  });

  it("never falls back to the initial parent when a follow-on lock is missing, even outside the history page", async () => {
    const f = fixture();
    addChild(f);
    f.remove(FOLLOW_ON_LOCK);
    await expect(load(f, "zzzz")).rejects.toThrow("authoritative campaign lock");
  });

  it.each(["missing_receipt", "missing_ledger", "wrong_receipt", "wrong_owner", "unresolved_ledger"])("does not fall back from invalid completed-head proof: %s", async kind => {
    const f = fixture();
    if (kind === "missing_receipt") f.remove(f.receiptPaths[0]);
    if (kind === "missing_ledger") f.remove(f.ledgerPaths[0]);
    if (kind === "wrong_receipt") f.put(f.receiptPaths[0], { ...f.records.get(f.receiptPaths[0])!, pilotId: "foreign" });
    if (kind === "wrong_owner") f.put(f.parentPath, { ...f.records.get(f.parentPath)!, ownerUid: "another-owner" });
    if (kind === "unresolved_ledger") f.put(f.ledgerPaths[0], { ...f.records.get(f.ledgerPaths[0])!, status: "delivery_unknown" });
    await expect(load(f)).rejects.toThrow();
    expect(f.writes).toEqual([]);
  });

  it.each(["foreign_workspace", "missing_holder", "malformed_lock", "wrong_parent", "wrong_cap", "missing_initial", "released_initial"])("rejects contradictory authoritative follow-on state: %s", async kind => {
    const f = fixture();
    const head = addChild(f);
    const lock = f.records.get(FOLLOW_ON_LOCK)!;
    if (kind === "foreign_workspace") f.put(FOLLOW_ON_LOCK, { ...lock, workspaceId: "foreign" });
    if (kind === "missing_holder") f.remove(`${PILOTS}/${head.pilotId}`);
    if (kind === "malformed_lock") f.put(FOLLOW_ON_LOCK, { ...lock, state: "unknown" });
    if (kind === "wrong_parent") f.put(FOLLOW_ON_LOCK, { ...lock, parentPilotId: "other" });
    if (kind === "wrong_cap") f.put(FOLLOW_ON_LOCK, { ...lock, recipientCap: 20 });
    if (kind === "missing_initial") f.remove(INITIAL_LOCK);
    if (kind === "released_initial") f.put(INITIAL_LOCK, { ...f.records.get(INITIAL_LOCK)!, state: "released_before_provider" });
    await expect(load(f)).rejects.toThrow();
    expect(f.writes).toEqual([]);
  });

  it.each(["stopped", "stale", "rejected"])("preserves the active lock holder despite its %s status", async status => {
    const f = fixture();
    const head = addChild(f);
    f.put(`${PILOTS}/${head.pilotId}`, { ...head, status });
    const result = await load(f);
    expect(result.control.activePilotId).toBe(head.pilotId);
    expect(result.control.followOnParentPilotId).toBeNull();
    expect(result.control.canCreateInitialPilot).toBe(false);
    expect(result.control.blockedReason).toBeTruthy();
  });

  it("allows a released follow-on holder only after no-provider proof and exact predecessor completion", async () => {
    const f = fixture();
    const head = addChild(f);
    f.put(`${PILOTS}/${head.pilotId}`, { ...head, status: "stopped" });
    f.put(FOLLOW_ON_LOCK, { ...f.records.get(FOLLOW_ON_LOCK)!, state: "released_before_provider" });
    const before = JSON.stringify([...f.records]);
    const result = await load(f);
    expect(result.control.followOnParentPilotId).toBe(f.parent.pilotId);
    expect(result.control.activePilotId).toBeNull();
    expect(result.control.canCreateInitialPilot).toBe(false);
    expect(JSON.stringify([...f.records])).toBe(before);
    f.remove(f.ledgerPaths[0]);
    await expect(load(f)).rejects.toThrow();
  });

  it.each(["active_holder", "provider_attempt", "foreign_state", "reserved_ledger", "unexpected_receipt"])("rejects unsafe released-follow-on evidence: %s", async kind => {
    const f = fixture();
    const head = addChild(f);
    const path = `${PILOTS}/${head.pilotId}`;
    f.put(path, { ...head, status: kind === "active_holder" ? "launch_requested" : "stopped" });
    f.put(FOLLOW_ON_LOCK, { ...f.records.get(FOLLOW_ON_LOCK)!, state: "released_before_provider" });
    if (kind === "provider_attempt" || kind === "foreign_state") f.put(`${path}/executor/state`, {
      schemaVersion: "crm.warm-reconnect-executor-state.v1", pilotId: kind === "foreign_state" ? "foreign" : head.pilotId,
      workspaceId: WORKSPACE, activeReceiptId: null, sentCount: 0,
      lastProviderAttemptAtMs: kind === "provider_attempt" ? START : null,
    });
    if (kind === "reserved_ledger") {
      const binding = warmReconnectInvitationReservationBindingForPilot(head, head.recipients[0], warmReconnectBatchReceiptId(head, head.recipients[0].recipientId));
      f.put(`${LEDGERS}/${binding.reservationId}`, { ...f.records.get(f.ledgerPaths[0])!, ...binding, status: "reserved" });
    }
    if (kind === "unexpected_receipt") f.put(`${path}/delivery_receipts/wrong`, { receiptId: "wrong", status: "stopped_before_provider", pilotId: "foreign" });
    await expect(load(f)).rejects.toThrow();
    expect(f.writes).toEqual([]);
  });

  it("preserves a proven released initial reservation without granting follow-on authority", async () => {
    const f = fixture();
    const pilot = createPilot("released-initial", [30, 31, 32, 33, 34].map(candidate));
    f.records.clear();
    f.put(`${PILOTS}/${pilot.pilotId}`, { ...pilot, status: "stopped" });
    f.put(INITIAL_LOCK, { schemaVersion: 1, workspaceId: WORKSPACE, campaignId: WARM_RECONNECT_CAMPAIGN_ID,
      campaignVersion: WARM_RECONNECT_CAMPAIGN_VERSION, tranche: "initial_5", state: "released_before_provider", pilotId: pilot.pilotId });
    const result = await load(f);
    expect(result.control.canCreateInitialPilot).toBe(true);
    expect(result.control.followOnParentPilotId).toBeNull();
    f.put(`${PILOTS}/${pilot.pilotId}/executor/state`, { schemaVersion: "crm.warm-reconnect-executor-state.v1", pilotId: pilot.pilotId,
      workspaceId: WORKSPACE, activeReceiptId: null, sentCount: 1, lastProviderAttemptAtMs: START });
    await expect(load(f)).rejects.toThrow();
  });

  it("does not infer initial permission from missing locks or an exhausted page", async () => {
    const f = fixture();
    f.remove(INITIAL_LOCK);
    const result = await load(f, "zzzz");
    expect(result.control.canCreateInitialPilot).toBe(false);
    expect(result.control.blockedReason).toBeTruthy();
    f.records.clear();
    expect((await load(f)).control.canCreateInitialPilot).toBe(true);
  });

  it("excludes every reserved, sent or uncertain person and email, beyond the visible history page", async () => {
    const f = fixture();
    for (let index = 0; index < 5; index++) {
      const statuses = ["reserved", "provider_inflight", "sent", "delivery_unknown", "released_before_provider"];
      const row: Data = { ...f.records.get(f.ledgerPaths[index])!, status: statuses[index] };
      if (index === 4) { delete row.providerStartedAtMs; delete row.terminalAtMs; }
      f.put(f.ledgerPaths[index], row);
    }
    f.remove(f.statePath); // Head remains active; no completed-parent authority.
    const result = await load(f, "zzzz");
    expect(result.excludedPersonIds).toEqual(new Set(f.parent.recipients.slice(0, 4).map(row => row.personId)));
    expect(result.excludedEmailKeys).toEqual(new Set(f.parent.recipients.slice(0, 4).map(row => row.emailKey)));
  });

  it.each(["missing_version", "wrong_document_id", "malformed_status"])("fails closed on malformed invitation evidence: %s", async kind => {
    const f = fixture();
    f.remove(f.statePath);
    const row = { ...f.records.get(f.ledgerPaths[0])! };
    if (kind === "missing_version") delete row.campaignVersion;
    if (kind === "wrong_document_id") row.reservationId = "wrong";
    if (kind === "malformed_status") row.status = "invented";
    f.put(f.ledgerPaths[0], row);
    await expect(load(f)).rejects.toThrow();
  });

  it("accepts a complete 1000-row invitation projection and rejects 1001 rather than silently truncating", async () => {
    const f = fixture();
    f.remove(f.statePath);
    for (let index = 5; index < 1000; index++) {
      const recipient = candidate(index + 2000);
      const id = warmReconnectInvitationReservationId({ workspaceId: WORKSPACE, campaignVersion: WARM_RECONNECT_CAMPAIGN_VERSION, personId: recipient.personId, emailKey: recipient.emailKey });
      f.put(`${LEDGERS}/${id}`, { ...f.records.get(f.ledgerPaths[0])!, reservationId: id, personId: recipient.personId, emailKey: recipient.emailKey });
    }
    expect((await load(f)).excludedPersonIds.size).toBe(1000);
    f.put(`${LEDGERS}/overflow`, { ...f.records.get(f.ledgerPaths[0])!, reservationId: "overflow" });
    await expect(load(f)).rejects.toThrow("safe review bound");
  });

  it.each(["", "/", "..", ".", "a/b", "x".repeat(201)])("rejects unsafe cursor %j before datastore access", cursor => {
    expect(() => validateWarmReconnectHistoryCursor(cursor)).toThrow();
  });
});

