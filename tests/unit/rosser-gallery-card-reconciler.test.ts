import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import {
  DOT_CARD_EXPORT_HEADERS,
  type RosserGalleryCardCanonicalSource,
  type RosserGalleryCardCanonicalSourceRow,
} from "@/lib/crm/rosser-gallery-card-import";
import {
  canonicalRosserGalleryWorkspaceIdForOwner,
  reconcileRosserGalleryCardImport,
  ROSSER_GALLERY_CARD_READ_CAPS,
  ROSSER_GALLERY_DOT_CARD_EXACT_RECEIPT,
  RosserGalleryCardReconciliationError,
} from "@/lib/crm/rosser-gallery-card-reconciler";

type StoredDocument = Record<string, unknown>;

class FakeDocumentSnapshot {
  constructor(readonly id: string, private readonly value?: StoredDocument) {}
  get exists() { return Boolean(this.value); }
  data() { return this.value; }
}

class FakeQuerySnapshot {
  constructor(readonly docs: FakeDocumentSnapshot[]) {}
  get size() { return this.docs.length; }
}

class FakeDocumentReference {
  constructor(
    readonly firestore: FakeFirestore,
    readonly collectionName: string,
    readonly id: string
  ) {}
  async get() {
    return new FakeDocumentSnapshot(
      this.id,
      this.firestore.collections.get(this.collectionName)?.get(this.id)
    );
  }
}

class FakeQuery {
  private maximum = Number.POSITIVE_INFINITY;
  constructor(
    readonly firestore: FakeFirestore,
    readonly collectionName: string,
    private readonly filters: Array<[string, unknown]> = []
  ) {}
  where(field: string, operator: string, value: unknown) {
    if (operator !== "==") throw new Error("Exact filters only.");
    return new FakeQuery(this.firestore, this.collectionName, [
      ...this.filters,
      [field, value],
    ]);
  }
  limit(value: number) { this.maximum = value; return this; }
  doc(id: string) { return new FakeDocumentReference(this.firestore, this.collectionName, id); }
  async get() {
    if (this.firestore.overflowCollection === this.collectionName) {
      return new FakeQuerySnapshot(
        Array.from({ length: this.maximum }, (_, index) =>
          new FakeDocumentSnapshot(`overflow-${index}`, {
            workspaceId: this.firestore.workspaceId,
          })
        )
      );
    }
    const docs = [...(this.firestore.collections.get(this.collectionName) || new Map())]
      .filter(([, value]) =>
        this.filters.every(([field, expected]) => value[field] === expected)
      )
      .slice(0, this.maximum)
      .map(([id, value]) => new FakeDocumentSnapshot(id, value));
    return new FakeQuerySnapshot(docs);
  }
}

class FakeTransaction {
  constructor(private readonly firestore: FakeFirestore) {}
  get(target: FakeQuery | FakeDocumentReference) { return target.get(); }
  create(reference: FakeDocumentReference, data: StoredDocument) {
    const collection = this.firestore.collectionData(reference.collectionName);
    if (collection.has(reference.id)) throw new Error("create collision");
    collection.set(reference.id, data);
    return this;
  }
  set(reference: FakeDocumentReference, data: StoredDocument, options?: { merge?: boolean }) {
    const collection = this.firestore.collectionData(reference.collectionName);
    const current = collection.get(reference.id) || {};
    collection.set(reference.id, options?.merge ? { ...current, ...data } : data);
    return this;
  }
}

class FakeFirestore {
  readonly collections = new Map<string, Map<string, StoredDocument>>();
  overflowCollection: string | null = null;
  workspaceId = "";
  collectionData(name: string) {
    const existing = this.collections.get(name);
    if (existing) return existing;
    const created = new Map<string, StoredDocument>();
    this.collections.set(name, created);
    return created;
  }
  collection(name: string) { return new FakeQuery(this, name); }
  async runTransaction<T>(callback: (transaction: FakeTransaction) => Promise<T>) {
    return callback(new FakeTransaction(this));
  }
}

