import { describe, expect, it } from "vitest";
import {
  dedupeWarmReconnectCandidates,
  normalizeWarmReconnectEmail,
  warmReconnectEmailKey,
  type WarmReconnectRawCandidate,
} from "@/lib/crm/warm-reconnect-dedupe";

function raw(
  contactPointId: string,
  personId: string,
  email: string,
  overrides: Partial<WarmReconnectRawCandidate> = {}
): WarmReconnectRawCandidate {
  return {
    contactPointId,
    personId,
    displayName: `Person ${personId}`,
    email,
    permissionState: "unknown",
    primary: false,
    evidenceUpdatedAt: "2026-08-01T00:00:00.000Z",
    sourceEvidence: [
      {
        evidenceRef: `crm_source_records/source-${contactPointId}`,
        sourceSystem: "google_people",
        permissionBasis: "none",
        observedAt: "2026-08-01T00:00:00.000Z",
      },
    ],
    sourcePersonIds: [personId],
    suppressed: false,
    ...overrides,
  };
}

describe("warm reconnect conservative email dedupe", () => {
  it("normalizes with NFKC and IDNA while preserving Gmail dots and plus tags", () => {
    expect(normalizeWarmReconnectEmail("  Marcus.Rosser+Gallery@EXAMPLE.com ")).toBe(
      "marcus.rosser+gallery@example.com"
    );
    expect(normalizeWarmReconnectEmail("user@bücher.example")).toBe(
      "user@xn--bcher-kva.example"
    );
    expect(normalizeWarmReconnectEmail("a..b@example.com")).toBeNull();
    expect(normalizeWarmReconnectEmail("not-an-email")).toBeNull();
    expect(warmReconnectEmailKey("workspace-a", "user@example.com")).not.toBe(
      warmReconnectEmailKey("workspace-b", "user@example.com")
    );
  });

  it("uses explicit permission, primary flag, evidence time, then id for a stable winner", () => {
    const result = dedupeWarmReconnectCandidates("workspace-a", [
      raw("contact-z", "person-1", "later@example.com", {
        permissionState: "unknown",
        primary: true,
        evidenceUpdatedAt: "2026-08-10T00:00:00.000Z",
      }),
      raw("contact-a", "person-1", "opted@example.com", {
        permissionState: "opted_in",
        primary: false,
        evidenceUpdatedAt: "2026-08-01T00:00:00.000Z",
      }),
    ]);

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      contactPointId: "contact-a",
      email: "opted@example.com",
      permissionState: "opted_in",
    });
    expect(result.excluded).toContainEqual({
      contactPointId: "contact-z",
      personId: "person-1",
      reason: "duplicate_person_contact",
    });
  });

  it("excludes every ambiguous cross-person duplicate and all hard-stop states", () => {
    const result = dedupeWarmReconnectCandidates("workspace-a", [
      raw("dup-1", "person-1", "same@example.com"),
      raw("dup-2", "person-2", "SAME@example.com"),
      raw("suppressed", "person-3", "three@example.com", { suppressed: true }),
      raw("opted-out", "person-4", "four@example.com", {
        permissionState: "opted_out",
      }),
      raw("transactional", "person-5", "five@example.com", {
        permissionState: "transactional_only",
      }),
      raw("conflict", "person-6", "six@example.com", { openImportConflict: true }),
      raw("missing-evidence", "person-7", "seven@example.com", {
        sourceEvidence: [],
      }),
      raw("revoked", "person-8", "eight@example.com", {
        permissionState: "revoked",
      }),
    ]);

    expect(result.candidates).toEqual([]);
    expect(result.excluded.map((value) => value.reason)).toEqual(
      expect.arrayContaining([
        "duplicate_email_across_people",
        "suppressed",
        "opted_out",
        "transactional_only",
        "open_import_conflict",
        "missing_source_evidence",
        "unsupported_permission_state",
      ])
    );
  });
});
