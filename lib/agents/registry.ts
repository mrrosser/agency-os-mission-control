import { z } from "zod";
import type { BusinessUnitId } from "@/lib/revenue/offers";

export const AGENT_PROTOCOL_POLICY_VERSION = "mission-control-agent/v1";
export const ACTION_EXECUTOR_AGENT_ID = "fn-actions";

export const BUSINESS_UNIT_IDS = [
  "rosser_nft_gallery",
  "rt_solutions",
] as const satisfies readonly BusinessUnitId[];

export const AGENT_SERVICE_IDS = [
  "openai_brain",
  "google_workspace",
  "gmail_tooling",
  "calendar_tooling",
  "drive_knowledge",
  "twilio_voice",
  "elevenlabs_tts",
  "firecrawl_research",
  "square_pos",
  "smauto_mcp",
  "leadops_mcp",
  "paperclip_system",
  "openclaw_sync",
] as const;

export type AgentServiceId = (typeof AGENT_SERVICE_IDS)[number];

export const AGENT_SCOPES = [
  "orchestration",
  "business:rosser_nft_gallery",
  "business:rt_solutions",
  "marketing",
  "research",
  "actions",
  "opportunities",
  "qualification",
  "applications",
  "meeting_outreach",
  "crm_reconciliation",
] as const;

export const AgentScopeSchema = z.enum(AGENT_SCOPES);
export type AgentScope = z.infer<typeof AgentScopeSchema>;

export const AGENT_TRUST_LEVELS = [
  "read_only",
  "bounded_internal",
  "consequential_executor",
] as const;

export const AgentTrustLevelSchema = z.enum(AGENT_TRUST_LEVELS);
export type AgentTrustLevel = z.infer<typeof AgentTrustLevelSchema>;

export const AGENT_CAPABILITIES = [
  "context.read",
  "orchestration.route",
  "marketing.plan",
  "research.search",
  "opportunity.discover",
  "opportunity.classify",
  "qualification.score",
  "qualification.verify",
  "application.draft",
  "outreach.draft",
  "meeting.prepare",
  "crm.read",
  "crm.reconcile.internal",
  "external.email.send",
  "external.calendar.create",
  "external.sms.send",
  "external.voice.call",
  "external.content.publish",
  "external.payment.create",
] as const;

export const AgentCapabilitySchema = z.enum(AGENT_CAPABILITIES);
export type AgentCapability = z.infer<typeof AgentCapabilitySchema>;

export const CONSEQUENTIAL_EXTERNAL_CAPABILITIES = [
  "external.email.send",
  "external.calendar.create",
  "external.sms.send",
  "external.voice.call",
  "external.content.publish",
  "external.payment.create",
] as const satisfies readonly AgentCapability[];

const consequentialCapabilitySet = new Set<AgentCapability>(CONSEQUENTIAL_EXTERNAL_CAPABILITIES);

export const AGENT_SPACE_IDS = {
  outreach: "spaces/AAQA62xqRGQ",
  codingInfra: "spaces/AAQALocqO7Q",
  marketing: "spaces/AAQAcKXw-dU",
  research: "spaces/AAQA84U_woE",
  operations: "spaces/AAQAJt-QD1I",
} as const;

export type AgentSpaceId = (typeof AGENT_SPACE_IDS)[keyof typeof AGENT_SPACE_IDS];

export interface AgentSpaceDefinition {
  id: AgentSpaceId;
  key: keyof typeof AGENT_SPACE_IDS;
  label: string;
}

export const AGENT_SPACE_REGISTRY: readonly AgentSpaceDefinition[] = [
  { id: AGENT_SPACE_IDS.outreach, key: "outreach", label: "Outreach" },
  { id: AGENT_SPACE_IDS.codingInfra, key: "codingInfra", label: "Coding / Infrastructure" },
  { id: AGENT_SPACE_IDS.marketing, key: "marketing", label: "Marketing / Social" },
  { id: AGENT_SPACE_IDS.research, key: "research", label: "Research Intelligence" },
  { id: AGENT_SPACE_IDS.operations, key: "operations", label: "Mission Control Operations" },
];

