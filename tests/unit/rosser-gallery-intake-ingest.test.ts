import { describe, expect, it } from "vitest";
import fixtureJson from "@/contracts/rosser-gallery/intake-lead.v1.json";
import { rosserGalleryIntakeLeadV1Schema } from "@/lib/crm/rosser-gallery-intake-contract";
import type { RosserGalleryIntakeConfig } from "@/lib/crm/rosser-gallery-intake-config";
import {
  ingestRosserGalleryIntakeLead,
  type RosserGalleryIntakeIngestDependencies,
} from "@/lib/crm/rosser-gallery-intake-ingest";
import type { CrmIngestStore } from "@/lib/crm/rosser-gallery-collector-ingest";

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

const config: RosserGalleryIntakeConfig = {
  ingestToken: "ingest-token-with-at-least-thirty-two-characters",
  ownerUid: "owner-uid",
  workspaceId: "rosser-gallery-workspace",
  businessUnit: "rosser_nft_gallery",
  customerIdHmacSecret: "customer-id-secret-with-at-least-thirty-two-characters",
  notificationOwnerEmails: {
    rosser_gallery: "mrosser@rossergallery.com",
    rt_solutions: "mrosser@rossergallery.com",
  },
  notificationMaxAttempts: 5,
};

function fixture() {
  return rosserGalleryIntakeLeadV1Schema.parse(structuredClone(fixtureJson));
}

function dependencies(
  store: FakeCrmStore,
  dailyCreateLimit?: number,
  now = new Date("2026-07-28T20:31:00.000Z")
): RosserGalleryIntakeIngestDependencies {
  return {
    db: store as unknown as CrmIngestStore,
    correlationId: "intake-ingest-unit-test-0001",
    now: () => now,
    serverTimestamp: () => "server-timestamp",
    dailyCreateLimit,
  };
}

