import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/webhooks/square/route";
import { getAdminDb } from "@/lib/firebase-admin";
import { computeSquareWebhookSignature } from "@/lib/revenue/square";

vi.mock("@/lib/firebase-admin", () => ({
  getAdminDb: vi.fn(),
}));

const getAdminDbMock = vi.mocked(getAdminDb);

type FirestoreFilter = {
  field: string;
  op: string;
  value: unknown;
};

type FirestoreDocRef = {
  kind: "doc";
  collectionName: string;
  id: string;
};

type FirestoreQuery = {
  kind: "query";
  collectionName: string;
  filters: FirestoreFilter[];
  limitCount: number | null;
  where: (field: string, op: string, value: unknown) => FirestoreQuery;
  limit: (count: number) => FirestoreQuery;
};

type LeadSeed = {
  id: string;
  data: Record<string, unknown>;
};

type FakeDbResult = {
  db: {
    collection: (name: string) => {
      doc: (id: string) => FirestoreDocRef;
      where: (field: string, op: string, value: unknown) => FirestoreQuery;
    };
    runTransaction: (fn: (tx: FakeTransaction) => Promise<unknown>) => Promise<unknown>;
  };
  queryReads: FirestoreQuery[];
  leadWrites: Array<{ id: string; data: Record<string, unknown> }>;
  eventWrites: Array<{ id: string; data: Record<string, unknown> }>;
};

type FakeTransaction = {
  get: (target: FirestoreDocRef | FirestoreQuery) => Promise<{
    exists?: boolean;
    id?: string;
    data: () => Record<string, unknown> | undefined;
    docs?: Array<{ id: string; data: () => Record<string, unknown> }>;
  }>;
  set: (ref: FirestoreDocRef, data: Record<string, unknown>, options?: { merge?: boolean }) => void;
};

function createContext() {
  return { params: Promise.resolve({}) };
}

function createQuery(collectionName: string, filters: FirestoreFilter[] = [], limitCount: number | null = null): FirestoreQuery {
  return {
    kind: "query",
    collectionName,
    filters,
    limitCount,
    where(field: string, op: string, value: unknown) {
      return createQuery(collectionName, [...filters, { field, op, value }], limitCount);
    },
    limit(count: number) {
      return createQuery(collectionName, filters, count);
    },
  };
}

function matchesFilters(data: Record<string, unknown>, filters: FirestoreFilter[]): boolean {
  return filters.every((filter) => {
    if (filter.op !== "==") return false;
    return data[filter.field] === filter.value;
  });
}

function createFakeDb(input: { leads?: LeadSeed[]; existingEvents?: Record<string, Record<string, unknown>> } = {}): FakeDbResult {
  const leads = input.leads || [];
  const existingEvents = input.existingEvents || {};
  const leadsById = new Map(leads.map((lead) => [lead.id, { ...lead.data }]));
  const eventsById = new Map(Object.entries(existingEvents).map(([id, data]) => [id, { ...data }]));
  const queryReads: FirestoreQuery[] = [];
  const leadWrites: Array<{ id: string; data: Record<string, unknown> }> = [];
  const eventWrites: Array<{ id: string; data: Record<string, unknown> }> = [];

  const db = {
    collection(name: string) {
      return {
        doc(id: string): FirestoreDocRef {
          return { kind: "doc", collectionName: name, id };
        },
        where(field: string, op: string, value: unknown): FirestoreQuery {
          return createQuery(name, [{ field, op, value }], null);
        },
      };
    },
    async runTransaction(fn: (tx: FakeTransaction) => Promise<unknown>) {
      const tx: FakeTransaction = {
        async get(target) {
          if (target.kind === "doc") {
            if (target.collectionName === "leads") {
              const leadData = leadsById.get(target.id);
              return {
                exists: Boolean(leadData),
                id: target.id,
                data: () => (leadData ? { ...leadData } : undefined),
              };
            }
            if (target.collectionName === "square_webhook_events") {
              const eventData = eventsById.get(target.id);
              return {
                exists: Boolean(eventData),
                id: target.id,
                data: () => (eventData ? { ...eventData } : undefined),
              };
            }
          }

          queryReads.push(target);
          if (target.collectionName !== "leads") {
            return { docs: [], data: () => undefined };
          }

          const matched = Array.from(leadsById.entries())
            .filter(([, data]) => matchesFilters(data, target.filters))
            .map(([id, data]) => ({ id, data }));
          const limited = typeof target.limitCount === "number" ? matched.slice(0, target.limitCount) : matched;

          return {
            docs: limited.map((entry) => ({
              id: entry.id,
              data: () => ({ ...entry.data }),
            })),
            data: () => undefined,
          };
        },
        set(ref, data) {
          if (ref.collectionName === "leads") {
            const existing = leadsById.get(ref.id) || {};
            leadsById.set(ref.id, { ...existing, ...data });
            leadWrites.push({ id: ref.id, data: { ...data } });
            return;
          }
          if (ref.collectionName === "square_webhook_events") {
            const existing = eventsById.get(ref.id) || {};
            eventsById.set(ref.id, { ...existing, ...data });
            eventWrites.push({ id: ref.id, data: { ...data } });
          }
        },
      };

      return fn(tx);
    },
  };

  return { db, queryReads, leadWrites, eventWrites };
}

