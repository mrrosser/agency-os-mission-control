import type { Firestore } from "firebase-admin/firestore";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/handler";
import { getAdminDb } from "@/lib/firebase-admin";
import {
  dispatchWarmReconnectBatch,
  resolveWarmReconnectDispatchTarget,
} from "@/lib/crm/warm-reconnect-dispatcher";
import {
  WARM_RECONNECT_CAMPAIGN_LOCK_COLLECTION,
  warmReconnectFollowOnPilotLockId,
} from "@/lib/crm/warm-reconnect-batches";
import { runWarmReconnectPilotExecutor } from "@/lib/crm/warm-reconnect-executor";
import { WARM_RECONNECT_CAMPAIGN_ID, WARM_RECONNECT_CAMPAIGN_VERSION } from "@/lib/crm/warm-reconnect-types";

vi.mock("@/lib/firebase-admin", () => ({ getAdminDb: vi.fn() }));
vi.mock("@/lib/crm/warm-reconnect-executor", () => ({ runWarmReconnectPilotExecutor: vi.fn() }));

const uid = "owner-1";
const workspaceId = `workspace_default_${uid}`;
const pilotId = `wrp_${"a".repeat(32)}`;
const parentPilotId = `wrp_${"b".repeat(32)}`;
const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const executorMock = vi.mocked(runWarmReconnectPilotExecutor);
const lockPath = `${WARM_RECONNECT_CAMPAIGN_LOCK_COLLECTION}/${warmReconnectFollowOnPilotLockId(workspaceId)}`;
const pilotPath = `crm_warm_reconnect_pilots/${pilotId}`;

function fixture() {
  const lock: Record<string, unknown> = {
    schemaVersion: "crm.warm-reconnect-follow-on-lock.v1",
    workspaceId,
    campaignId: WARM_RECONNECT_CAMPAIGN_ID,
    campaignVersion: WARM_RECONNECT_CAMPAIGN_VERSION,
    tranche: "follow_on",
    pilotId,
    parentPilotId,
    batchSequence: 1,
    recipientCap: 2,
    state: "active",
  };
  const pilot: Record<string, unknown> = {
    pilotId, ownerUid: uid, workspaceId, tranche: "follow_on",
    parentPilotId, batchSequence: 1, recipientCap: 2,
    recipients: [{ recipientId: "recipient-1" }, { recipientId: "recipient-2" }],
    status: "launch_requested",
  };
  const documents = new Map<string, Record<string, unknown>>([[lockPath, lock], [pilotPath, pilot]]);
  const reads: string[] = [];
  function reference(path: string) {
    return {
      get: vi.fn(async () => {
        reads.push(path);
        const data = documents.get(path);
        return { exists: data !== undefined, data: () => data };
      }),
      collection: (name: string) => ({ doc: (id: string) => reference(`${path}/${name}/${id}`) }),
    };
  }
  const db = {
    collection: (name: string) => ({ doc: (id: string) => reference(`${name}/${id}`) }),
  } as unknown as Firestore;
  return { lock, pilot, documents, reads, db };
}

function dispatch(db: Firestore) {
  return dispatchWarmReconnectBatch({ uid, correlationId: "dispatch-correlation-1", log, db });
}

