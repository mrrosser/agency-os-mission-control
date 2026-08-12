import { createHash } from "node:crypto";
import type {
  WarmReconnectPilot,
  WarmReconnectPilotRecipient,
} from "@/lib/crm/warm-reconnect-activation-types";
import { WARM_RECONNECT_CAMPAIGN_VERSION } from "@/lib/crm/warm-reconnect-types";

const IDENTIFIER_PATTERN = /^[A-Za-z0-9_.:-]{1,200}$/;

export const WARM_RECONNECT_INVITATION_LEDGER_COLLECTION =
  "crm_warm_reconnect_invitation_ledger" as const;

export type WarmReconnectInvitationLedgerStatus =
  | "reserved"
  | "provider_inflight"
  | "sent"
  | "delivery_unknown"
  | "released_before_provider";

export interface WarmReconnectInvitationReservationBinding {
  reservationId: string;
  workspaceId: string;
  campaignVersion: typeof WARM_RECONNECT_CAMPAIGN_VERSION;
  personId: string;
  emailKey: string;
  pilotId: string;
  receiptId: string;
  approvalId: string;
  actionFingerprint: string;
}

export interface WarmReconnectInvitationLedgerDocument
  extends WarmReconnectInvitationReservationBinding {
  schemaVersion: "crm.warm-reconnect-invitation-ledger.v1";
  status: WarmReconnectInvitationLedgerStatus;
  reservationGeneration: number;
  reservedAtMs: number;
  providerStartedAtMs?: number;
  terminalAtMs?: number;
  releasedAtMs?: number;
  correlationId: string;
}

export type WarmReconnectInvitationReservationReconciliation =
  | { action: "reserve"; reservationGeneration: number }
  | { action: "reuse"; reservationGeneration: number }
  | {
      action: "conflict";
      reason:
        | "cross_pilot_one_time_invitation_conflict"
        | "invitation_ledger_unreconciled";
    };

export type WarmReconnectInvitationTransitionTarget =
  | "provider_inflight"
  | "sent"
  | "delivery_unknown"
  | "released_before_provider";

export type WarmReconnectInvitationTransitionReconciliation =
  | { ok: true; action: "transition" }
  | { ok: true; action: "already_applied"; alreadySent: boolean }
  | { ok: false; reason: "invitation_ledger_unreconciled" };

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function warmReconnectInvitationReservationId(input: {
  workspaceId: string;
  campaignVersion: typeof WARM_RECONNECT_CAMPAIGN_VERSION;
  personId: string;
  emailKey: string;
}): string {
  return `wri_${createHash("sha256")
    .update(
      [
        "warm-reconnect-one-time-invitation:v1",
        input.workspaceId,
        input.campaignVersion,
        input.personId,
        input.emailKey,
      ].join("|")
    )
    .digest("hex")
    .slice(0, 40)}`;
}

export function warmReconnectInvitationReservationBindingForPilot(
  pilot: WarmReconnectPilot,
  recipient: WarmReconnectPilotRecipient,
  receiptId: string
): WarmReconnectInvitationReservationBinding {
  const reservationId = warmReconnectInvitationReservationId({
    workspaceId: pilot.workspaceId,
    campaignVersion: WARM_RECONNECT_CAMPAIGN_VERSION,
    personId: recipient.personId,
    emailKey: recipient.emailKey,
  });
  return {
    reservationId,
    workspaceId: pilot.workspaceId,
    campaignVersion: WARM_RECONNECT_CAMPAIGN_VERSION,
    personId: recipient.personId,
    emailKey: recipient.emailKey,
    pilotId: pilot.pilotId,
    receiptId,
    approvalId: pilot.approval?.approvalId || "",
    actionFingerprint: pilot.fingerprints.actionFingerprint,
  };
}

