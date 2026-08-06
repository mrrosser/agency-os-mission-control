export const AUTONOMY_MODES = ["assist", "supervised", "autonomous_safe"] as const;

export type AutonomyMode = (typeof AUTONOMY_MODES)[number];

export const AUTONOMY_BUSINESSES = {
  rt_solutions: "RT Solutions",
  rosser_gallery: "Rosser Gallery",
} as const;

export type AutonomyBusinessId = keyof typeof AUTONOMY_BUSINESSES;

export const PROTECTED_AUTONOMY_ACTIONS = [
  "email_send",
  "public_publish",
  "sms_send",
  "voice_call",
  "spend",
  "payment",
  "contract",
  "legal",
  "pricing",
  "final_submission",
  "calendar_external_create",
] as const;

export type ProtectedAutonomyAction = (typeof PROTECTED_AUTONOMY_ACTIONS)[number];

export const SAFE_AUTONOMY_ACTIONS = [
  "opportunity_scan",
  "crm_internal_sync",
  "knowledge_sync",
  "draft_create",
  "internal_analysis",
  "calendar_availability_read",
  "crm_record_read",
] as const;

export type SafeAutonomyAction = (typeof SAFE_AUTONOMY_ACTIONS)[number];

export interface AgentExecutionEnvelope {
  agentId: string;
  delegatedBy?: string | null;
  scope: string[];
  trustLevel: "low" | "medium" | "high";
  evidenceRef: string;
}

export interface AutonomyPolicy {
  uid: string;
  version: number;
  globalKillSwitch: boolean;
  businessModes: Record<AutonomyBusinessId, AutonomyMode>;
  updatedAt: string | null;
  updatedByUid: string | null;
}

export type AutonomyDecisionOutcome = "auto_execute" | "approval_required" | "blocked";

export interface AutonomyDecision {
  outcome: AutonomyDecisionOutcome;
  effectiveMode: AutonomyMode;
  canAutoExecute: boolean;
  requiresHumanApproval: boolean;
  protectedAction: boolean;
  reason:
    | "global_kill_switch"
    | "unknown_action"
    | "invalid_execution_envelope"
    | "scope_not_authorized"
    | "protected_action"
    | "assist_mode"
    | "supervised_mode"
    | "autonomous_safe";
}

const MODE_RANK: Record<AutonomyMode, number> = {
  assist: 0,
  supervised: 1,
  autonomous_safe: 2,
};

const PROTECTED_ACTION_SET = new Set<string>(PROTECTED_AUTONOMY_ACTIONS);
const SAFE_ACTION_SET = new Set<string>(SAFE_AUTONOMY_ACTIONS);
export const AUTONOMY_ACTION_SCOPES: Readonly<Record<
  ProtectedAutonomyAction | SafeAutonomyAction,
  string
>> = Object.freeze({
  email_send: "email.send",
  public_publish: "content.public.publish",
  sms_send: "sms.send",
  voice_call: "voice.call",
  spend: "finance.spend",
  payment: "finance.payment",
  contract: "legal.contract",
  legal: "legal.review",
  pricing: "pricing.finalize",
  final_submission: "submission.finalize",
  calendar_external_create: "calendar.external.create",
  opportunity_scan: "opportunity.scan",
  crm_internal_sync: "crm.internal.sync",
  knowledge_sync: "knowledge.sync",
  draft_create: "draft.create",
  internal_analysis: "analysis.internal",
  calendar_availability_read: "calendar.availability.read",
  crm_record_read: "crm.record.read",
});

function isAutonomyMode(value: unknown): value is AutonomyMode {
  return typeof value === "string" && AUTONOMY_MODES.includes(value as AutonomyMode);
}