describe("warm reconnect batch dispatcher", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    executorMock.mockResolvedValue({ ok: true, outcome: "sent", providerCalled: true, receiptId: "receipt-1", complete: false });
  });

  it("stays idle without a follow-on lock and never scans unrelated pilots", async () => {
    const { documents, db, reads } = fixture();
    documents.delete(lockPath);
    documents.set("crm_warm_reconnect_pilots/unrelated-approved-pilot", { status: "launch_requested" });
    expect(await dispatch(db)).toEqual({ ok: true, outcome: "idle", providerCalled: false });
    expect(reads).toEqual([lockPath]);
    expect(executorMock).not.toHaveBeenCalled();
  });

  it.each(["", "../other-owner", "owner/other", "x".repeat(129)])("rejects invalid worker uid %j before reading", async (invalidUid) => {
    const { db, reads } = fixture();
    await expect(resolveWarmReconnectDispatchTarget(invalidUid, db)).rejects.toMatchObject({ status: 400 });
    expect(reads).toEqual([]);
  });

  it.each([
    ["schemaVersion", "other-schema"], ["workspaceId", "workspace_default_other-owner"],
    ["campaignId", "other-campaign"], ["campaignVersion", "other-version"],
    ["tranche", "initial_5"], ["pilotId", "../other-pilot"], ["parentPilotId", "invalid"],
    ["batchSequence", 0], ["batchSequence", 1.5], ["recipientCap", 0],
    ["recipientCap", 21], ["recipientCap", 2.5], ["state", "unknown"],
  ])("rejects a malformed or foreign lock: %s = %j", async (key, value) => {
    const { lock, db, reads } = fixture();
    lock[key as string] = value;
    await expect(dispatch(db)).rejects.toMatchObject({ status: 409 });
    expect(reads).toEqual([lockPath]);
    expect(executorMock).not.toHaveBeenCalled();
  });

  it("does not dispatch a released pre-provider lock", async () => {
    const { lock, db, reads } = fixture();
    lock.state = "released_before_provider";
    expect(await dispatch(db)).toEqual({ ok: true, outcome: "inactive", pilotId, providerCalled: false });
    expect(reads).toEqual([lockPath]);
    expect(executorMock).not.toHaveBeenCalled();
  });

  it.each([
    ["pilotId", parentPilotId], ["ownerUid", "other-owner"], ["workspaceId", "other-workspace"],
    ["tranche", "initial_5"], ["parentPilotId", `wrp_${"c".repeat(32)}`],
    ["batchSequence", 2], ["recipientCap", 3], ["recipients", []], ["recipients", null],
  ])("rejects a pilot that disagrees with its active lock: %s = %j", async (key, value) => {
    const { pilot, db } = fixture();
    pilot[key as string] = value;
    await expect(dispatch(db)).rejects.toMatchObject({ status: 409 });
    expect(executorMock).not.toHaveBeenCalled();
  });

  it("fails closed when the active pilot document is missing", async () => {
    const { documents, db } = fixture();
    documents.delete(pilotPath);
    await expect(dispatch(db)).rejects.toMatchObject({ status: 409 });
    expect(executorMock).not.toHaveBeenCalled();
  });

  it.each(["draft", "needs_recipient_review", "needs_campaign_approval", "approved"])("does not turn %s into launch authority", async (status) => {
    const { pilot, db, reads } = fixture();
    pilot.status = status;
    expect(await dispatch(db)).toEqual({ ok: true, outcome: "awaiting_launch", pilotId, providerCalled: false });
    expect(reads).toEqual([lockPath, pilotPath]);
    expect(executorMock).not.toHaveBeenCalled();
  });

  it.each(["stopped", "stale", "rejected"])("does not restart a %s pilot", async (status) => {
    const { pilot, db } = fixture();
    pilot.status = status;
    expect(await dispatch(db)).toEqual({ ok: true, outcome: "inactive", pilotId, providerCalled: false });
    expect(executorMock).not.toHaveBeenCalled();
  });

  it("recognizes exact durable completion without invoking the provider executor", async () => {
    const { documents, db } = fixture();
    documents.set(`${pilotPath}/executor/state`, {
      pilotId, workspaceId, complete: true, sentCount: 2, claimedCount: 2,
      activeReceiptId: null, halted: false,
    });
    expect(await dispatch(db)).toEqual({ ok: true, outcome: "complete", pilotId, providerCalled: false });
    expect(executorMock).not.toHaveBeenCalled();
  });

  it("passes one launched, lock-bound target and the same correlation id to one executor call", async () => {
    const { db, reads } = fixture();
    expect(await dispatch(db)).toMatchObject({ outcome: "sent", pilotId, providerCalled: true, complete: false });
    expect(executorMock).toHaveBeenCalledExactlyOnceWith({ uid, pilotId, correlationId: "dispatch-correlation-1", log, db });
    expect(reads).toEqual([lockPath, pilotPath, `${pilotPath}/executor/state`]);
    expect(getAdminDb).not.toHaveBeenCalled();
  });

  it("does not retry an executor rejection when the target changes after selection", async () => {
    const { db } = fixture();
    const changedLock = new ApiError(409, "The active follow-on batch changed. Reload the campaign desk.");
    executorMock.mockRejectedValue(changedLock);
    await expect(dispatch(db)).rejects.toBe(changedLock);
    expect(executorMock).toHaveBeenCalledOnce();
  });

  it.each([11, 20])("dispatches one recipient per invocation for a launched %i-person batch", async (cap) => {
    const { lock, pilot, db } = fixture();
    lock.recipientCap = cap;
    pilot.recipientCap = cap;
    pilot.recipients = Array.from({ length: cap }, (_, index) => ({ recipientId: `recipient-${index}` }));
    expect(await dispatch(db)).toMatchObject({ outcome: "sent", pilotId, complete: false });
    expect(executorMock).toHaveBeenCalledExactlyOnceWith({ uid, pilotId, correlationId: "dispatch-correlation-1", log, db });
  });

  it.each([19, 20])("requires the exact twenty-recipient completion count, not %i alone", async (sentCount) => {
    const { lock, pilot, db, documents } = fixture();
    lock.recipientCap = pilot.recipientCap = 20;
    pilot.recipients = Array.from({ length: 20 }, (_, index) => ({ recipientId: `recipient-${index}` }));
    documents.set(`${pilotPath}/executor/state`, { pilotId, workspaceId, complete: true, sentCount, claimedCount: 20, activeReceiptId: null, halted: false });
    expect((await dispatch(db)).outcome).toBe(sentCount === 20 ? "complete" : "sent");
    expect(executorMock).toHaveBeenCalledTimes(sentCount === 20 ? 0 : 1);
  });

  it.each([
    { ok: true as const, outcome: "busy" as const, providerCalled: false as const },
    { ok: true as const, outcome: "waiting" as const, providerCalled: false as const, retryAfterMs: 60_000 },
    { ok: true as const, outcome: "stopped" as const, providerCalled: false as const, reason: "provider_result_unknown" },
  ])("preserves the executor's $outcome gate without retry", async (result) => {
    const { db } = fixture();
    executorMock.mockResolvedValue(result);
    expect(await dispatch(db)).toEqual({ ...result, pilotId });
    expect(executorMock).toHaveBeenCalledOnce();
  });

  it("does not retry the losing tick when concurrent ticks meet the executor's durable-claim gate", async () => {
    const { db } = fixture();
    executorMock.mockResolvedValueOnce({ ok: true, outcome: "sent", providerCalled: true, receiptId: "receipt-1", complete: false });
    executorMock.mockResolvedValueOnce({ ok: true, outcome: "busy", providerCalled: false });
    const results = await Promise.all([dispatch(db), dispatch(db)]);
    expect(results.map((result) => result.outcome)).toEqual(["sent", "busy"]);
    expect(executorMock).toHaveBeenCalledTimes(2);
  });
});
