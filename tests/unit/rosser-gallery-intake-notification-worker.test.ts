import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  runIntakeNotificationWorkerCycle,
  type IntakeNotificationWorkerStore,
} from "@/lib/crm/rosser-gallery-intake-notification-worker";
import type { RosserGalleryIntakeWorkerConfig } from "@/lib/crm/rosser-gallery-intake-worker-config";

interface FakeReference {
  id: string;
  path: string;
  get(): Promise<{
    exists: boolean;
    data(): Record<string, unknown> | undefined;
  }>;
  set(data: Record<string, unknown>, options?: { merge: boolean }): Promise<void>;
}

interface FakeTransaction {
  get(reference: FakeReference): Promise<{
    exists: boolean;
    data(): Record<string, unknown> | undefined;
  }>;
  set(
    reference: FakeReference,
    data: Record<string, unknown>,
    options?: { merge: boolean }
  ): FakeTransaction;
}

class FakeWorkerStore {
  private readonly documents = new Map<string, Record<string, unknown>>();

  collection(name: string) {
    const store = this.documents;
    return {
      doc: (id: string): FakeReference => {
        const path = `${name}/${id}`;
        return {
          id,
          path,
          get: async () => {
            const data = store.get(path);
            return {
              exists: Boolean(data),
              data: () => (data ? structuredClone(data) : undefined),
            };
          },
          set: async (data, options) => {
            const current = store.get(path) || {};
            store.set(path, structuredClone(options?.merge ? { ...current, ...data } : data));
          },
        };
      },
      where: (field: string, operator: "==", value: unknown) => {
        if (operator !== "==") throw new Error("unsupported query");
        let maximum = Number.POSITIVE_INFINITY;
        const query = {
          limit: (limit: number) => {
            maximum = limit;
            return query;
          },
          get: async () => ({
            docs: Array.from(store.entries())
              .filter(
                ([path, row]) =>
                  path.startsWith(`${name}/`) && row[field] === value
              )
              .slice(0, maximum)
              .map(([path, row]) => ({
                id: path.slice(name.length + 1),
                exists: true,
                data: () => structuredClone(row),
              })),
          }),
        };
        return query;
      },
    };
  }

  async runTransaction<T>(
    operation: (transaction: FakeTransaction) => Promise<T>
  ): Promise<T> {
    const pending: Array<{
      reference: FakeReference;
      data: Record<string, unknown>;
      merge: boolean;
    }> = [];
    const transaction: FakeTransaction = {
      get: async (reference) => {
        const data = this.documents.get(reference.path);
        return {
          exists: Boolean(data),
          data: () => (data ? structuredClone(data) : undefined),
        };
      },
      set: (reference, data, options) => {
        pending.push({ reference, data, merge: options?.merge === true });
        return transaction;
      },
    };
    const result = await operation(transaction);
    for (const write of pending) {
      const current = this.documents.get(write.reference.path) || {};
      this.documents.set(
        write.reference.path,
        structuredClone(write.merge ? { ...current, ...write.data } : write.data)
      );
    }
    return result;
  }

  seed(path: string, data: Record<string, unknown>): void {
    this.documents.set(path, structuredClone(data));
  }

  read(path: string): Record<string, unknown> | undefined {
    const data = this.documents.get(path);
    return data ? structuredClone(data) : undefined;
  }
}

const config: RosserGalleryIntakeWorkerConfig = {
  gmailUserId: "owner-uid",
  workerToken: "worker-token-with-at-least-thirty-two-characters",
};

const log = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