export interface AgentDefinition {
  id: string;
  aliases: readonly string[];
  label: string;
  role: string;
  businessId: BusinessUnitId | null;
  allowedBusinessIds: readonly BusinessUnitId[];
  allowedSpaceIds: readonly AgentSpaceId[];
  scopes: readonly AgentScope[];
  trustLevel: AgentTrustLevel;
  capabilities: readonly AgentCapability[];
  canConsequentialExternalWrite: boolean;
  baseMonthlyCostUsd: number;
  requiredServices: readonly AgentServiceId[];
  declaredServices?: readonly AgentServiceId[];
}

const ALL_BUSINESSES = BUSINESS_UNIT_IDS;
const ALL_SPACES = Object.values(AGENT_SPACE_IDS) as AgentSpaceId[];

export const AGENT_REGISTRY: readonly AgentDefinition[] = [
  {
    id: "orchestrator",
    aliases: ["main", "default", "coding"],
    label: "Master Orchestrator",
    role: "router",
    businessId: null,
    allowedBusinessIds: ALL_BUSINESSES,
    allowedSpaceIds: ALL_SPACES,
    scopes: ["orchestration"],
    trustLevel: "bounded_internal",
    capabilities: ["context.read", "orchestration.route"],
    canConsequentialExternalWrite: false,
    baseMonthlyCostUsd: 26,
    requiredServices: ["openai_brain"],
    declaredServices: ["smauto_mcp", "leadops_mcp", "paperclip_system", "openclaw_sync"],
  },
  {
    id: "biz-rng",
    aliases: ["biz_rng"],
    label: "Rosser Gallery Agent",
    role: "business-specialist",
    businessId: "rosser_nft_gallery",
    allowedBusinessIds: ["rosser_nft_gallery"],
    allowedSpaceIds: [AGENT_SPACE_IDS.outreach, AGENT_SPACE_IDS.operations],
    scopes: ["business:rosser_nft_gallery"],
    trustLevel: "bounded_internal",
    capabilities: ["context.read", "crm.read", "outreach.draft"],
    canConsequentialExternalWrite: false,
    baseMonthlyCostUsd: 14,
    requiredServices: ["openai_brain", "google_workspace"],
  },
  {
    id: "biz-rts",
    aliases: ["biz_rts"],
    label: "RT Solutions Agent",
    role: "business-specialist",
    businessId: "rt_solutions",
    allowedBusinessIds: ["rt_solutions"],
    allowedSpaceIds: [AGENT_SPACE_IDS.outreach, AGENT_SPACE_IDS.operations],
    scopes: ["business:rt_solutions"],
    trustLevel: "bounded_internal",
    capabilities: ["context.read", "crm.read", "outreach.draft"],
    canConsequentialExternalWrite: false,
    baseMonthlyCostUsd: 14,
    requiredServices: ["openai_brain", "google_workspace"],
  },
  {
    id: "fn-marketing",
    aliases: ["fn_marketing"],
    label: "Marketing Agent",
    role: "function-specialist",
    businessId: null,
    allowedBusinessIds: ALL_BUSINESSES,
    allowedSpaceIds: [AGENT_SPACE_IDS.marketing, AGENT_SPACE_IDS.operations],
    scopes: ["marketing"],
    trustLevel: "bounded_internal",
    capabilities: ["context.read", "marketing.plan", "outreach.draft"],
    canConsequentialExternalWrite: false,
    baseMonthlyCostUsd: 11,
    requiredServices: ["openai_brain"],
    declaredServices: ["smauto_mcp"],
  },
  {
    id: "fn-research",
    aliases: ["fn_research"],
    label: "Research Agent",
    role: "function-specialist",
    businessId: null,
    allowedBusinessIds: ALL_BUSINESSES,
    allowedSpaceIds: [AGENT_SPACE_IDS.research, AGENT_SPACE_IDS.codingInfra, AGENT_SPACE_IDS.operations],
    scopes: ["research"],
    trustLevel: "read_only",
    capabilities: ["context.read", "research.search"],
    canConsequentialExternalWrite: false,
    baseMonthlyCostUsd: 11,
    requiredServices: ["openai_brain", "firecrawl_research"],
    declaredServices: ["paperclip_system", "openclaw_sync", "leadops_mcp"],
  },
  {
    id: ACTION_EXECUTOR_AGENT_ID,
    aliases: ["fn_actions"],
    label: "Action Executor",
    role: "writer",
    businessId: null,
    allowedBusinessIds: ALL_BUSINESSES,
    allowedSpaceIds: [AGENT_SPACE_IDS.outreach, AGENT_SPACE_IDS.operations],
    scopes: ["actions"],
    trustLevel: "consequential_executor",
    capabilities: [
      "context.read",
      "crm.read",
      "external.email.send",
      "external.calendar.create",
      "external.sms.send",
      "external.voice.call",
      "external.content.publish",
      "external.payment.create",
    ],
    canConsequentialExternalWrite: true,
    baseMonthlyCostUsd: 16,
    requiredServices: ["gmail_tooling", "calendar_tooling", "google_workspace"],
    declaredServices: ["leadops_mcp", "paperclip_system", "openclaw_sync"],
  },
  {
    id: "opportunity-scout",
    aliases: ["opportunity_scout"],
    label: "Opportunity Scout",
    role: "bounded-specialist",
    businessId: null,
    allowedBusinessIds: ALL_BUSINESSES,
    allowedSpaceIds: [AGENT_SPACE_IDS.research, AGENT_SPACE_IDS.outreach, AGENT_SPACE_IDS.operations],
    scopes: ["opportunities"],
    trustLevel: "read_only",
    capabilities: ["context.read", "research.search", "opportunity.discover", "opportunity.classify"],
    canConsequentialExternalWrite: false,
    baseMonthlyCostUsd: 9,
    requiredServices: ["openai_brain", "firecrawl_research"],
    declaredServices: ["leadops_mcp"],
  },
  {
    id: "qualification-verifier",
    aliases: ["qualification_verifier"],
    label: "Qualification Verifier",
    role: "bounded-specialist",
    businessId: null,
    allowedBusinessIds: ALL_BUSINESSES,
    allowedSpaceIds: [AGENT_SPACE_IDS.research, AGENT_SPACE_IDS.outreach, AGENT_SPACE_IDS.operations],
    scopes: ["qualification"],
    trustLevel: "bounded_internal",
    capabilities: ["context.read", "crm.read", "qualification.score", "qualification.verify"],
    canConsequentialExternalWrite: false,
    baseMonthlyCostUsd: 8,
    requiredServices: ["openai_brain"],
    declaredServices: ["leadops_mcp"],
  },
  {
    id: "application-drafter",
    aliases: ["application_drafter"],
    label: "Application Drafter",
    role: "bounded-specialist",
    businessId: null,
    allowedBusinessIds: ALL_BUSINESSES,
    allowedSpaceIds: [AGENT_SPACE_IDS.research, AGENT_SPACE_IDS.outreach, AGENT_SPACE_IDS.operations],
    scopes: ["applications"],
    trustLevel: "bounded_internal",
    capabilities: ["context.read", "crm.read", "application.draft"],
    canConsequentialExternalWrite: false,
    baseMonthlyCostUsd: 8,
    requiredServices: ["openai_brain", "drive_knowledge"],
  },
  {
    id: "meeting-outreach-prep",
    aliases: ["meeting_outreach_prep"],
    label: "Meeting + Outreach Prep",
    role: "bounded-specialist",
    businessId: null,
    allowedBusinessIds: ALL_BUSINESSES,
    allowedSpaceIds: [AGENT_SPACE_IDS.outreach, AGENT_SPACE_IDS.marketing, AGENT_SPACE_IDS.operations],
    scopes: ["meeting_outreach"],
    trustLevel: "bounded_internal",
    capabilities: ["context.read", "crm.read", "outreach.draft", "meeting.prepare"],
    canConsequentialExternalWrite: false,
    baseMonthlyCostUsd: 8,
    requiredServices: ["openai_brain", "google_workspace"],
  },
  {
    id: "crm-reconciler",
    aliases: ["crm_reconciler"],
    label: "CRM Reconciler",
    role: "bounded-specialist",
    businessId: null,
    allowedBusinessIds: ALL_BUSINESSES,
    allowedSpaceIds: [AGENT_SPACE_IDS.codingInfra, AGENT_SPACE_IDS.outreach, AGENT_SPACE_IDS.operations],
    scopes: ["crm_reconciliation"],
    trustLevel: "bounded_internal",
    capabilities: ["context.read", "crm.read", "crm.reconcile.internal"],
    canConsequentialExternalWrite: false,
    baseMonthlyCostUsd: 8,
    requiredServices: ["openai_brain"],
    declaredServices: ["paperclip_system", "leadops_mcp"],
  },
] as const;