function rowFields(index: number): RosserGalleryCardCanonicalSourceRow["fields"] {
  const values = Object.fromEntries(DOT_CARD_EXPORT_HEADERS.map((header) => [header, ""])) as Record<
    (typeof DOT_CARD_EXPORT_HEADERS)[number], string
  >;
  values.Slug = `gallery-friend-${index}`;
  values["Full Name"] = `Gallery Friend ${index}`;
  values["First Name"] = "Gallery";
  values["Last Name"] = `Friend ${index}`;
  values.Email = `friend-${index}@example.test`;
  values["Phone Number"] = `+1 504 555 ${String(1000 + index)}`;
  values.Source = "Dot";
  values["Location Met"] = "Gallery opening";
  values["Date Met"] = "2024-01-15";
  return values;
}

function canonicalize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

function digest(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function source(): RosserGalleryCardCanonicalSource {
  return {
    sourceReceiptSha256: ROSSER_GALLERY_DOT_CARD_EXACT_RECEIPT,
    headerFingerprint: "sha256:" + "1".repeat(64),
    rows: Array.from({ length: 10 }, (_, offset) => {
      const index = offset + 1;
      const fields = rowFields(index);
      const rawFingerprint = digest(canonicalize(fields));
      return {
        rowNumber: index,
        fields,
        normalizedEmail: `friend-${index}@example.test`,
        normalizedPhone: `1504555${1000 + index}`,
        rawFingerprint,
        sourceRowKey: `crs_${digest(
          `dot-card-source-row:v1|${ROSSER_GALLERY_DOT_CARD_EXACT_RECEIPT}|${index}|${rawFingerprint}`
        ).slice(7, 39)}`,
      };
    }),
  };
}

function seededFirestore(ownerUid = "owner-fixture") {
  const db = new FakeFirestore();
  const workspaceId = canonicalRosserGalleryWorkspaceIdForOwner(ownerUid);
  db.workspaceId = workspaceId;
  db.collectionData("workspaces").set(workspaceId, { ownerUid, status: "active" });
  db.collectionData("workspace_members").set("owner-member", {
    workspaceId,
    uid: ownerUid,
    role: "owner",
    status: "active",
  });
  return { db, workspaceId, ownerUid };
}

function input(
  db: FakeFirestore,
  workspaceId: string,
  ownerUid: string,
  overrides: Partial<Parameters<typeof reconcileRosserGalleryCardImport>[0]> = {}
) {
  return {
    source: source(),
    ownerUid,
    requestedWorkspaceId: workspaceId,
    correlationId: "correlation-fixture",
    db: db as unknown as Firestore,
    ...overrides,
  };
}

describe("Rosser Gallery canonical card reconciliation", () => {
  it("applies only an exact freshly confirmed aggregate plan and is idempotent", async () => {
    const { db, workspaceId, ownerUid } = seededFirestore();
    const logs: Array<Record<string, unknown>> = [];
    const dryRun = await reconcileRosserGalleryCardImport(
      input(db, workspaceId, ownerUid, {
        log: { info: (event, value) => logs.push({ event, ...value }) },
      })
    );
    expect(dryRun.reconciliation).toMatchObject({ safeRows: 10, heldRows: 0 });
    expect(dryRun.proposedWrites).toMatchObject({
      peopleCreated: 10,
      emailContactPointsCreated: 10,
      identityOnlyPhoneContactPointsCreated: 10,
      sourceRecordsCreated: 10,
      reconfirmPermissionEventsCreated: 10,
      total: 50,
    });
    expect(JSON.stringify({ dryRun, logs })).not.toContain("friend-1@example.test");
    expect(JSON.stringify({ dryRun, logs })).not.toContain("Gallery Friend 1");

    const applied = await reconcileRosserGalleryCardImport(
      input(db, workspaceId, ownerUid, {
        mode: "apply",
        requestedSourceReceipt: ROSSER_GALLERY_DOT_CARD_EXACT_RECEIPT,
        confirmation: dryRun.apply.confirmationRequired,
      })
    );
    expect(applied.apply).toMatchObject({ executed: true, writesApplied: 50 });
    expect(db.collectionData("crm_people").size).toBe(10);
    expect(db.collectionData("crm_contact_points").size).toBe(20);
    expect(db.collectionData("crm_source_records").size).toBe(10);
    expect(db.collectionData("crm_permission_events").size).toBe(10);

    const phone = [...db.collectionData("crm_contact_points").values()].find(
      (document) => document.type === "phone"
    );
    expect(phone).toMatchObject({
      purpose: "identity_reconciliation_only",
      outreachAllowed: false,
      smsPermissionState: "not_attested",
      callPermissionState: "not_attested",
    });
    expect([...db.collectionData("crm_permission_events").values()][0]).toMatchObject({
      permissionState: "reconfirm_required",
      broadMarketingOptIn: false,
      sendsAuthorized: false,
      smsPermissionGranted: false,
      callPermissionGranted: false,
    });

    const repeated = await reconcileRosserGalleryCardImport(input(db, workspaceId, ownerUid));
    expect(repeated.reconciliation.alreadyImportedRows).toBe(10);
    expect(repeated.proposedWrites.total).toBe(0);
    await expect(
      reconcileRosserGalleryCardImport(
        input(db, workspaceId, ownerUid, {
          mode: "apply",
          requestedSourceReceipt: ROSSER_GALLERY_DOT_CARD_EXACT_RECEIPT,
          confirmation: dryRun.apply.confirmationRequired,
        })
      )
    ).rejects.toMatchObject({ code: "apply_confirmation_mismatch" });
  });

  it("holds suppressed, opted-out, and open-conflict rows without writing them", async () => {
    const { db, workspaceId, ownerUid } = seededFirestore();
    db.collectionData("crm_suppressions").set("suppressed", {
      workspaceId, active: true, email: "friend-1@example.test",
    });
    db.collectionData("crm_permission_events").set("opted-out", {
      workspaceId, email: "friend-2@example.test", permissionState: "opted_out",
    });
    db.collectionData("crm_import_conflicts").set("conflict", {
      workspaceId, status: "open", email: "friend-3@example.test",
    });
    const dryRun = await reconcileRosserGalleryCardImport(input(db, workspaceId, ownerUid));
    expect(dryRun.reconciliation.dispositionCounts).toMatchObject({
      suppressed: 1,
      opted_out: 1,
      open_import_conflict: 1,
      ready_new_contact: 7,
    });
    const applied = await reconcileRosserGalleryCardImport(
      input(db, workspaceId, ownerUid, {
        mode: "apply",
        requestedSourceReceipt: ROSSER_GALLERY_DOT_CARD_EXACT_RECEIPT,
        confirmation: dryRun.apply.confirmationRequired,
      })
    );
    expect(applied.reconciliation.heldRows).toBe(3);
    expect(applied.apply.writesApplied).toBe(35);
    expect(db.collectionData("crm_people").size).toBe(7);
  });

  it("holds a row when its canonical contact point is directly suppressed", async () => {
    const { db, workspaceId, ownerUid } = seededFirestore();
    db.collectionData("crm_people").set("suppressed-person", {
      workspaceId,
      displayName: "Suppressed Gallery Friend",
      relationshipBrandIds: [],
    });
    db.collectionData("crm_contact_points").set("suppressed-email", {
      workspaceId,
      personId: "suppressed-person",
      type: "email",
      normalizedValue: "friend-1@example.test",
      defaultPermissionState: "unknown",
      suppressed: true,
    });

    const dryRun = await reconcileRosserGalleryCardImport(
      input(db, workspaceId, ownerUid)
    );

    expect(dryRun.reconciliation.dispositionCounts.suppressed).toBe(1);
    expect(dryRun.reconciliation.safeRows).toBe(9);
  });

  it("treats drifted deterministic no-send evidence as an immutable conflict", async () => {
    const { db, workspaceId, ownerUid } = seededFirestore();
    const dryRun = await reconcileRosserGalleryCardImport(
      input(db, workspaceId, ownerUid)
    );
    await reconcileRosserGalleryCardImport(
      input(db, workspaceId, ownerUid, {
        mode: "apply",
        requestedSourceReceipt: ROSSER_GALLERY_DOT_CARD_EXACT_RECEIPT,
        confirmation: dryRun.apply.confirmationRequired,
      })
    );

    const sourceEntry = [...db.collectionData("crm_source_records").entries()][0];
    expect(sourceEntry).toBeDefined();
    sourceEntry![1].broadMarketingOptIn = true;
    const sourceDrift = await reconcileRosserGalleryCardImport(
      input(db, workspaceId, ownerUid)
    );
    expect(sourceDrift.reconciliation.dispositionCounts.immutable_import_record_conflict).toBe(1);

    sourceEntry![1].broadMarketingOptIn = false;
    const permissionEntry = [...db.collectionData("crm_permission_events").entries()][0];
    expect(permissionEntry).toBeDefined();
    permissionEntry![1].sendsAuthorized = true;
    const permissionDrift = await reconcileRosserGalleryCardImport(
      input(db, workspaceId, ownerUid)
    );
    expect(permissionDrift.reconciliation.dispositionCounts.immutable_import_record_conflict).toBe(1);
  });

  it("reuses one source-backed canonical person and rejects cross-person source identity", async () => {
    const { db, workspaceId, ownerUid } = seededFirestore();
    const firstEmailKey = digest(`email:v1|${workspaceId}|friend-1@example.test`);
    db.collectionData("crm_people").set("existing-person", {
      workspaceId,
      displayName: "Existing Gallery Friend",
      relationshipBrandIds: [],
    });
    db.collectionData("crm_source_records").set("prior-source", {
      workspaceId,
      personId: "existing-person",
      emailKey: firstEmailKey,
      sourceSystem: "prior_gallery_registry",
    });

    const reconciled = await reconcileRosserGalleryCardImport(
      input(db, workspaceId, ownerUid)
    );
    expect(reconciled.reconciliation.dispositionCounts.ready_existing_contact).toBe(1);
    expect(reconciled.proposedWrites).toMatchObject({
      peopleCreated: 9,
      peopleBrandLinked: 1,
    });

    db.collectionData("crm_people").set("conflicting-person", {
      workspaceId,
      displayName: "Conflicting Person",
      relationshipBrandIds: [],
    });
    db.collectionData("crm_source_records").set("conflicting-source", {
      workspaceId,
      personId: "conflicting-person",
      emailKey: firstEmailKey,
      sourceSystem: "other_registry",
    });
    const conflicted = await reconcileRosserGalleryCardImport(
      input(db, workspaceId, ownerUid)
    );
    expect(conflicted.reconciliation.dispositionCounts.canonical_identity_conflict).toBe(1);
  });

  it("fails closed on workspace, receipt, and bounded-read drift", async () => {
    const { db, workspaceId, ownerUid } = seededFirestore();
    await expect(
      reconcileRosserGalleryCardImport(input(db, `${workspaceId}-other`, ownerUid))
    ).rejects.toBeInstanceOf(RosserGalleryCardReconciliationError);
    await expect(
      reconcileRosserGalleryCardImport(
        input(db, workspaceId, ownerUid, {
          source: { ...source(), sourceReceiptSha256: "sha256:" + "0".repeat(64) },
        })
      )
    ).rejects.toMatchObject({ code: "source_receipt_mismatch" });
    db.overflowCollection = "crm_people";
    await expect(
      reconcileRosserGalleryCardImport(input(db, workspaceId, ownerUid))
    ).rejects.toMatchObject({ code: "bounded_read_exceeded" });
    expect(ROSSER_GALLERY_CARD_READ_CAPS.people).toBe(5_000);
  });
});