function seedChannel(
  store: FakeWorkerStore,
  args: {
    outboxId: string;
    receiptId: string;
    channel: "owner_alert" | "submitter_acknowledgment";
    recipient: string;
    status?: "queued" | "processing";
    attemptCount?: number;
    maxAttempts?: number;
    leaseUntil?: string | null;
    nextAttemptAt?: string | null;
  }
): void {
  const templateVersion =
    args.channel === "owner_alert"
      ? "rosser-gallery-owner-intake-v1"
      : "rosser-gallery-thank-you-v1";
  store.seed(`crm_notification_outbox/${args.outboxId}`, {
    schemaVersion: 1,
    ownerUid: "owner-uid",
    workspaceId: "workspace-id",
    businessUnit: "rosser_nft_gallery",
    intakeBusinessUnit: "rosser_gallery",
    customerId: "customer-1",
    externalEventId: "intake_d5d5cbb7-6fd5-4e71-a537-f3975646630f",
    lane: "meeting_interest",
    channel: args.channel,
    receiptId: args.receiptId,
    templateVersion,
    recipient: args.recipient,
    subject: "Thank you for connecting",
    textBody: "Warm plain-text message from Marcus.",
    htmlBody: "<p>Warm HTML message from Marcus.</p>",
    emailFormat: "multipart_alternative",
    status: args.status || "queued",
    attemptCount: args.attemptCount || 0,
    maxAttempts: args.maxAttempts || 5,
    leaseUntil: args.leaseUntil ?? null,
    nextAttemptAt: args.nextAttemptAt ?? "2026-07-28T21:00:00.000Z",
    queuedAt: "2026-07-28T21:00:00.000Z",
  });
  store.seed(`crm_notification_receipts/${args.receiptId}`, {
    schemaVersion: 1,
    outboxId: args.outboxId,
    channel: args.channel,
    templateVersion,
    status: args.status || "queued",
    attemptCount: args.attemptCount || 0,
  });
}

function dependencies(
  store: FakeWorkerStore,
  now: Date,
  options?: {
    search?: ReturnType<typeof vi.fn>;
    send?: ReturnType<typeof vi.fn>;
  }
) {
  return {
    db: store as unknown as IntakeNotificationWorkerStore,
    now: () => now,
    serverTimestamp: () => "server-timestamp",
    getAccessToken: vi.fn().mockResolvedValue("gmail-access-token"),
    search: options?.search || vi.fn().mockResolvedValue([]),
    send:
      options?.send ||
      vi.fn().mockImplementation(async (_token, email) => ({
        id: `gmail-${email.to[0]}`,
        threadId: `thread-${email.to[0]}`,
      })),
  };
}

