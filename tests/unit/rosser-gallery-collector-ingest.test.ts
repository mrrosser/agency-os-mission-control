import { describe, expect, it } from "vitest";
import fixtureJson from "@/contracts/rosser-gallery/collector-lead.v1.json";
import etsyFixtureJson from "@/contracts/rosser-gallery/etsy-launch-waitlist.v2.json";
import whiteLinenFixtureJson from "@/contracts/rosser-gallery/white-linen-preview-lead.v2.json";
import {
  ingestRosserGalleryCollectorLead,
  stableRosserGalleryCustomerId,
  type CrmIngestStore,
} from "@/lib/crm/rosser-gallery-collector-ingest";
import {
  rosserGalleryCollectorLeadV1Schema,
  rosserGalleryEtsyLeadV2Schema,
  rosserGalleryWhiteLinenLeadV2Schema,
} from "@/lib/crm/rosser-gallery-collector-contract";
import type { RosserGalleryCrmConfig } from "@/lib/crm/rosser-gallery-crm-config";

interface FakeReference {
  id: string;
  path: string;
  get(): Promise<{
    exists: boolean;
    data(): Record<string, unknown> | undefined;
  }>;
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

class FakeCrmStore {
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
        };
      },
      where: (field: string, operator: "==", value: unknown) => {
        if (operator !== "==") throw new Error(`Unsupported fake operator: ${operator}`);
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

  records(collection: string): Array<[string, Record<string, unknown>]> {
    return Array.from(this.documents.entries())
      .filter(([path]) => path.startsWith(`${collection}/`))
      .map(([path, data]) => [path, structuredClone(data)]);
  }

  seed(path: string, data: Record<string, unknown>): void {
    this.documents.set(path, structuredClone(data));
  }
}

const config: RosserGalleryCrmConfig = {
  ingestToken: "ingest-token-with-at-least-thirty-two-characters",
  ownerUid: "owner-uid",
  workspaceId: "rosser-gallery-workspace",
  businessUnit: "rosser_nft_gallery",
  customerIdHmacSecret: "customer-id-secret-with-at-least-thirty-two-characters",
};

function fixture() {
  return rosserGalleryCollectorLeadV1Schema.parse(structuredClone(fixtureJson));
}

function dependencies(store: FakeCrmStore, dailyCreateLimit?: number) {
  return {
    db: store as unknown as CrmIngestStore,
    correlationId: "rng-ingest-unit-test-0001",
    now: () => new Date("2026-07-25T16:00:00.000Z"),
    serverTimestamp: () => "server-timestamp",
    dailyCreateLimit,
  };
}

function v2Dependencies(store: FakeCrmStore) {
  return {
    ...dependencies(store),
    now: () => new Date("2026-07-27T16:31:00.000Z"),
  };
}