export function parseWarmReconnectInvitationLedgerDocument(
  value: unknown
): WarmReconnectInvitationLedgerDocument | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  const statuses = new Set<WarmReconnectInvitationLedgerStatus>([
    "reserved",
    "provider_inflight",
    "sent",
    "delivery_unknown",
    "released_before_provider",
  ]);
  if (
    candidate.schemaVersion !== "crm.warm-reconnect-invitation-ledger.v1" ||
    !IDENTIFIER_PATTERN.test(asString(candidate.reservationId)) ||
    !IDENTIFIER_PATTERN.test(asString(candidate.workspaceId)) ||
    candidate.campaignVersion !== WARM_RECONNECT_CAMPAIGN_VERSION ||
    !IDENTIFIER_PATTERN.test(asString(candidate.personId)) ||
    !/^sha256:[a-f0-9]{64}$/.test(asString(candidate.emailKey)) ||
    !IDENTIFIER_PATTERN.test(asString(candidate.pilotId)) ||
    !IDENTIFIER_PATTERN.test(asString(candidate.receiptId)) ||
    !IDENTIFIER_PATTERN.test(asString(candidate.approvalId)) ||
    !/^sha256:[a-f0-9]{64}$/.test(asString(candidate.actionFingerprint)) ||
    !statuses.has(candidate.status as WarmReconnectInvitationLedgerStatus) ||
    !Number.isSafeInteger(candidate.reservationGeneration) ||
    Number(candidate.reservationGeneration) < 1 ||
    !Number.isSafeInteger(candidate.reservedAtMs) ||
    Number(candidate.reservedAtMs) < 1 ||
    !IDENTIFIER_PATTERN.test(asString(candidate.correlationId))
  ) {
    return null;
  }
  return candidate as unknown as WarmReconnectInvitationLedgerDocument;
}

export function warmReconnectInvitationBindingMatches(
  ledger: WarmReconnectInvitationLedgerDocument,
  expected: WarmReconnectInvitationReservationBinding
): boolean {
  return (
    ledger.reservationId === expected.reservationId &&
    ledger.workspaceId === expected.workspaceId &&
    ledger.campaignVersion === expected.campaignVersion &&
    ledger.personId === expected.personId &&
    ledger.emailKey === expected.emailKey &&
    ledger.pilotId === expected.pilotId &&
    ledger.receiptId === expected.receiptId &&
    ledger.approvalId === expected.approvalId &&
    ledger.actionFingerprint === expected.actionFingerprint
  );
}

export function reconcileWarmReconnectInvitationReservation(
  existing: unknown,
  expected: WarmReconnectInvitationReservationBinding
): WarmReconnectInvitationReservationReconciliation {
  if (existing === undefined || existing === null) {
    return { action: "reserve", reservationGeneration: 1 };
  }
  const ledger = parseWarmReconnectInvitationLedgerDocument(existing);
  if (
    !ledger ||
    ledger.reservationId !== expected.reservationId ||
    ledger.workspaceId !== expected.workspaceId ||
    ledger.campaignVersion !== expected.campaignVersion ||
    ledger.personId !== expected.personId ||
    ledger.emailKey !== expected.emailKey
  ) {
    return { action: "conflict", reason: "invitation_ledger_unreconciled" };
  }
  if (ledger.status === "released_before_provider") {
    return {
      action: "reserve",
      reservationGeneration: ledger.reservationGeneration + 1,
    };
  }
  if (
    ledger.status === "reserved" &&
    warmReconnectInvitationBindingMatches(ledger, expected)
  ) {
    return {
      action: "reuse",
      reservationGeneration: ledger.reservationGeneration,
    };
  }
  return {
    action: "conflict",
    reason: "cross_pilot_one_time_invitation_conflict",
  };
}

export function reconcileWarmReconnectInvitationTransition(input: {
  existing: unknown;
  expected: WarmReconnectInvitationReservationBinding;
  target: WarmReconnectInvitationTransitionTarget;
}): WarmReconnectInvitationTransitionReconciliation {
  const ledger = parseWarmReconnectInvitationLedgerDocument(input.existing);
  if (!ledger || !warmReconnectInvitationBindingMatches(ledger, input.expected)) {
    return { ok: false, reason: "invitation_ledger_unreconciled" };
  }
  if (ledger.status === input.target) {
    return {
      ok: true,
      action: "already_applied",
      alreadySent: ledger.status === "sent",
    };
  }
  if (input.target === "delivery_unknown" && ledger.status === "sent") {
    return { ok: true, action: "already_applied", alreadySent: true };
  }
  const allowedFrom: Record<
    WarmReconnectInvitationTransitionTarget,
    WarmReconnectInvitationLedgerStatus
  > = {
    provider_inflight: "reserved",
    sent: "provider_inflight",
    delivery_unknown: "provider_inflight",
    released_before_provider: "reserved",
  };
  return ledger.status === allowedFrom[input.target]
    ? { ok: true, action: "transition" }
    : { ok: false, reason: "invitation_ledger_unreconciled" };
}