describe("Rosser Gallery intake notification worker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("claims and delivers both server-created channels as multipart Gmail messages", async () => {
    const store = new FakeWorkerStore();
    store.seed("leads/customer-1", {
      userId: "owner-uid",
      email: "visitor@example.com",
    });
    seedChannel(store, {
      outboxId: "outbox-owner",
      receiptId: "receipt-owner",
      channel: "owner_alert",
      recipient: "mrosser@rossergallery.com",
    });
    seedChannel(store, {
      outboxId: "outbox-thanks",
      receiptId: "receipt-thanks",
      channel: "submitter_acknowledgment",
      recipient: "visitor@example.com",
    });
    const deps = dependencies(store, new Date("2026-07-28T21:00:01.000Z"));

    const result = await runIntakeNotificationWorkerCycle({
      config,
      correlationId: "worker-unit-test-0001",
      log,
      dependencies: deps,
    });

    expect(result).toMatchObject({
      candidates: 2,
      claimed: 2,
      sent: 2,
      recovered: 0,
      failed: 0,
    });
    expect(deps.send).toHaveBeenCalledTimes(2);
    const delivered = deps.send.mock.calls.map((call) => call[1]);
    expect(delivered).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          to: ["mrosser@rossergallery.com"],
          htmlBody: "<p>Warm HTML message from Marcus.</p>",
          messageId: expect.stringMatching(
            /^<intake\.[a-f0-9]{48}@rossergallery\.com>$/
          ),
        }),
        expect.objectContaining({ to: ["visitor@example.com"] }),
      ])
    );
    expect(store.read("crm_notification_outbox/outbox-owner")).toMatchObject({
      status: "completed",
      attemptCount: 1,
      leaseUntil: null,
      recovered: false,
    });
    expect(store.read("crm_notification_receipts/receipt-thanks")).toMatchObject({
      status: "completed",
      attemptCount: 1,
      gmailMessageId: "gmail-visitor@example.com",
    });

    const second = await runIntakeNotificationWorkerCycle({
      config,
      correlationId: "worker-unit-test-0002",
      log,
      dependencies: deps,
    });
    expect(second.candidates).toBe(0);
    expect(deps.send).toHaveBeenCalledTimes(2);
  });

  it("recovers an expired lease by Message-ID lookup instead of sending again", async () => {
    const store = new FakeWorkerStore();
    store.seed("leads/customer-1", { email: "visitor@example.com" });
    seedChannel(store, {
      outboxId: "outbox-thanks",
      receiptId: "receipt-thanks",
      channel: "submitter_acknowledgment",
      recipient: "visitor@example.com",
      status: "processing",
      attemptCount: 1,
      leaseUntil: "2026-07-28T20:59:00.000Z",
      nextAttemptAt: null,
    });
    const search = vi.fn().mockResolvedValue([
      { id: "already-sent", threadId: "already-thread", snippet: "" },
    ]);
    const send = vi.fn();
    const deps = dependencies(store, new Date("2026-07-28T21:00:00.000Z"), {
      search,
      send,
    });

    const result = await runIntakeNotificationWorkerCycle({
      config,
      correlationId: "worker-recovery-0001",
      log,
      dependencies: deps,
    });

    expect(result).toMatchObject({ claimed: 1, recovered: 1, sent: 0 });
    expect(send).not.toHaveBeenCalled();
    expect(store.read("crm_notification_receipts/receipt-thanks")).toMatchObject({
      status: "completed",
      recovered: true,
      gmailMessageId: "already-sent",
      attemptCount: 2,
    });
  });

  it("retries a failed delivery and dead-letters at the bounded attempt limit", async () => {
    const store = new FakeWorkerStore();
    store.seed("leads/customer-1", { email: "visitor@example.com" });
    seedChannel(store, {
      outboxId: "outbox-thanks",
      receiptId: "receipt-thanks",
      channel: "submitter_acknowledgment",
      recipient: "visitor@example.com",
      maxAttempts: 2,
    });
    const send = vi.fn().mockRejectedValue(new Error("synthetic provider failure"));

    const first = await runIntakeNotificationWorkerCycle({
      config,
      correlationId: "worker-retry-0001",
      log,
      dependencies: dependencies(
        store,
        new Date("2026-07-28T21:00:01.000Z"),
        { send }
      ),
    });
    expect(first).toMatchObject({ failed: 1, retried: 1, deadLettered: 0 });
    expect(store.read("crm_notification_outbox/outbox-thanks")).toMatchObject({
      status: "queued",
      attemptCount: 1,
      nextAttemptAt: "2026-07-28T21:00:31.000Z",
    });

    const second = await runIntakeNotificationWorkerCycle({
      config,
      correlationId: "worker-retry-0002",
      log,
      dependencies: dependencies(
        store,
        new Date("2026-07-28T21:00:32.000Z"),
        { send }
      ),
    });
    expect(second).toMatchObject({ failed: 1, retried: 0, deadLettered: 1 });
    expect(store.read("crm_notification_receipts/receipt-thanks")).toMatchObject({
      status: "dead_letter",
      attemptCount: 2,
      nextAttemptAt: null,
      lastErrorCode: "Error",
    });
  });

  it("fails closed before Gmail when a queued recipient is not server allowlisted", async () => {
    const store = new FakeWorkerStore();
    store.seed("leads/customer-1", { email: "visitor@example.com" });
    seedChannel(store, {
      outboxId: "outbox-owner",
      receiptId: "receipt-owner",
      channel: "owner_alert",
      recipient: "attacker@example.com",
    });
    const deps = dependencies(store, new Date("2026-07-28T21:00:01.000Z"));

    const result = await runIntakeNotificationWorkerCycle({
      config,
      correlationId: "worker-allowlist-0001",
      log,
      dependencies: deps,
    });
    expect(result).toMatchObject({ candidates: 1, claimed: 0, failed: 1 });
    expect(deps.getAccessToken).not.toHaveBeenCalled();
    expect(deps.send).not.toHaveBeenCalled();
  });
});