const agentByIdOrAlias = new Map<string, AgentDefinition>();
for (const agent of AGENT_REGISTRY) {
  agentByIdOrAlias.set(agent.id, agent);
  for (const alias of agent.aliases) agentByIdOrAlias.set(alias, agent);

  const hasConsequentialCapability = agent.capabilities.some((capability) =>
    consequentialCapabilitySet.has(capability)
  );
  if (hasConsequentialCapability !== agent.canConsequentialExternalWrite) {
    throw new Error(`Agent registry write-capability invariant failed for ${agent.id}`);
  }
  if (agent.canConsequentialExternalWrite && agent.id !== ACTION_EXECUTOR_AGENT_ID) {
    throw new Error(`Only ${ACTION_EXECUTOR_AGENT_ID} may declare consequential external writes`);
  }
}

const spaceById = new Map(AGENT_SPACE_REGISTRY.map((space) => [space.id, space]));

const uniqueArray = <T extends string>(schema: z.ZodType<T>) =>
  z.array(schema).min(1).max(32).superRefine((values, ctx) => {
    if (new Set(values).size !== values.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Values must be unique" });
    }
  });

const identifierSchema = z.string().trim().min(1).max(160).regex(/^[A-Za-z0-9._:/-]+$/);

export const AgentTrustEnvelopeSchema = z
  .object({
    agent_id: z.string().trim().min(1).max(80),
    org_id: z.string().trim().min(1).max(120).regex(/^[A-Za-z0-9_-]+$/),
    business_id: z.enum(BUSINESS_UNIT_IDS),
    scope: uniqueArray(AgentScopeSchema),
    trust_level: AgentTrustLevelSchema,
    evidence_ref: identifierSchema,
    run_id: identifierSchema,
    correlation_id: identifierSchema,
    idempotency_key: identifierSchema,
    policy_version: z.literal(AGENT_PROTOCOL_POLICY_VERSION),
    timestamp: z.string().datetime({ offset: true }),
  })
  .strict();

