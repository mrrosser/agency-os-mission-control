import { describe, expect, it } from "vitest";
import {
  buildRosserGalleryCardDryRun,
  DOT_CARD_EXPORT_HEADERS,
  normalizeRosserGalleryCardEmail,
  parseRosserGalleryCardSourceForCanonicalImport,
  rosserGalleryCardEmailKey,
  RosserGalleryCardImportError,
  type RosserGalleryCardReconciliationEvidence,
} from "@/lib/crm/rosser-gallery-card-import";

function escapeCsv(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function source(rows: Array<Partial<Record<(typeof DOT_CARD_EXPORT_HEADERS)[number], string>>>) {
  const lines = [
    DOT_CARD_EXPORT_HEADERS.join(","),
    ...rows.map((row) =>
      DOT_CARD_EXPORT_HEADERS.map((header) => escapeCsv(row[header] || "")).join(",")
    ),
  ];
  return new TextEncoder().encode(lines.join("\r\n"));
}

function contact(index: number, overrides: Record<string, string> = {}) {
  return {
    Slug: `contact-${index}`,
    "Full Name": `Gallery Friend ${index}`,
    "First Name": "Gallery",
    "Last Name": `Friend ${index}`,
    Email: `friend-${index}@example.test`,
    "Phone Number": `+1 504 555 ${String(1000 + index)}`,
    Source: "Dot",
    "Location Met": "Gallery opening",
    "Date Met": "2024-01-15",
    "Time Met": "18:30",
    ...overrides,
  };
}

describe("Rosser Gallery card import dry run", () => {
  it("keeps strict row parsing available to the server-internal reconciler", () => {
    const parsed = parseRosserGalleryCardSourceForCanonicalImport(source([contact(1)]));

    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]).toMatchObject({
      rowNumber: 1,
      normalizedEmail: "friend-1@example.test",
      normalizedPhone: "15045551001",
    });
    expect(parsed.rows[0].sourceRowKey).toMatch(/^crs_[a-f0-9]{32}$/);
    expect(parsed.sourceReceiptSha256).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("profiles a valid Dot export without returning row-level PII or write authority", () => {
    const bytes = source([
      contact(1, { "Meeting Note": "Met near the sculpture, then followed up." }),
      contact(2, { "Phone Number": "", "Meeting Note": "Quoted \"hello\"\nnext line" }),
    ]);
    const first = buildRosserGalleryCardDryRun({
      sourceBytes: bytes,
      sourceFileName: "private-person-name.csv",
    });
    const second = buildRosserGalleryCardDryRun({
      sourceBytes: bytes,
      sourceFileName: "private-person-name.csv",
    });

    expect(first.quality).toMatchObject({
      rows: 2,
      completeNameRows: 2,
      validEmailRows: 2,
      duplicateNormalizedEmailRows: 0,
      duplicateSlugRows: 0,
      duplicateNormalizedNameRows: 0,
      phonePresentRows: 1,
    });
    expect(first.reconciliation).toMatchObject({
      evidenceSupplied: false,
      heldRows: 2,
      reviewableForImportRows: 0,
      readyForLiveWriteRows: 0,
      readyForOutreachRows: 0,
    });
    expect(first.authority).toEqual({
      liveWrites: false,
      sends: false,
      drafts: false,
      sms: false,
      calls: false,
      scraping: false,
      socialLookup: false,
      applySupported: false,
    });
    expect(first.planFingerprint).toBe(second.planFingerprint);
    const serialized = JSON.stringify(first);
    expect(serialized).not.toContain("friend-1@example.test");
    expect(serialized).not.toContain("Gallery Friend 1");
    expect(serialized).not.toContain("504 555");
    expect(serialized).not.toContain("private-person-name");
    expect(serialized).not.toContain("Met near the sculpture");
  });

  it("holds duplicate, malformed, and conflicting source identities before reconciliation", () => {
    const duplicated = contact(1);
    const report = buildRosserGalleryCardDryRun({
      sourceBytes: source([
        duplicated,
        duplicated,
        contact(2, { Email: "DUPLICATE@example.test" }),
        contact(3, { Email: " duplicate@EXAMPLE.test " }),
        contact(4, { Email: "not-an-email" }),
        contact(5, { "Phone Number": "+1 504 555 9999" }),
        contact(6, { "Phone Number": "+1 (504) 555-9999" }),
      ]),
      sourceFileName: "dot_contact_export.csv",
    });

    expect(report.reconciliation.dispositionCounts).toMatchObject({
      duplicate_source_row: 2,
      duplicate_email_in_source: 2,
      invalid_email: 1,
      identity_conflict_in_source: 2,
    });
    expect(report.reconciliation.heldRows).toBe(7);
    expect(report.reconciliation.readyForOutreachRows).toBe(0);
  });

  it("applies suppression and permission evidence before marking records import-reviewable", () => {
    const workspaceDiscriminator = "workspace-review-fixture";
    const rows = Array.from({ length: 7 }, (_, index) => contact(index + 1));
    const sourceBytes = source(rows);
    const baseline = buildRosserGalleryCardDryRun({
      sourceBytes,
      sourceFileName: "dot_contact_export.csv",
      workspaceDiscriminator,
    });
    const states: Array<{
      suppressed: boolean;
      latestPermissionState: "unknown" | "opted_in" | "opted_out" | "reconfirm_required";
      permissionEventCount: number;
      openImportConflict?: boolean;
      matchingPersonCount?: number;
      matchingContactPointCount?: number;
    }> = [
      { suppressed: true, latestPermissionState: "opted_in", permissionEventCount: 1 },
      { suppressed: false, latestPermissionState: "opted_out", permissionEventCount: 1 },
      { suppressed: false, latestPermissionState: "opted_in", permissionEventCount: 1, openImportConflict: true },
      { suppressed: false, latestPermissionState: "opted_in", permissionEventCount: 0 },
      { suppressed: false, latestPermissionState: "unknown", permissionEventCount: 1 },
      { suppressed: false, latestPermissionState: "opted_in", permissionEventCount: 1, matchingPersonCount: 1, matchingContactPointCount: 1 },
      { suppressed: false, latestPermissionState: "reconfirm_required", permissionEventCount: 1 },
    ];
    const byEmailKey = Object.fromEntries(
      rows.map((row, index) => [
        rosserGalleryCardEmailKey(
          workspaceDiscriminator,
          normalizeRosserGalleryCardEmail(row.Email)!
        ),
        {
          matchingPersonCount: states[index].matchingPersonCount || 0,
          matchingContactPointCount: states[index].matchingContactPointCount || 0,
          permissionEventCount: states[index].permissionEventCount,
          latestPermissionState: states[index].latestPermissionState,
          suppressed: states[index].suppressed,
          openImportConflict: states[index].openImportConflict || false,
        },
      ])
    );
    const reconciliation: RosserGalleryCardReconciliationEvidence = {
      schemaVersion: "crm.rosser-gallery-card-reconciliation.v1",
      sourceReceiptSha256: baseline.source.receipt.sha256,
      workspaceDiscriminator,
      byEmailKey,
    };
    const report = buildRosserGalleryCardDryRun({
      sourceBytes,
      sourceFileName: "dot_contact_export.csv",
      workspaceDiscriminator,
      reconciliation,
    });

    expect(report.reconciliation.dispositionCounts).toMatchObject({
      suppressed: 1,
      opted_out: 1,
      open_import_conflict: 1,
      permission_event_missing: 1,
      permission_state_unresolved: 1,
      reviewable_existing_contact: 1,
      reviewable_new_contact: 1,
    });
    expect(report.reconciliation.reviewableForImportRows).toBe(2);
    expect(report.reconciliation.readyForLiveWriteRows).toBe(0);
    expect(report.reconciliation.readyForOutreachRows).toBe(0);
  });

  it("fails closed on schema drift, malformed quoting, or mismatched reconciliation", () => {
    const valid = source([contact(1)]);
    const baseline = buildRosserGalleryCardDryRun({
      sourceBytes: valid,
      sourceFileName: "dot_contact_export.csv",
    });
    const mismatched: RosserGalleryCardReconciliationEvidence = {
      schemaVersion: "crm.rosser-gallery-card-reconciliation.v1",
      sourceReceiptSha256: "sha256:" + "0".repeat(64),
      workspaceDiscriminator: "review-only:rosser_gallery",
      byEmailKey: {},
    };

    expect(() =>
      buildRosserGalleryCardDryRun({
        sourceBytes: valid,
        sourceFileName: "dot_contact_export.csv",
        reconciliation: mismatched,
      })
    ).toThrowError(RosserGalleryCardImportError);
    expect(baseline.source.receipt.rows).toBe(1);
    expect(() =>
      buildRosserGalleryCardDryRun({
        sourceBytes: new TextEncoder().encode("Email,Name\r\na@example.test,A"),
        sourceFileName: "dot_contact_export.csv",
      })
    ).toThrow(/header/i);
    expect(() =>
      buildRosserGalleryCardDryRun({
        sourceBytes: new TextEncoder().encode(`${DOT_CARD_EXPORT_HEADERS.join(",")}\r\n\"open`),
        sourceFileName: "dot_contact_export.csv",
      })
    ).toThrow(/unterminated/i);
  });
});
