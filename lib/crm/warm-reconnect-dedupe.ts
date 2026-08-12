import { createHash } from "node:crypto";
import { domainToASCII } from "node:url";
import type {
  WarmReconnectCandidate,
  WarmReconnectExcludedCandidate,
  WarmReconnectPermissionState,
  WarmReconnectSourceEvidence,
} from "@/lib/crm/warm-reconnect-activation-types";

export interface WarmReconnectRawCandidate {
  contactPointId: string;
  personId: string | null;
  displayName: string | null;
  email: string | null;
  permissionState: string | null;
  primary: boolean;
  evidenceUpdatedAt: string | null;
  sourceEvidence: WarmReconnectSourceEvidence[];
  sourcePersonIds: string[];
  suppressed: boolean;
  openImportConflict?: boolean;
}

export interface WarmReconnectDedupeResult {
  candidates: WarmReconnectCandidate[];
  excluded: WarmReconnectExcludedCandidate[];
}

function canonicalize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalize(object[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

export function warmReconnectFingerprint(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalize(value)).digest("hex")}`;
}

export function normalizeWarmReconnectEmail(value: string): string | null {
  const normalized = String(value || "").normalize("NFKC").trim();
  if (
    !normalized ||
    normalized.length > 254 ||
    /[\u0000-\u0020\u007f]/.test(normalized)
  ) {
    return null;
  }

  const at = normalized.lastIndexOf("@");
  if (at <= 0 || at !== normalized.indexOf("@")) return null;
  const local = normalized.slice(0, at);
  const rawDomain = normalized.slice(at + 1);
  if (!local || local.length > 64 || !rawDomain) return null;
  if (
    local.startsWith(".") ||
    local.endsWith(".") ||
    local.includes("..") ||
    !/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(local)
  ) {
    return null;
  }

  const domain = domainToASCII(rawDomain).toLowerCase();
  if (!domain || domain.length > 253 || domain.startsWith(".") || domain.endsWith(".")) {
    return null;
  }
  const labels = domain.split(".");
  if (
    labels.length < 2 ||
    labels.some(
      (label) =>
        !label ||
        label.length > 63 ||
        label.startsWith("-") ||
        label.endsWith("-") ||
        !/^[a-z0-9-]+$/.test(label)
    )
  ) {
    return null;
  }

  // Deliberately preserve Gmail dots and plus tags. They can denote distinct
  // operator-managed addresses and collapsing them is not a safe dedupe rule.
  return `${local.toLowerCase()}@${domain}`;
}

export function warmReconnectEmailKey(workspaceId: string, email: string): string {
  return warmReconnectFingerprint(`email:v1|${workspaceId}|${email}`);
}

function permissionState(value: string | null): WarmReconnectPermissionState {
  switch (value) {
    case "unknown":
    case "opted_in":
    case "opted_out":
    case "reconfirm_required":
    case "transactional_only":
      return value;
    default:
      return "other";
  }
}

function evidenceTime(value: string | null): number {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

function permissionRank(value: WarmReconnectPermissionState): number {
  if (value === "opted_in") return 0;
  if (value === "reconfirm_required") return 1;
  if (value === "unknown") return 2;
  return 3;
}

type Prepared = {
  raw: WarmReconnectRawCandidate;
  email: string;
  emailKey: string;
  permissionState: WarmReconnectPermissionState;
};

function comparePrepared(left: Prepared, right: Prepared): number {
  return (
    permissionRank(left.permissionState) - permissionRank(right.permissionState) ||
    Number(right.raw.primary) - Number(left.raw.primary) ||
    evidenceTime(right.raw.evidenceUpdatedAt) - evidenceTime(left.raw.evidenceUpdatedAt) ||
    left.raw.contactPointId.localeCompare(right.raw.contactPointId)
  );
}

function excluded(
  value: WarmReconnectRawCandidate,
  reason: WarmReconnectExcludedCandidate["reason"]
): WarmReconnectExcludedCandidate {
  return { contactPointId: value.contactPointId, personId: value.personId, reason };
}

export function dedupeWarmReconnectCandidates(
  workspaceId: string,
  input: WarmReconnectRawCandidate[]
): WarmReconnectDedupeResult {
  const prepared: Prepared[] = [];
  const exclusions: WarmReconnectExcludedCandidate[] = [];

  for (const raw of [...input].sort((a, b) => a.contactPointId.localeCompare(b.contactPointId))) {
    const email = raw.email ? normalizeWarmReconnectEmail(raw.email) : null;
    if (!email) {
      exclusions.push(excluded(raw, "malformed_email"));
      continue;
    }
    if (!raw.personId) {
      exclusions.push(excluded(raw, "missing_person"));
      continue;
    }
    if (raw.openImportConflict) {
      exclusions.push(excluded(raw, "open_import_conflict"));
      continue;
    }
    if (raw.suppressed) {
      exclusions.push(excluded(raw, "suppressed"));
      continue;
    }
    const state = permissionState(raw.permissionState);
    if (state === "opted_out") {
      exclusions.push(excluded(raw, "opted_out"));
      continue;
    }
    if (state === "transactional_only") {
      exclusions.push(excluded(raw, "transactional_only"));
      continue;
    }
    if (!["unknown", "reconfirm_required", "opted_in"].includes(state)) {
      exclusions.push(excluded(raw, "unsupported_permission_state"));
      continue;
    }
    const sourceOwners = new Set(raw.sourcePersonIds.filter(Boolean));
    if (sourceOwners.size > 1 || [...sourceOwners].some((id) => id !== raw.personId)) {
      exclusions.push(excluded(raw, "conflicting_source_ownership"));
      continue;
    }
    if (raw.sourceEvidence.length === 0) {
      exclusions.push(excluded(raw, "missing_source_evidence"));
      continue;
    }
    prepared.push({
      raw,
      email,
      emailKey: warmReconnectEmailKey(workspaceId, email),
      permissionState: state,
    });
  }

  const duplicateAcrossPeople = new Set<string>();
  const byEmail = new Map<string, Prepared[]>();
  for (const value of prepared) {
    const group = byEmail.get(value.emailKey) || [];
    group.push(value);
    byEmail.set(value.emailKey, group);
  }
  for (const [emailKey, group] of byEmail) {
    if (new Set(group.map((value) => value.raw.personId)).size > 1) {
      duplicateAcrossPeople.add(emailKey);
      exclusions.push(
        ...group.map((value) => excluded(value.raw, "duplicate_email_across_people"))
      );
    }
  }

  const byPerson = new Map<string, Prepared[]>();
  for (const value of prepared) {
    if (duplicateAcrossPeople.has(value.emailKey)) continue;
    const group = byPerson.get(value.raw.personId!) || [];
    group.push(value);
    byPerson.set(value.raw.personId!, group);
  }

  const winners: Prepared[] = [];
  for (const group of byPerson.values()) {
    group.sort(comparePrepared);
    winners.push(group[0]);
    exclusions.push(
      ...group.slice(1).map((value) => excluded(value.raw, "duplicate_person_contact"))
    );
  }

  const candidates = winners
    .sort((a, b) => a.raw.personId!.localeCompare(b.raw.personId!))
    .map<WarmReconnectCandidate>((value) => {
      const sourceEvidence = [...value.raw.sourceEvidence].sort((a, b) =>
        a.evidenceRef.localeCompare(b.evidenceRef)
      );
      const candidateFingerprint = warmReconnectFingerprint({
        contract: "warm-reconnect-candidate.v1",
        personId: value.raw.personId,
        contactPointId: value.raw.contactPointId,
        emailKey: value.emailKey,
        permissionState: value.permissionState,
        sourceEvidence,
      });
      return {
        recipientId: `wrr_${warmReconnectFingerprint(
          `${value.raw.personId}|${value.raw.contactPointId}|${value.emailKey}`
        ).slice(7, 31)}`,
        personId: value.raw.personId!,
        contactPointId: value.raw.contactPointId,
        displayName: value.raw.displayName?.trim() || "Contact",
        email: value.email,
        emailKey: value.emailKey,
        permissionState: value.permissionState,
        permissionRemainsExplicit: true,
        sourceEvidence,
        candidateFingerprint,
        reviewStatus:
          value.permissionState === "opted_in"
            ? "explicit_permission_review"
            : "requires_operator_attestation",
      };
    });

  return {
    candidates,
    excluded: exclusions.sort((a, b) =>
      `${a.contactPointId}:${a.reason}`.localeCompare(`${b.contactPointId}:${b.reason}`)
    ),
  };
}