export const AgentCapabilityEnvelopeSchema = AgentTrustEnvelopeSchema.extend({
  space_id: z.string().trim().min(1).max(120),
  capabilities: uniqueArray(AgentCapabilitySchema),
}).strict();

export const AgentHeartbeatEnvelopeSchema = AgentCapabilityEnvelopeSchema.extend({
  state: z.enum(["active", "idle", "degraded"]).default("active"),
  source: z.string().trim().min(1).max(120).optional(),
  message_id: z.string().trim().min(1).max(200).optional(),
}).strict();

export type AgentTrustEnvelope = z.infer<typeof AgentTrustEnvelopeSchema>;
export type AgentCapabilityEnvelope = z.infer<typeof AgentCapabilityEnvelopeSchema>;
export type AgentHeartbeatEnvelope = z.infer<typeof AgentHeartbeatEnvelopeSchema>;

export interface AgentCallerContext {
  orgId: string;
  businessIds: readonly BusinessUnitId[];
}

export type AgentEnvelopeAuthorizationResult =
  | { ok: true; envelope: AgentHeartbeatEnvelope; agent: AgentDefinition }
  | { ok: false; reason: string };

export function resolveAgentDefinition(agentId: string): AgentDefinition | null {
  return agentByIdOrAlias.get(agentId.trim().toLowerCase()) || null;
}

export function resolveAgentSpace(spaceId: string): AgentSpaceDefinition | null {
  return spaceById.get(spaceId.trim() as AgentSpaceId) || null;
}

