import "server-only";

import { createHash } from "crypto";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase-admin";

export type DncEntryType = "email" | "phone" | "domain";

export type DncEntry = {
  entryId: string;
  type: DncEntryType;
  value: string;
  normalized: string;
  reason?: string | null;
  createdBy: string;
  createdAt?: unknown;
  updatedAt?: unknown;
};

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function normalizePhone(value: string): string {
  const trimmed = value.trim();
  const digits = trimmed.replace(/[^\d+]/g, "");
  // Preserve leading "+" if present, otherwise store digits only.
  if (digits.startsWith("+")) return `+${digits.slice(1).replace(/[^\d]/g, "")}`;
  return digits.replace(/[^\d]/g, "");
}

function normalizeDomain(value: string): string {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return "";
  try {
    const url = trimmed.includes("://") ? new URL(trimmed) : new URL(`https://${trimmed}`);
    return url.hostname.replace(/^www\./, "");
  } catch {
    return trimmed.replace(/^www\./, "").split("/")[0] || trimmed;
  }
}

export function normalizeDncValue(type: DncEntryType, value: string): string {
  if (type === "email") return normalizeEmail(value);
  if (type === "phone") return normalizePhone(value);
  return normalizeDomain(value);
}

export function computeDncEntryId(type: DncEntryType, normalizedValue: string): string {
  // Stable deterministic ID makes upserts idempotent and prevents duplicates.
  return sha256(`${type}:${normalizedValue}`).slice(0, 32);
}

export function expandDomainCandidates(domain: string): string[] {
  // DNC "domain" blocks should match subdomains too.
  // Example: `sub.example.com` -> ["sub.example.com", "example.com"]
  const normalized = normalizeDomain(domain);
  const parts = normalized.split(".").filter(Boolean);
  if (!parts.length) return [];
  if (parts.length === 1) return [normalized];

  const candidates: string[] = [];
  for (let i = 0; i <= parts.length - 2; i++) {
    const candidate = parts.slice(i).join(".");
    if (candidate && !candidates.includes(candidate)) candidates.push(candidate);
  }
  return candidates;
}

function entriesRef(orgId: string) {
  return getAdminDb().collection("lead_run_org_dnc").doc(orgId).collection("entries");
}

export async function listDncEntries(orgId: string): Promise<DncEntry[]> {
  const snap = await entriesRef(orgId).orderBy("updatedAt", "desc").limit(500).get();
  return snap.docs.map((doc) => {
    const data = doc.data() as Partial<DncEntry>;
    return {
      entryId: doc.id,
      type: (data.type as DncEntryType) || "email",
      value: String(data.value || ""),
      normalized: String(data.normalized || ""),
      reason: (data.reason as string | null | undefined) ?? null,
      createdBy: String(data.createdBy || ""),
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
    };
  });
}

export async function upsertDncEntry(args: {
  orgId: string;
  uid: string;
  type: DncEntryType;
  value: string;
  reason?: string | null;
}): Promise<DncEntry> {
  const normalized = normalizeDncValue(args.type, args.value);
  const entryId = computeDncEntryId(args.type, normalized);
  const ref = entriesRef(args.orgId).doc(entryId);

  await getAdminDb().runTransaction(async (tx) => {
    const existing = await tx.get(ref);
    const now = FieldValue.serverTimestamp();
    tx.set(
      ref,
      {
        type: args.type,
        value: args.value,
        normalized,
        reason: args.reason ?? null,
        createdBy: args.uid,
        updatedAt: now,
        createdAt: existing.exists ? undefined : now,
      } satisfies Record<string, unknown>,
      { merge: true }
    );
  });

  return {
    entryId,
    type: args.type,
    value: args.value,
    normalized,
    reason: args.reason ?? null,
    createdBy: args.uid,
  };
}

export async function deleteDncEntry(orgId: string, entryId: string): Promise<void> {
  await entriesRef(orgId).doc(entryId).delete();
}

export async function findDncMatch(args: {
  orgId: string;
  email?: string | null;
  phone?: string | null;
  domain?: string | null;
}): Promise<DncEntry | null> {
  const candidates: Array<{ type: DncEntryType; normalized: string }> = [];
  if (args.email) candidates.push({ type: "email", normalized: normalizeEmail(args.email) });
  if (args.phone) candidates.push({ type: "phone", normalized: normalizePhone(args.phone) });
  if (args.domain) {
    for (const normalized of expandDomainCandidates(args.domain)) {
      candidates.push({ type: "domain", normalized });
    }
  }

  for (const c of candidates) {
    if (!c.normalized) continue;
    const entryId = computeDncEntryId(c.type, c.normalized);
    const snap = await entriesRef(args.orgId).doc(entryId).get();
    if (!snap.exists) continue;
    const data = snap.data() as Partial<DncEntry>;
    return {
      entryId: snap.id,
      type: (data.type as DncEntryType) || c.type,
      value: String(data.value || c.normalized),
      normalized: String(data.normalized || c.normalized),
      reason: (data.reason as string | null | undefined) ?? null,
      createdBy: String(data.createdBy || ""),
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
    };
  }

  return null;
}
