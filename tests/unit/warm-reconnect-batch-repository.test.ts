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
type Ref = { path: string; query?: boolean; filters?: Array<[string, unknown]>; cap?: number };
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
  function query(path: string, filters: Array<[string, unknown]> = [], cap = Infinity) {
    return {
      path, query: true, filters, cap,
      doc: (id: string) => reference(`${path}/${id}`),
      where: (field: string, operation: string, value: unknown) => {
        if (operation !== "==") throw new Error(`Unsupported test query operator ${operation}`);
        return query(path, [...filters, [field, value]], cap);
      },
      limit: (limit: number) => query(path, filters, limit),
    };
  }
  function read(ref: Ref, store: Map<string, Data>) {
    if (!ref.query) return snapshot(ref.path, store);
    const paths = [...store.keys()].filter((path) =>
      path.startsWith(`${ref.path}/`) && !path.slice(ref.path.length + 1).includes("/") &&
      (ref.filters || []).every(([field, value]) => store.get(path)?.[field] === value)
    ).slice(0, ref.cap);
    return { docs: paths.map((path) => snapshot(path, store)), size: paths.length, empty: paths.length === 0 };
  }
  const db = {
    collection: (name: string) => query(name),
    runTransaction: async (callback: (transaction: unknown) => Promise<unknown>) => {
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
    db, records, writes, put, remove,
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

function expectNoWrites(f: ReturnType<typeof fixture>) {
  expect(f.writes).toEqual([]);
  expect(f.records.has(FOLLOW_ON_LOCK)).toBe(false);
  expect(f.records.has(`${PILOTS}/child-a`)).toBe(false);
}

function releasedHistoricalLedger(recipient: WarmReconnectCandidate) {
  const identity = {
    workspaceId: WORKSPACE, campaignVersion: WARM_RECONNECT_CAMPAIGN_VERSION,
    personId: recipient.personId, emailKey: recipient.emailKey,
  };
  return {
    schemaVersion: "crm.warm-reconnect-invitation-ledger.v1", ...identity,
    reservationId: warmReconnectInvitationReservationId(identity),
    pilotId: "old-released-pilot", receiptId: "old-released-receipt", approvalId: "old-approval",
    actionFingerprint: `sha256:${"d".repeat(64)}`,
    status: "released_before_provider", reservationGeneration: 1, reservedAtMs: START - 1000,
    releasedAtMs: START, correlationId: "historical-release-test",
  };
}

function seedReleasedHolder(f: ReturnType<typeof fixture>, size = 2) {
  // This prior audience differs from the proposed child, so the holder proof
  // must catch corruption independently of the new audience's history queries.
  const holder = createPilot("released-holder", Array.from({ length: size }, (_, index) => candidate(40 + index)), f.parent, f.notBeforeMs);
  holder.recipients = holder.recipients.map((recipient) => ({
    ...recipient,
    decision: {
      status: "eligible_one_time_reconnection", decisionId: `decision-${recipient.recipientId}`,
      decidedAt: new Date(START).toISOString(), relationshipAttested: true, permissionState: "unknown",
      sourceEvidenceRefs: recipient.sourceEvidence.map((source) => source.evidenceRef), note: "Reviewed one-time relationship.",
    },
  }));
  holder.fingerprints = computeWarmReconnectPilotFingerprints(holder);
  holder.approval = {
    ...f.parent.approval!, ...holder.fingerprints,
    approvalId: "released-holder-approval", approvalScope: "exact_batch_one_time_reconnection_emails",
  };
  const recipient = holder.recipients[0];
  const receiptId = warmReconnectBatchReceiptId(holder, recipient.recipientId);
  const binding = warmReconnectInvitationReservationBindingForPilot(holder, recipient, receiptId);
  holder.status = "stopped";
  holder.approval = null;
  holder.stoppedAt = new Date(f.notBeforeMs + 1000).toISOString();
  holder.stopReason = "Pre-provider stop";
  const holderPath = `${PILOTS}/${holder.pilotId}`;
  const receiptPath = `${holderPath}/delivery_receipts/${receiptId}`;
  const ledgerPath = `${LEDGERS}/${binding.reservationId}`;
  f.put(holderPath, holder as unknown as Data);
  f.put(`${holderPath}/executor/state`, {
    schemaVersion: "crm.warm-reconnect-executor-state.v1", pilotId: holder.pilotId, workspaceId: WORKSPACE,
    activeReceiptId: null, claimedCount: 1, sentCount: 0, lastProviderAttemptAtMs: null,
    nextEligibleAtMs: f.notBeforeMs, halted: true, complete: false,
  });
  f.put(receiptPath, {
    schemaVersion: "crm.warm-reconnect-delivery-receipt.v1", ...binding, ...holder.fingerprints,
    ownerUid: UID, recipientId: recipient.recipientId, contactPointId: recipient.contactPointId,
    invitationReservationId: binding.reservationId, status: "stopped_before_provider", claimedAtMs: f.notBeforeMs,
    stoppedAtMs: f.notBeforeMs + 1000, correlationId: "released-holder-test",
  });
  f.put(ledgerPath, {
    schemaVersion: "crm.warm-reconnect-invitation-ledger.v1", ...binding,
    status: "released_before_provider", reservationGeneration: 1, reservedAtMs: f.notBeforeMs,
    releasedAtMs: f.notBeforeMs + 1000, correlationId: "released-holder-test",
  });
  f.put(FOLLOW_ON_LOCK, {
    schemaVersion: "crm.warm-reconnect-follow-on-lock.v1", workspaceId: WORKSPACE,
    campaignId: WARM_RECONNECT_CAMPAIGN_ID, campaignVersion: WARM_RECONNECT_CAMPAIGN_VERSION,
    tranche: "follow_on", state: "released_before_provider", pilotId: holder.pilotId,
    parentPilotId: f.parent.pilotId, batchSequence: 1, recipientCap: holder.recipientCap,
  });
  return { holderPath, receiptPath, ledgerPath };
}

describe("warm reconnect follow-on repository transactions", () => {
  it("atomically reserves one child while preserving every original proof document", async () => {
    const f = fixture();
    const originals = new Map([...f.records].map(([path, data]) => [path, structuredClone(data)]));
    const result = await f.reserve();
    expect(result.replayed).toBe(false);
    expect(result.pilot).toMatchObject({ parentPilotId: f.parent.pilotId, batchSequence: 1, recipientCap: 4, followOnNotBeforeMs: f.notBeforeMs });
    expect(f.records.get(FOLLOW_ON_LOCK)).toMatchObject({ state: "active", pilotId: "child-a", parentPilotId: f.parent.pilotId, batchSequence: 1, recipientCap: 4 });
    expect(f.writes).toHaveLength(3);
    expect(f.writes.filter((path) => path.startsWith(`${PILOTS}/child-a/events/`))).toHaveLength(1);
    for (const [path, data] of originals) expect(f.records.get(path)).toEqual(data);
  });

  it("retries a concurrent different child and creates exactly one reservation", async () => {
    const f = fixture();
    const results = await Promise.allSettled([f.reserve("child-a"), f.reserve("child-b")]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(f.attempts()).toBeGreaterThanOrEqual(3);
    expect(["child-a", "child-b"].filter((id) => f.records.has(`${PILOTS}/${id}`))).toHaveLength(1);
    expect(f.writes).toHaveLength(3);
  });

  it("replays the exact request without a new write, including a concurrent replay", async () => {
    const f = fixture();
    const results = await Promise.all([f.reserve(), f.reserve()]);
    expect(results.map((result) => result.replayed).sort()).toEqual([false, true]);
    expect(results[0].pilot.pilotId).toBe(results[1].pilot.pilotId);
    expect((await f.reserve()).replayed).toBe(true);
    expect(f.writes).toHaveLength(3);
  });

  it("rejects reuse of the idempotency key with a different audience", async () => {
    const f = fixture();
    await f.reserve();
    const saved = structuredClone(f.records.get(`${PILOTS}/child-a`));
    await expect(f.reserve("child-a", [30, 31, 32, 33].map(candidate))).rejects.toThrow("used differently");
    expect(f.records.get(`${PILOTS}/child-a`)).toEqual(saved);
    expect(f.writes).toHaveLength(3);
  });

  it("refuses to recreate a missing pilot under its orphaned reservation lock", async () => {
    const f = fixture();
    await f.reserve();
    const lock = structuredClone(f.records.get(FOLLOW_ON_LOCK));
    f.remove(`${PILOTS}/child-a`);
    f.writes.length = 0;
    await expect(f.reserve()).rejects.toThrow("reserved follow-on batch document is missing");
    expect(f.writes).toEqual([]);
    expect(f.records.has(`${PILOTS}/child-a`)).toBe(false);
    expect(f.records.get(FOLLOW_ON_LOCK)).toEqual(lock);
  });

  it("replaces a released holder with cleared approval only after proving its original receipt and ledger", async () => {
    const f = fixture();
    const old = seedReleasedHolder(f);
    const preserved = [old.holderPath, old.receiptPath, old.ledgerPath].map((path) => [path, structuredClone(f.records.get(path))] as const);
    expect(f.records.get(old.holderPath)?.approval).toBeNull();
    expect((await f.reserve()).replayed).toBe(false);
    expect(f.records.get(FOLLOW_ON_LOCK)).toMatchObject({ state: "active", pilotId: "child-a", priorPilotId: "released-holder" });
    for (const [path, data] of preserved) expect(f.records.get(path)).toEqual(data);
  });

  it("checks a twenty-person released holder beyond the former eleven-receipt read bound", async () => {
    const f = fixture();
    const old = seedReleasedHolder(f, 20);
    const base = f.records.get(old.receiptPath)!;
    // The first eleven rows are benign pre-provider stops. The twelfth row
    // must not be hidden by the old query limit when the audience is larger.
    for (let index = 1; index <= 11; index += 1) {
      const receiptId = `extra-${index}`;
      f.put(`${old.holderPath}/delivery_receipts/${receiptId}`, {
        ...base, receiptId, status: index === 11 ? "delivery_unknown" : "stopped_before_provider",
      });
    }
    const lock = structuredClone(f.records.get(FOLLOW_ON_LOCK));
    await expect(f.reserve()).rejects.toThrow("unresolved execution evidence");
    expect(f.writes).toEqual([]);
    expect(f.records.get(FOLLOW_ON_LOCK)).toEqual(lock);
  });

  it.each([
    "holder pilot ID", "ledger approval binding", "ledger document ID", "ledger provider timestamp",
    "ledger terminal timestamp", "receipt document ID", "receipt owner", "receipt action fingerprint",
  ])("blocks released holder corruption in %s even for a different next audience", async (change) => {
    const f = fixture();
    const old = seedReleasedHolder(f);
    const lock = structuredClone(f.records.get(FOLLOW_ON_LOCK));
    if (change === "holder pilot ID") {
      const holder = structuredClone(f.records.get(old.holderPath)) as unknown as WarmReconnectPilot;
      holder.pilotId = "another-pilot";
      holder.fingerprints = computeWarmReconnectPilotFingerprints(holder);
      f.put(old.holderPath, holder as unknown as Data);
    }
    if (change === "ledger approval binding") f.put(old.ledgerPath, { ...f.records.get(old.ledgerPath), approvalId: "another-approval" });
    if (change === "ledger document ID") f.put(old.ledgerPath, { ...f.records.get(old.ledgerPath), reservationId: "another-reservation" });
    if (change === "ledger provider timestamp") f.put(old.ledgerPath, { ...f.records.get(old.ledgerPath), providerStartedAtMs: START });
    if (change === "ledger terminal timestamp") f.put(old.ledgerPath, { ...f.records.get(old.ledgerPath), terminalAtMs: START });
    if (change === "receipt document ID") {
      f.put(`${old.holderPath}/delivery_receipts/stray-receipt`, f.records.get(old.receiptPath)!);
      f.remove(old.receiptPath);
    }
    if (change === "receipt owner") f.put(old.receiptPath, { ...f.records.get(old.receiptPath), ownerUid: "another-owner" });
    if (change === "receipt action fingerprint") f.put(old.receiptPath, { ...f.records.get(old.receiptPath), actionFingerprint: `sha256:${"e".repeat(64)}` });
    await expect(f.reserve()).rejects.toThrow();
    expect(f.writes).toEqual([]);
    expect(f.records.has(`${PILOTS}/child-a`)).toBe(false);
    expect(f.records.get(FOLLOW_ON_LOCK)).toEqual(lock);
  });

  it.each(["missing receipt", "wrong receipt document ID", "wrong receipt binding", "missing ledger", "wrong ledger document ID", "wrong ledger binding"])(
    "rejects %s without writing a reservation", async (change) => {
      const f = fixture();
      const receiptPath = f.receiptPaths[0];
      const ledgerPath = f.ledgerPaths[0];
      if (change === "missing receipt") f.remove(receiptPath);
      if (change === "wrong receipt document ID") {
        f.put(`${f.parentPath}/delivery_receipts/stray-document`, f.records.get(receiptPath)!);
        f.remove(receiptPath);
      }
      if (change === "wrong receipt binding") f.put(receiptPath, { ...f.records.get(receiptPath), approvalId: "another-approval" });
      if (change === "missing ledger") f.remove(ledgerPath);
      if (change === "wrong ledger document ID") f.put(ledgerPath, { ...f.records.get(ledgerPath), reservationId: "stray-reservation" });
      if (change === "wrong ledger binding") f.put(ledgerPath, { ...f.records.get(ledgerPath), actionFingerprint: `sha256:${"f".repeat(64)}` });
      await expect(f.reserve()).rejects.toThrow();
      expectNoWrites(f);
    }
  );

  it.each(["missing state", "unknown parent", "unknown parent receipt", "unknown parent ledger", "stray receipt", "released initial lock"])(
    "rejects %s without writing a reservation", async (change) => {
      const f = fixture();
      if (change === "missing state") f.remove(f.statePath);
      if (change === "unknown parent receipt") f.put(f.receiptPaths[0], { ...f.records.get(f.receiptPaths[0]), status: "delivery_unknown" });
      if (change === "unknown parent ledger") f.put(f.ledgerPaths[0], { ...f.records.get(f.ledgerPaths[0]), status: "delivery_unknown" });
      if (change === "stray receipt") f.put(`${f.parentPath}/delivery_receipts/stray`, { receiptId: "stray", status: "sent" });
      if (change === "released initial lock") f.put(INITIAL_LOCK, { ...f.records.get(INITIAL_LOCK), state: "released_before_provider" });
      await expect(f.reserve("child-a", f.nextCandidates, change === "unknown parent" ? "missing-parent" : f.parent.pilotId)).rejects.toThrow();
      expectNoWrites(f);
    }
  );

  it.each([
    ["providerMessageId", "duplicate"], ["providerThreadId", "duplicate"],
    ["providerMessageId", "invalid"], ["providerThreadId", "invalid"],
  ])("rejects %s %s proof without creating a successor", async (field, corruption) => {
    const f = fixture();
    f.put(f.receiptPaths[1], {
      ...f.records.get(f.receiptPaths[1]),
      [field]: corruption === "duplicate" ? f.records.get(f.receiptPaths[0])![field] : "not-a-gmail-id",
    });
    await expect(f.reserve()).rejects.toThrow();
    expectNoWrites(f);
  });

  it.each(["sent", "delivery_unknown", "provider_inflight", "reserved"])(
    "excludes a %s historical person after their email changes", async (status) => {
      const f = fixture();
      f.put(`${LEDGERS}/historical-person`, {
        workspaceId: WORKSPACE, campaignVersion: WARM_RECONNECT_CAMPAIGN_VERSION,
        personId: f.nextCandidates[0].personId, emailKey: candidate(900).emailKey, status,
      });
      await expect(f.reserve()).rejects.toThrow("already has an invitation");
      expectNoWrites(f);
    }
  );

  it.each(["sent", "delivery_unknown"])("excludes a %s historical email after its person changes", async (status) => {
    const f = fixture();
    f.put(`${LEDGERS}/historical-email`, {
      workspaceId: WORKSPACE, campaignVersion: WARM_RECONNECT_CAMPAIGN_VERSION,
      personId: "merged-old-person", emailKey: f.nextCandidates[0].emailKey, status,
    });
    await expect(f.reserve()).rejects.toThrow("already has an invitation");
    expectNoWrites(f);
  });

  it("rechecks a historical identity conflict added during the transaction", async () => {
    const f = fixture();
    f.beforeCommit(() => f.put(`${LEDGERS}/concurrent-invitation`, {
      workspaceId: WORKSPACE, campaignVersion: WARM_RECONNECT_CAMPAIGN_VERSION,
      personId: f.nextCandidates[0].personId, emailKey: candidate(900).emailKey, status: "sent",
    }));
    await expect(f.reserve()).rejects.toThrow("already has an invitation");
    expect(f.attempts()).toBe(2);
    expectNoWrites(f);
  });

  it("fails closed when historical evidence exceeds the bounded query", async () => {
    const f = fixture();
    for (let index = 0; index < 101; index += 1) {
      const ledger = releasedHistoricalLedger({ ...candidate(900 + index), personId: f.nextCandidates[0].personId });
      f.put(`${LEDGERS}/${ledger.reservationId}`, ledger);
    }
    await expect(f.reserve()).rejects.toThrow("already has an invitation");
    expectNoWrites(f);
  });

  it.each(["released_before_provider", "different workspace", "different campaign version"])(
    "allows historical evidence outside the blocked scope: %s", async (scope) => {
      const f = fixture();
      const released = releasedHistoricalLedger(f.nextCandidates[0]);
      f.put(`${LEDGERS}/${released.reservationId}`, {
        ...released,
        workspaceId: scope === "different workspace" ? "workspace_default_other" : WORKSPACE,
        campaignVersion: scope === "different campaign version" ? "previous-campaign" : WARM_RECONNECT_CAMPAIGN_VERSION,
        status: scope === "released_before_provider" ? "released_before_provider" : "sent",
      });
      expect((await f.reserve()).replayed).toBe(false);
    }
  );

  it.each([
    { schemaVersion: undefined }, { campaignVersion: undefined }, { reservationGeneration: 0 },
    { reservedAtMs: Number.NaN }, { providerStartedAtMs: START }, { terminalAtMs: START },
    { providerStartedAtMs: null }, { terminalAtMs: null },
  ])("blocks malformed released or provider-terminal history: %j", async (change) => {
    const f = fixture();
    const released = releasedHistoricalLedger(f.nextCandidates[0]);
    f.put(`${LEDGERS}/${released.reservationId}`, { ...released, ...change });
    await expect(f.reserve()).rejects.toThrow("already has an invitation");
    expectNoWrites(f);
  });

  it("blocks a released ledger whose document ID does not match the reservation", async () => {
    const f = fixture();
    f.put(`${LEDGERS}/wrong-released-document`, releasedHistoricalLedger(f.nextCandidates[0]));
    await expect(f.reserve()).rejects.toThrow("already has an invitation");
    expectNoWrites(f);
  });
});