export function resolveCallerBusinessIds(claims: Record<string, unknown>): BusinessUnitId[] {
  const claimKeys = ["business_ids", "businessIds", "business_units", "businessUnits", "business_id"];
  let explicitClaim = false;
  const values: string[] = [];

  for (const key of claimKeys) {
    if (!(key in claims)) continue;
    explicitClaim = true;
    const value = claims[key];
    if (Array.isArray(value)) {
      values.push(...value.filter((item): item is string => typeof item === "string"));
    } else if (typeof value === "string") {
      values.push(...value.split(","));
    }
  }

  if (!explicitClaim) return [...BUSINESS_UNIT_IDS];
  const allowed = new Set<BusinessUnitId>();
  for (const value of values) {
    const normalized = value.trim() as BusinessUnitId;
    if ((BUSINESS_UNIT_IDS as readonly string[]).includes(normalized)) allowed.add(normalized);
  }
  return Array.from(allowed);
}

export function authorizeAgentHeartbeat(
  input: AgentHeartbeatEnvelope,
  caller: AgentCallerContext,
  options?: { nowMs?: number; maxAgeMs?: number; maxFutureSkewMs?: number }
): AgentEnvelopeAuthorizationResult {
  const agent = resolveAgentDefinition(input.agent_id);
  if (!agent) return { ok: false, reason: "unknown_agent" };
  if (!resolveAgentSpace(input.space_id)) return { ok: false, reason: "unknown_space" };
  if (input.org_id !== caller.orgId) return { ok: false, reason: "org_context_mismatch" };
  if (!caller.businessIds.includes(input.business_id)) {
    return { ok: false, reason: "business_context_forbidden" };
  }
  if (!agent.allowedBusinessIds.includes(input.business_id)) {
    return { ok: false, reason: "agent_business_forbidden" };
  }
  if (!agent.allowedSpaceIds.includes(input.space_id as AgentSpaceId)) {
    return { ok: false, reason: "agent_space_forbidden" };
  }
  if (input.trust_level !== agent.trustLevel) {
    return { ok: false, reason: "trust_level_mismatch" };
  }
  if (input.scope.some((scope) => !agent.scopes.includes(scope))) {
    return { ok: false, reason: "scope_forbidden" };
  }
  if (input.capabilities.some((capability) => !agent.capabilities.includes(capability))) {
    return { ok: false, reason: "capability_forbidden" };
  }
  if (
    input.capabilities.some((capability) => consequentialCapabilitySet.has(capability)) &&
    agent.id !== ACTION_EXECUTOR_AGENT_ID
  ) {
    return { ok: false, reason: "external_write_forbidden" };
  }

  const timestampMs = Date.parse(input.timestamp);
  const nowMs = options?.nowMs ?? Date.now();
  const maxAgeMs = options?.maxAgeMs ?? 10 * 60 * 1000;
  const maxFutureSkewMs = options?.maxFutureSkewMs ?? 2 * 60 * 1000;
  if (!Number.isFinite(timestampMs) || timestampMs < nowMs - maxAgeMs) {
    return { ok: false, reason: "stale_timestamp" };
  }
  if (timestampMs > nowMs + maxFutureSkewMs) {
    return { ok: false, reason: "future_timestamp" };
  }

  return {
    ok: true,
    agent,
    envelope: {
      ...input,
      agent_id: agent.id,
    },
  };
}

export function listAgentCapabilityDescriptors(businessIds: readonly BusinessUnitId[]) {
  return AGENT_REGISTRY.filter((agent) =>
    agent.allowedBusinessIds.some((businessId) => businessIds.includes(businessId))
  ).map((agent) => ({
    agent_id: agent.id,
    label: agent.label,
    role: agent.role,
    business_ids: agent.allowedBusinessIds,
    space_ids: agent.allowedSpaceIds,
    scope: agent.scopes,
    trust_level: agent.trustLevel,
    capabilities: agent.capabilities,
    consequential_external_writes: agent.canConsequentialExternalWrite,
    policy_version: AGENT_PROTOCOL_POLICY_VERSION,
  }));
}

export function isConsequentialExternalCapability(capability: AgentCapability): boolean {
  return consequentialCapabilitySet.has(capability);
}