describe("generic Rosser Gallery intake CRM projection", () => {
  it("atomically writes CRM history, separate consent, and two retryable email channels", async () => {
    const store = new FakeCrmStore();
    const payload = fixture();
    const result = await ingestRosserGalleryIntakeLead(
      payload,
      config,
      dependencies(store)
    );

    expect(result.replayed).toBe(false);
    expect(result.notificationChannels).toEqual([
      expect.objectContaining({ channel: "owner_alert", status: "queued" }),
      expect.objectContaining({
        channel: "submitter_acknowledgment",
        status: "queued",
      }),
    ]);
    expect(store.records("leads")).toHaveLength(1);
    expect(store.records("activities")).toHaveLength(1);
    expect(store.records("crm_consent_events")).toHaveLength(1);
    expect(store.records("crm_ingest_receipts")).toHaveLength(1);
    expect(store.records("crm_intake_contact_identities")).toHaveLength(1);
    expect(store.records("crm_notification_outbox")).toHaveLength(2);
    expect(store.records("crm_notification_receipts")).toHaveLength(2);
    expect(store.records("crm_ingest_rate_limits")[0][1]).toMatchObject({
      createCount: 1,
      limit: 500,
    });

    expect(store.records("leads")[0][1]).toMatchObject({
      userId: config.ownerUid,
      workspaceId: config.workspaceId,
      businessUnit: "rosser_nft_gallery",
      businessUnits: ["rosser_nft_gallery"],
      latestIntakeLane: "meeting_interest",
      latestMeetingIntent: "private_gallery_walkthrough",
      next_action: "schedule_private_gallery_walkthrough",
      consentScopes: {
        rosser_gallery_intake: {
          transactionalContactConsent: true,
          transactionalConsentVersion: "intake-response-v1",
          marketingEmail: false,
          marketingInterests: [],
          sms: false,
        },
      },
    });
    expect(store.records("crm_consent_events")[0][1]).toMatchObject({
      scope: "rosser_gallery_intake",
      grants: ["rosser_gallery.transactional_contact"],
      marketingConsent: false,
    });

    const outboxes = store.records("crm_notification_outbox").map(([, row]) => row);
    expect(outboxes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          channel: "owner_alert",
          recipient: "mrosser@rossergallery.com",
          templateVersion: "rosser-gallery-owner-intake-v1",
          status: "queued",
          attemptCount: 0,
          maxAttempts: 5,
          nextAttemptAt: "2026-07-28T20:31:00.000Z",
          emailFormat: "multipart_alternative",
        }),
        expect.objectContaining({
          channel: "submitter_acknowledgment",
          recipient: "community.member@example.com",
          templateVersion: "rosser-gallery-thank-you-v1",
          status: "queued",
        }),
      ])
    );
    expect(
      outboxes.find((row) => row.channel === "submitter_acknowledgment")?.textBody
    ).toContain("time, patience, and energy");

    for (const collection of [
      "crm_ingest_receipts",
      "crm_notification_receipts",
      "crm_intake_contact_identities",
    ]) {
      const serialized = JSON.stringify(store.records(collection));
      expect(serialized).not.toContain(payload.contact.email);
      expect(serialized).not.toContain(payload.contact.name);
      expect(serialized).not.toContain(payload.summary);
    }
  });

  it("returns a stable replay without duplicate CRM or channel writes", async () => {
    const store = new FakeCrmStore();
    const payload = fixture();
    const first = await ingestRosserGalleryIntakeLead(
      payload,
      config,
      dependencies(store)
    );
    const replay = await ingestRosserGalleryIntakeLead(
      payload,
      config,
      dependencies(store, undefined, new Date("2026-08-20T20:31:00.000Z"))
    );

    expect(replay).toEqual({ ...first, replayed: true });
    expect(store.records("activities")).toHaveLength(1);
    expect(store.records("crm_notification_outbox")).toHaveLength(2);
    expect(store.records("crm_notification_receipts")).toHaveLength(2);
    expect(store.records("crm_ingest_rate_limits")[0][1].createCount).toBe(1);

    const changed = fixture();
    changed.summary = "Changed content cannot reuse an event ID.";
    await expect(
      ingestRosserGalleryIntakeLead(changed, config, dependencies(store))
    ).rejects.toMatchObject({ status: 409 });
  });

  it("keeps Rosser and RT marketing consent separate on one CRM customer", async () => {
    const store = new FakeCrmStore();
    const gallery = fixture();
    gallery.marketingConsent = true;
    gallery.marketingInterests = ["gallery_news", "events_programs"];
    const galleryResult = await ingestRosserGalleryIntakeLead(
      gallery,
      config,
      dependencies(store)
    );

    const rtRaw = structuredClone(fixtureJson) as Record<string, unknown>;
    rtRaw.externalEventId =
      "intake_023ba86c-a132-411e-94f3-bfac35f724fc";
    rtRaw.businessUnit = "rt_solutions";
    rtRaw.occurredAt = "2026-07-28T20:32:00.000Z";
    rtRaw.intent = "consulting_consultation";
    rtRaw.summary = "I would like to talk through a consulting project.";
    const rt = rosserGalleryIntakeLeadV1Schema.parse(rtRaw);
    const rtResult = await ingestRosserGalleryIntakeLead(
      rt,
      config,
      dependencies(store, undefined, new Date("2026-07-28T20:33:00.000Z"))
    );

    expect(rtResult.customerId).toBe(galleryResult.customerId);
    expect(store.records("leads")).toHaveLength(1);
    const customer = store.records("leads")[0][1];
    expect(customer).toMatchObject({
      businessUnit: "rosser_nft_gallery",
      businessUnits: ["rosser_nft_gallery", "rt_solutions"],
      latestBusinessUnit: "rt_solutions",
      consentScopes: {
        rosser_gallery_intake: {
          marketingEmail: true,
          marketingInterests: ["gallery_news", "events_programs"],
        },
        rt_solutions_intake: {
          transactionalContactConsent: true,
          marketingEmail: false,
          marketingInterests: [],
        },
      },
    });
    const consentEvents = store.records("crm_consent_events").map(([, row]) => row);
    expect(consentEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          scope: "rosser_gallery_intake",
          grants: [
            "rosser_gallery.transactional_contact",
            "rosser_gallery.marketing_email",
          ],
        }),
        expect.objectContaining({
          scope: "rt_solutions_intake",
          grants: ["rt_solutions.transactional_contact"],
        }),
      ])
    );
    expect(
      store
        .records("crm_notification_outbox")
        .map(([, row]) => row)
        .filter((row) => row.channel === "owner_alert")
        .map((row) => row.recipient)
    ).toEqual(["mrosser@rossergallery.com", "mrosser@rossergallery.com"]);
  });

  it("preserves an existing stage, unrelated consent, and phone", async () => {
    const store = new FakeCrmStore();
    const payload = fixture();
    store.seed("leads/existing-contact", {
      userId: config.ownerUid,
      workspaceId: config.workspaceId,
      email: payload.contact.email,
      phone: "+15045550101",
      businessUnit: "rt_solutions",
      businessUnits: ["rt_solutions"],
      pipelineStage: "proposal",
      status: "qualified",
      consentScopes: {
        another_program: { marketingEmail: true },
      },
    });

    const result = await ingestRosserGalleryIntakeLead(
      payload,
      config,
      dependencies(store)
    );
    expect(result.customerId).toBe("existing-contact");
    expect(store.records("leads")[0][1]).toMatchObject({
      phone: "+15045550101",
      pipelineStage: "proposal",
      status: "qualified",
      businessUnits: ["rt_solutions", "rosser_nft_gallery"],
      consentScopes: {
        another_program: { marketingEmail: true },
        rosser_gallery_intake: { transactionalContactConsent: true },
      },
    });
  });

  it("enforces the transactional daily event quota without charging replays", async () => {
    const store = new FakeCrmStore();
    const first = fixture();
    const firstResult = await ingestRosserGalleryIntakeLead(
      first,
      config,
      dependencies(store, 1)
    );
    const replay = await ingestRosserGalleryIntakeLead(
      first,
      config,
      dependencies(store, 1)
    );
    expect(replay).toEqual({ ...firstResult, replayed: true });

    const secondRaw = structuredClone(fixtureJson) as Record<string, unknown>;
    secondRaw.externalEventId =
      "intake_d740d1d1-5211-4c03-bd86-d30e57deaf23";
    const second = rosserGalleryIntakeLeadV1Schema.parse(secondRaw);
    await expect(
      ingestRosserGalleryIntakeLead(second, config, dependencies(store, 1))
    ).rejects.toMatchObject({ status: 429 });
    expect(store.records("crm_ingest_receipts")).toHaveLength(1);
    expect(store.records("crm_notification_outbox")).toHaveLength(2);
  });
});