describe("square webhook route", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
    process.env.SQUARE_WEBHOOK_SIGNATURE_KEY = "square-secret";
  });

  it("rejects invalid signature", async () => {
    const fakeDb = createFakeDb();
    getAdminDbMock.mockReturnValue(fakeDb.db as unknown as ReturnType<typeof getAdminDb>);

    const payload = {
      event_id: "evt-1",
      type: "payment.updated",
      data: {
        object: {
          payment: {
            status: "COMPLETED",
          },
        },
      },
      metadata: {
        offerCode: "RTS-QUICK-WEBSITE-SPRINT",
        uid: "user-1",
      },
    };

    const req = new Request("http://localhost/api/webhooks/square", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-square-hmacsha256-signature": "invalid",
      },
      body: JSON.stringify(payload),
    });

    const res = await POST(
      req as Parameters<typeof POST>[0],
      createContext() as Parameters<typeof POST>[1]
    );
    const data = await res.json();

    expect(res.status).toBe(401);
    expect(data.error).toContain("Invalid Square webhook signature");
    expect(fakeDb.leadWrites).toHaveLength(0);
  });

  it("prefers offer-matched lead queries and updates the matched lead", async () => {
    const fakeDb = createFakeDb({
      leads: [
        {
          id: "lead_unrelated",
          data: {
            userId: "user-1",
            offerCode: "RNG-COMMISSION-SCULPTURE",
            pipelineStage: "proposal",
            status: "meeting",
          },
        },
        {
          id: "lead_match",
          data: {
            userId: "user-1",
            offerCode: "RTS-QUICK-WEBSITE-SPRINT",
            pipelineStage: "proposal",
            status: "meeting",
          },
        },
      ],
    });
    getAdminDbMock.mockReturnValue(fakeDb.db as unknown as ReturnType<typeof getAdminDb>);

    const payload = {
      event_id: "evt-2",
      type: "payment.updated",
      data: {
        object: {
          payment: {
            status: "COMPLETED",
            note: "no lead hint present",
          },
        },
      },
      metadata: {
        offerCode: "RTS-QUICK-WEBSITE-SPRINT",
        uid: "user-1",
      },
    };

    const rawBody = JSON.stringify(payload);
    const requestUrl = "http://localhost/api/webhooks/square";
    const signature = computeSquareWebhookSignature({
      notificationUrl: requestUrl,
      rawBody,
      signatureKey: "square-secret",
    });

    const req = new Request(requestUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-square-hmacsha256-signature": signature,
      },
      body: rawBody,
    });

    const res = await POST(
      req as Parameters<typeof POST>[0],
      createContext() as Parameters<typeof POST>[1]
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.applied).toBe(true);
    expect(data.leadDocId).toBe("lead_match");

    const usedOfferFilter = fakeDb.queryReads.some((query) =>
      query.filters.some((filter) => filter.field === "offerCode" && filter.value === "RTS-QUICK-WEBSITE-SPRINT")
    );
    expect(usedOfferFilter).toBe(true);

    const broadFallbackQueryUsed = fakeDb.queryReads.some((query) =>
      query.filters.length === 1 && query.filters[0]?.field === "userId"
    );
    expect(broadFallbackQueryUsed).toBe(false);

    expect(fakeDb.leadWrites[0]?.id).toBe("lead_match");
    expect(fakeDb.eventWrites[0]?.id).toBe("evt-2");
  });
});