describe("Rosser Gallery collector-lead CRM projection", () => {
  it("atomically writes the customer, timeline event, and PII-free receipt", async () => {
    const store = new FakeCrmStore();
    const payload = fixture();

    const result = await ingestRosserGalleryCollectorLead(
      payload,
      config,
      dependencies(store)
    );

    expect(result.replayed).toBe(false);
    const leads = store.records("leads");
    const activities = store.records("activities");
    const receipts = store.records("crm_ingest_receipts");
    expect(leads).toHaveLength(1);
    expect(activities).toHaveLength(1);
    expect(receipts).toHaveLength(1);
    expect(store.records("crm_contact_identities")).toHaveLength(1);
    expect(store.records("crm_consent_events")).toHaveLength(1);
    expect(store.records("crm_ingest_rate_limits")[0][1]).toMatchObject({
      createCount: 1,
      limit: 500,
    });

    expect(leads[0][1]).toMatchObject({
      userId: config.ownerUid,
      ownerUid: config.ownerUid,
      workspaceId: config.workspaceId,
      businessUnit: "rosser_nft_gallery",
      recordType: "individual_collector",
      email: "collector@example.com",
      owner: config.ownerUid,
      next_action: "schedule_private_viewing",
      correlationId: "rng-ingest-unit-test-0001",
      consentScopes: {
        rosser_gallery_collector: {
          responseEmail: true,
          marketingEmail: false,
          sms: false,
          rtSolutions: false,
        },
      },
      offerCode: "RNG-COLLECTOR-PREVIEW",
      pipelineStage: "lead_capture",
    });
    expect(activities[0][1]).toMatchObject({
      customerId: result.customerId,
      externalEventId: payload.externalEventId,
      workspaceId: config.workspaceId,
    });

    const receiptText = JSON.stringify(receipts[0][1]);
    expect(receiptText).not.toContain(payload.contact.email);
    expect(receiptText).not.toContain(payload.contact.name);
    expect(receiptText).not.toContain(payload.collector.city);
    expect(receiptText).not.toContain(payload.collector.note);
    const identityText = JSON.stringify(store.records("crm_contact_identities")[0][1]);
    expect(identityText).not.toContain(payload.contact.email);
    expect(identityText).not.toContain(payload.contact.name);
    expect(store.records("crm_consent_events")[0][1]).toMatchObject({
      grants: ["rosser_gallery.inquiry_response"],
      correlationId: "rng-ingest-unit-test-0001",
    });
  });

  it("returns the stored result for an identical retry without duplicate writes", async () => {
    const store = new FakeCrmStore();
    const payload = fixture();

    const first = await ingestRosserGalleryCollectorLead(
      payload,
      config,
      dependencies(store)
    );
    const retry = await ingestRosserGalleryCollectorLead(
      payload,
      config,
      dependencies(store)
    );

    expect(retry).toEqual({ ...first, replayed: true });
    expect(store.records("leads")).toHaveLength(1);
    expect(store.records("activities")).toHaveLength(1);
    expect(store.records("crm_ingest_receipts")).toHaveLength(1);
    expect(store.records("crm_contact_identities")).toHaveLength(1);
    expect(store.records("crm_consent_events")).toHaveLength(1);
    expect(store.records("crm_ingest_rate_limits")[0][1].createCount).toBe(1);
  });

  it("honors a stored exact replay after the new-event delivery window expires", async () => {
    const store = new FakeCrmStore();
    const payload = fixture();
    const first = await ingestRosserGalleryCollectorLead(
      payload,
      config,
      dependencies(store)
    );
    const staleClock = {
      ...dependencies(store),
      now: () => new Date("2026-08-03T16:00:00.000Z"),
    };

    const replay = await ingestRosserGalleryCollectorLead(
      payload,
      config,
      staleClock
    );
    expect(replay).toEqual({ ...first, replayed: true });

    const neverSeen = fixture();
    neverSeen.externalEventId =
      "rg_collector_1f5c80f6-c36d-4a05-afac-f4da92657f8c";
    await expect(
      ingestRosserGalleryCollectorLead(neverSeen, config, staleClock)
    ).rejects.toMatchObject({ status: 400 });
    expect(store.records("crm_ingest_receipts")).toHaveLength(1);
  });

  it("rejects a reused event ID when the payload changes", async () => {
    const store = new FakeCrmStore();
    const original = fixture();
    await ingestRosserGalleryCollectorLead(original, config, dependencies(store));

    const changed = fixture();
    changed.collector.note = "A changed note must not reuse an event ID.";

    await expect(
      ingestRosserGalleryCollectorLead(changed, config, dependencies(store))
    ).rejects.toMatchObject({ status: 409 });
    expect(store.records("activities")).toHaveLength(1);
  });

  it("fails closed when a v2 receipt loses its lane metadata", async () => {
    const store = new FakeCrmStore();
    const payload = rosserGalleryWhiteLinenLeadV2Schema.parse(
      structuredClone(whiteLinenFixtureJson)
    );
    const first = await ingestRosserGalleryCollectorLead(
      payload,
      config,
      v2Dependencies(store)
    );
    const receipt = store.records("crm_ingest_receipts")[0][1];
    store.seed(`crm_ingest_receipts/${first.receiptId}`, {
      ...receipt,
      campaignId: "the-braider-atlanta",
    });

    await expect(
      ingestRosserGalleryCollectorLead(payload, config, v2Dependencies(store))
    ).rejects.toMatchObject({ status: 409 });
    expect(store.records("activities")).toHaveLength(1);
    expect(store.records("crm_ingest_receipts")).toHaveLength(1);
  });

  it("rejects a replay when the server-owned CRM route changes", async () => {
    const store = new FakeCrmStore();
    const payload = fixture();
    await ingestRosserGalleryCollectorLead(payload, config, dependencies(store));

    await expect(
      ingestRosserGalleryCollectorLead(
        payload,
        { ...config, workspaceId: "a-different-workspace" },
        dependencies(store)
      )
    ).rejects.toMatchObject({ status: 409 });
    expect(store.records("leads")).toHaveLength(1);
    expect(store.records("activities")).toHaveLength(1);
    expect(store.records("crm_ingest_receipts")).toHaveLength(1);
    expect(store.records("crm_contact_identities")).toHaveLength(1);
  });

  it("uses one stable customer for separate events from the same normalized email", async () => {
    const store = new FakeCrmStore();
    const first = fixture();
    const second = fixture();
    second.externalEventId =
      "rg_collector_eb1196de-6d4a-49e7-a648-2b086dad20de";
    second.contact.email = "COLLECTOR@example.com";

    const firstResult = await ingestRosserGalleryCollectorLead(
      first,
      config,
      dependencies(store)
    );
    const secondResult = await ingestRosserGalleryCollectorLead(
      second,
      config,
      dependencies(store)
    );

    expect(secondResult.customerId).toBe(firstResult.customerId);
    expect(store.records("leads")).toHaveLength(1);
    expect(store.records("activities")).toHaveLength(2);
    expect(store.records("crm_ingest_receipts")).toHaveLength(2);
  });

  it("reuses an existing same-tenant legacy customer with a random document ID", async () => {
    const store = new FakeCrmStore();
    const payload = fixture();
    store.seed("leads/legacy-random-id", {
      userId: config.ownerUid,
      ownerUid: config.ownerUid,
      email: payload.contact.email.toUpperCase(),
      companyName: "Existing Collector",
      pipelineStage: "qualification",
    });

    const result = await ingestRosserGalleryCollectorLead(
      payload,
      config,
      dependencies(store)
    );

    expect(result.customerId).toBe("legacy-random-id");
    expect(store.records("leads")).toHaveLength(1);
    expect(store.records("leads")[0][1]).toMatchObject({
      pipelineStage: "qualification",
      latestCampaign: payload.campaign,
    });
  });

  it("locks a bootstrapped legacy identity to one customer across later duplicates", async () => {
    const store = new FakeCrmStore();
    const first = fixture();
    store.seed("leads/z-legacy-id", {
      userId: config.ownerUid,
      email: first.contact.email,
      companyName: "Original Legacy Collector",
    });

    const firstResult = await ingestRosserGalleryCollectorLead(
      first,
      config,
      dependencies(store)
    );
    store.seed("leads/a-later-duplicate", {
      userId: config.ownerUid,
      email: first.contact.email,
      companyName: "Later Duplicate",
    });
    const second = fixture();
    second.externalEventId =
      "rg_collector_9f9f0dcf-25e2-4513-bcd2-e17ac438d782";

    const secondResult = await ingestRosserGalleryCollectorLead(
      second,
      config,
      dependencies(store)
    );

    expect(firstResult.customerId).toBe("z-legacy-id");
    expect(secondResult.customerId).toBe("z-legacy-id");
    expect(store.records("crm_contact_identities")).toHaveLength(1);
  });

  it("fails closed when an unmapped contact already has multiple customer records", async () => {
    const store = new FakeCrmStore();
    const payload = fixture();
    for (const id of ["duplicate-one", "duplicate-two"]) {
      store.seed(`leads/${id}`, {
        userId: config.ownerUid,
        email: payload.contact.email,
        companyName: id,
      });
    }

    await expect(
      ingestRosserGalleryCollectorLead(payload, config, dependencies(store))
    ).rejects.toMatchObject({ status: 409 });
    expect(store.records("activities")).toHaveLength(0);
    expect(store.records("crm_ingest_receipts")).toHaveLength(0);
    expect(store.records("crm_contact_identities")).toHaveLength(0);
  });

  it("records delayed events without regressing the latest inquiry snapshot", async () => {
    const store = new FakeCrmStore();
    const newest = fixture();
    newest.capturedAt = "2026-07-25T15:45:00.000Z";
    newest.contact.name = "Newest Collector Name";
    newest.collector.interest = "commission";
    newest.collector.note = "Newest commission request";

    const delayed = fixture();
    delayed.externalEventId =
      "rg_collector_26ed0a4b-b74e-4c03-b203-c82c72ad2f9d";
    delayed.contact.name = "Older Collector Name";
    delayed.collector.interest = "mini";

    await ingestRosserGalleryCollectorLead(newest, config, dependencies(store));
    await ingestRosserGalleryCollectorLead(delayed, config, dependencies(store));

    const customer = store.records("leads")[0][1];
    expect(customer).toMatchObject({
      contactName: "Newest Collector Name",
      sourceEventId: newest.externalEventId,
      latestOfferCode: "RNG-COMMISSION-SCULPTURE",
      lastInquiryAt: newest.capturedAt,
      collectorProfile: {
        city: newest.collector.city,
        interest: newest.collector.interest,
      },
      offerCode: "RNG-COMMISSION-SCULPTURE",
    });
    expect(store.records("activities")).toHaveLength(2);
    expect(store.records("crm_ingest_receipts")).toHaveLength(2);
  });

  it("enforces a distributed daily create quota without charging replays", async () => {
    const store = new FakeCrmStore();
    const first = fixture();
    const firstResult = await ingestRosserGalleryCollectorLead(
      first,
      config,
      dependencies(store, 1)
    );
    const replay = await ingestRosserGalleryCollectorLead(
      first,
      config,
      dependencies(store, 1)
    );
    expect(replay).toEqual({ ...firstResult, replayed: true });

    const second = fixture();
    second.externalEventId =
      "rg_collector_b1013ab8-47fd-40f0-9040-d3fbd2d3661a";
    await expect(
      ingestRosserGalleryCollectorLead(
        second,
        config,
        dependencies(store, 1)
      )
    ).rejects.toMatchObject({ status: 429 });
    expect(store.records("crm_ingest_receipts")).toHaveLength(1);
    expect(store.records("crm_ingest_rate_limits")[0][1].createCount).toBe(1);
  });

  it("keeps Gallery marketing consent purpose-scoped and append-only", async () => {
    const store = new FakeCrmStore();
    const optedIn = fixture();
    optedIn.permissions.marketingEmail = true;
    optedIn.permissions.consentedAt = "2026-07-25T15:29:30.000Z";
    await ingestRosserGalleryCollectorLead(
      optedIn,
      config,
      dependencies(store)
    );

    const uncheckedLater = fixture();
    uncheckedLater.externalEventId =
      "rg_collector_aeb64b23-e3d7-4102-aeac-9a8de363b182";
    uncheckedLater.capturedAt = "2026-07-25T15:45:00.000Z";
    await ingestRosserGalleryCollectorLead(
      uncheckedLater,
      config,
      dependencies(store)
    );

    const customer = store.records("leads")[0][1];
    expect(customer).not.toHaveProperty("marketingEmailConsent");
    expect(customer.consentScopes).toMatchObject({
      rosser_gallery_collector: {
        responseEmail: true,
        marketingEmail: true,
        marketingConsentedAt: "2026-07-25T15:29:30.000Z",
        marketingConsentVersion: "collector-v1",
      },
    });
    const consentEvents = store.records("crm_consent_events");
    expect(consentEvents).toHaveLength(2);
    expect(consentEvents[0][1].grants).toContain(
      "rosser_gallery.marketing_email"
    );
    expect(consentEvents[1][1].grants).toEqual([
      "rosser_gallery.inquiry_response",
    ]);
  });

  it("adds gallery context without erasing an existing CRM stage, phone, or consent", async () => {
    const store = new FakeCrmStore();
    const payload = fixture();
    const customerId = stableRosserGalleryCustomerId(
      payload.contact.email,
      config.workspaceId,
      config.customerIdHmacSecret
    );
    store.seed(`leads/${customerId}`, {
      companyName: "Existing Collector Company",
      contactName: "Previous Name",
      email: payload.contact.email,
      phone: "+15045550101",
      businessUnit: "rt_solutions",
      businessUnits: ["rt_solutions"],
      pipelineStage: "proposal",
      status: "qualified",
      marketingEmailConsent: true,
      smsConsent: true,
      rtSolutionsConsent: true,
      consentVersion: "legacy-opt-in-v2",
      consentedAt: "2026-06-01T12:00:00.000Z",
    });

    await ingestRosserGalleryCollectorLead(payload, config, dependencies(store));
    const customer = store.records("leads")[0][1];

    expect(customer).toMatchObject({
      companyName: "Existing Collector Company",
      phone: "+15045550101",
      businessUnit: "rt_solutions",
      businessUnits: ["rt_solutions", "rosser_nft_gallery"],
      latestBusinessUnit: "rosser_nft_gallery",
      pipelineStage: "proposal",
      status: "qualified",
      marketingEmailConsent: true,
      smsConsent: true,
      rtSolutionsConsent: true,
      consentVersion: "legacy-opt-in-v2",
      consentedAt: "2026-06-01T12:00:00.000Z",
      consentScopes: {
        rosser_gallery_collector: {
          responseEmail: true,
          marketingEmail: false,
        },
      },
    });
  });

  it("dedupes one person across White Linen and Etsy while appending server-owned tags", async () => {
    const store = new FakeCrmStore();
    const whiteRaw = structuredClone(whiteLinenFixtureJson) as Record<string, unknown>;
    whiteRaw.eventType = "commission_inquiry";
    const whiteContact = whiteRaw.contact as Record<string, unknown>;
    whiteContact.email = "shared.collector@example.com";
    const whiteCollector = whiteRaw.collector as Record<string, unknown>;
    whiteCollector.interest = "commission";
    const white = rosserGalleryWhiteLinenLeadV2Schema.parse(whiteRaw);

    const etsyRaw = structuredClone(etsyFixtureJson) as Record<string, unknown>;
    etsyRaw.eventType = "etsy_product_inquiry";
    etsyRaw.externalEventId =
      "rg_etsy_inquiry_1d4708d3-e42f-48a7-a6e1-b71fd19fa3b7";
    const etsyContact = etsyRaw.contact as Record<string, unknown>;
    etsyContact.email = "SHARED.COLLECTOR@example.com";
    const etsyCollector = etsyRaw.collector as Record<string, unknown>;
    etsyCollector.interest = "product-inquiry";
    etsyCollector.work = "transceiver";
    etsyCollector.note = "How will the Transceiver finish look in natural light?";
    const etsy = rosserGalleryEtsyLeadV2Schema.parse(etsyRaw);

    const whiteResult = await ingestRosserGalleryCollectorLead(
      white,
      config,
      v2Dependencies(store)
    );
    const etsyResult = await ingestRosserGalleryCollectorLead(
      etsy,
      config,
      v2Dependencies(store)
    );
    const replay = await ingestRosserGalleryCollectorLead(
      etsy,
      config,
      v2Dependencies(store)
    );

    expect(etsyResult.customerId).toBe(whiteResult.customerId);
    expect(replay).toEqual({ ...etsyResult, replayed: true });
    expect(store.records("leads")).toHaveLength(1);
    expect(store.records("activities")).toHaveLength(2);
    expect(store.records("crm_ingest_receipts")).toHaveLength(2);
    expect(store.records("crm_consent_events")).toHaveLength(2);
    expect(store.records("crm_ingest_rate_limits")[0][1].createCount).toBe(2);

    const customer = store.records("leads")[0][1];
    expect(customer.tags).toEqual([
      "gallery_event_white_linen_2026",
      "gallery_collector",
      "gallery_commission",
      "gallery_etsy_launch_2026",
    ]);
    expect(customer).toMatchObject({
      latestSource: "Rosser Gallery Etsy launch lead",
      latestEventType: "etsy_product_inquiry",
      latestOfferCode: "RNG-MINI-REPLICA",
      next_action: "review_etsy_product_inquiry",
      collectorProfile: {
        interest: "product-inquiry",
        work: "transceiver",
      },
      consentScopes: {
        rosser_gallery_collector: {
          marketingEmail: true,
          marketingConsentVersion: "etsy-waitlist-v2",
          sms: false,
          rtSolutions: false,
        },
      },
    });

    expect(store.records("activities")).toEqual(
      expect.arrayContaining([
        expect.arrayContaining([
          expect.any(String),
          expect.objectContaining({
            eventType: "commission_inquiry",
            action: "crm.commission_inquiry_received",
            tags: [
              "gallery_event_white_linen_2026",
              "gallery_collector",
              "gallery_commission",
            ],
          }),
        ]),
        expect.arrayContaining([
          expect.any(String),
          expect.objectContaining({
            eventType: "etsy_product_inquiry",
            action: "crm.etsy_product_inquiry_received",
            collector: expect.objectContaining({ work: "transceiver" }),
            tags: ["gallery_etsy_launch_2026", "gallery_collector"],
          }),
        ]),
      ])
    );

    expect(store.records("crm_ingest_receipts")).toEqual(
      expect.arrayContaining([
        expect.arrayContaining([
          expect.any(String),
          expect.objectContaining({
            schemaVersion: 2,
            contractSchemaVersion: 2,
            campaignId: "white_linen_night_nola_2026",
            eventType: "commission_inquiry",
            source: "rosser_gallery_white_linen_preview",
          }),
        ]),
        expect.arrayContaining([
          expect.any(String),
          expect.objectContaining({
            schemaVersion: 2,
            contractSchemaVersion: 2,
            campaignId: "etsy_store_launch_20260801",
            eventType: "etsy_product_inquiry",
            source: "rosser_gallery_etsy_launch_lead",
          }),
        ]),
      ])
    );

    const serializedConsent = JSON.stringify(store.records("crm_consent_events"));
    expect(serializedConsent).not.toContain("rt_ai_workflow");
    expect(serializedConsent).not.toContain("square");
  });

  it("derives opaque customer IDs from workspace, email, and a stable HMAC secret", () => {
    const first = stableRosserGalleryCustomerId(
      "collector@example.com",
      "workspace-a",
      "a-stable-secret-with-at-least-thirty-two-characters"
    );
    const same = stableRosserGalleryCustomerId(
      "COLLECTOR@example.com",
      "workspace-a",
      "a-stable-secret-with-at-least-thirty-two-characters"
    );
    const otherWorkspace = stableRosserGalleryCustomerId(
      "collector@example.com",
      "workspace-b",
      "a-stable-secret-with-at-least-thirty-two-characters"
    );

    expect(same).toBe(first);
    expect(otherWorkspace).not.toBe(first);
    expect(first).not.toContain("collector");
  });
});