function isBusinessId(value: unknown): value is AutonomyBusinessId {
  return typeof value === "string" && Object.hasOwn(AUTONOMY_BUSINESSES, value);
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

export function createDefaultAutonomyPolicy(uid: string): AutonomyPolicy {
  return {
    uid,
    version: 0,
    globalKillSwitch: false,
    businessModes: {
      rt_solutions: "assist",
      rosser_gallery: "assist",
    },
    updatedAt: null,
    updatedByUid: null,
  };
}

export function normalizeAutonomyPolicy(uid: string, value: unknown): AutonomyPolicy {
  const fallback = createDefaultAutonomyPolicy(uid);
  if (!value || typeof value !== "object") return fallback;

  const row = value as Record<string, unknown>;
  const rawBusinessModes =
    row.businessModes && typeof row.businessModes === "object"
      ? (row.businessModes as Record<string, unknown>)
      : {};
  const version = Number(row.version);

  return {
    uid,
    version: Number.isInteger(version) && version >= 0 ? version : 0,
    // A malformed persisted kill-switch value is a corrupt policy, so block it.
    globalKillSwitch:
      typeof row.globalKillSwitch === "boolean" ? row.globalKillSwitch : true,
    businessModes: {
      rt_solutions: isAutonomyMode(rawBusinessModes.rt_solutions)
        ? rawBusinessModes.rt_solutions
        : "assist",
      rosser_gallery: isAutonomyMode(rawBusinessModes.rosser_gallery)
        ? rawBusinessModes.rosser_gallery
        : "assist",
    },
    updatedAt: asNonEmptyString(row.updatedAt),
    updatedByUid: asNonEmptyString(row.updatedByUid),
  };
}

export function resolveMostRestrictiveAutonomyMode(
  ...modes: unknown[]
): AutonomyMode {
  if (modes.length === 0) return "assist";

  let resolved: AutonomyMode = "autonomous_safe";
  for (const mode of modes) {
    if (!isAutonomyMode(mode)) return "assist";
    if (MODE_RANK[mode] < MODE_RANK[resolved]) {
      resolved = mode;
    }
  }
  return resolved;
}

export function isProtectedAutonomyAction(action: string): boolean {
  return PROTECTED_ACTION_SET.has(action.trim().toLowerCase());
}

export function hasValidExecutionEnvelope(
  envelope: AgentExecutionEnvelope | null | undefined
): envelope is AgentExecutionEnvelope {
  if (!envelope) return false;
  if (!asNonEmptyString(envelope.agentId)) return false;
  if (!asNonEmptyString(envelope.evidenceRef)) return false;
  if (!Array.isArray(envelope.scope) || envelope.scope.length === 0) return false;
  if (envelope.scope.some((scope) => !asNonEmptyString(scope))) return false;
  if (
    envelope.scope.some(
      (scope) =>
        scope.includes("*") ||
        !/^[a-z0-9]+(?:[._:-][a-z0-9]+)+$/.test(scope)
    )
  ) {
    return false;
  }
  return ["low", "medium", "high"].includes(envelope.trustLevel);
}

export function resolveAutonomyDecision(input: {
  policy: AutonomyPolicy | null | undefined;
  businessId: string;
  requestedMode: unknown;
  action: string;
  executionEnvelope?: AgentExecutionEnvelope | null;
  runtimeGlobalKillSwitch?: boolean;
}): AutonomyDecision {
  const policy = input.policy
    ? normalizeAutonomyPolicy(input.policy.uid, input.policy)
    : createDefaultAutonomyPolicy("");
  const configuredMode = isBusinessId(input.businessId)
    ? policy.businessModes[input.businessId]
    : "assist";
  const effectiveMode = resolveMostRestrictiveAutonomyMode(
    configuredMode,
    input.requestedMode
  );
  const action = input.action.trim().toLowerCase();
  const protectedAction = isProtectedAutonomyAction(action);
  const knownSafeAction = SAFE_ACTION_SET.has(action);

  if (policy.globalKillSwitch || input.runtimeGlobalKillSwitch === true) {
    return {
      outcome: "blocked",
      effectiveMode: "assist",
      canAutoExecute: false,
      requiresHumanApproval: false,
      protectedAction,
      reason: "global_kill_switch",
    };
  }

  if (!protectedAction && !knownSafeAction) {
    return {
      outcome: "blocked",
      effectiveMode,
      canAutoExecute: false,
      requiresHumanApproval: false,
      protectedAction: false,
      reason: "unknown_action",
    };
  }

  if (!hasValidExecutionEnvelope(input.executionEnvelope)) {
    return {
      outcome: "blocked",
      effectiveMode,
      canAutoExecute: false,
      requiresHumanApproval: false,
      protectedAction,
      reason: "invalid_execution_envelope",
    };
  }

  const requiredScope = AUTONOMY_ACTION_SCOPES[
    action as ProtectedAutonomyAction | SafeAutonomyAction
  ];
  if (!input.executionEnvelope.scope.includes(requiredScope)) {
    return {
      outcome: "blocked",
      effectiveMode,
      canAutoExecute: false,
      requiresHumanApproval: false,
      protectedAction,
      reason: "scope_not_authorized",
    };
  }

  if (protectedAction) {
    return {
      outcome: "approval_required",
      effectiveMode,
      canAutoExecute: false,
      requiresHumanApproval: true,
      protectedAction: true,
      reason: "protected_action",
    };
  }

  if (effectiveMode === "assist") {
    return {
      outcome: "approval_required",
      effectiveMode,
      canAutoExecute: false,
      requiresHumanApproval: true,
      protectedAction: false,
      reason: "assist_mode",
    };
  }

  if (effectiveMode === "supervised") {
    return {
      outcome: "approval_required",
      effectiveMode,
      canAutoExecute: false,
      requiresHumanApproval: true,
      protectedAction: false,
      reason: "supervised_mode",
    };
  }

  return {
    outcome: "auto_execute",
    effectiveMode,
    canAutoExecute: true,
    requiresHumanApproval: false,
    protectedAction: false,
    reason: "autonomous_safe",
  };
}
