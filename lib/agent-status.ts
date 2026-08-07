import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase-admin";
import type { Logger } from "@/lib/logging";
import {
  AgentHeartbeatEnvelopeSchema,
  authorizeAgentHeartbeat,
  type AgentCallerContext,
  type AgentCapability,
  type AgentHeartbeatEnvelope,
  type AgentScope,
  type AgentTrustLevel,
} from "@/lib/agents/registry";
import type { BusinessUnitId } from "@/lib/revenue/offers";

export interface AgentSpaceStatus {
  agentId: string;
  orgId: string;
  businessId: BusinessUnitId;
  scope: AgentScope[];
  trustLevel: AgentTrustLevel;
  evidenceRef: string;
  runId: string;
  correlationId: string;
  idempotencyKey: string;
  policyVersion: string;
  timestamp: string;
  capabilities: AgentCapability[];
  state: "active" | "idle" | "degraded";
  updatedAt?: string | null;
  source?: string | null;
  messageId?: string | null;
}

interface StoredSpaceStatus {
  agentId?: unknown;
  orgId?: unknown;
  businessId?: unknown;
  scope?: unknown;
  trustLevel?: unknown;
  evidenceRef?: unknown;
  runId?: unknown;
  correlationId?: unknown;
  idempotencyKey?: unknown;
  policyVersion?: unknown;
  timestamp?: unknown;
  capabilities?: unknown;
  state?: unknown;
  updatedAt?: unknown;
  source?: unknown;
  messageId?: unknown;
}

const COLLECTION = "agent_status";

function serializeTimestamp(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
  }
  if (typeof value === "number") return new Date(value).toISOString();

  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const toDate = obj.toDate;
    if (typeof toDate === "function") {
      const date = toDate.call(value) as Date;
      return date.toISOString();
    }

    const seconds = obj.seconds;
    if (typeof seconds === "number") {
      return new Date(seconds * 1000).toISOString();
    }
  }

  return null;
}

function serializeSpaces(
  spaces: Record<string, StoredSpaceStatus> | undefined,
  caller: AgentCallerContext,
  log?: Logger
): Record<string, AgentSpaceStatus> {
  if (!spaces) return {};
  const output: Record<string, AgentSpaceStatus> = {};
  let rejected = 0;

  for (const [spaceId, status] of Object.entries(spaces)) {
    const timestamp = serializeTimestamp(status?.timestamp);
    const parsed = AgentHeartbeatEnvelopeSchema.safeParse({
      agent_id: status?.agentId,
      org_id: status?.orgId,
      business_id: status?.businessId,
      space_id: spaceId,
      scope: status?.scope,
      trust_level: status?.trustLevel,
      evidence_ref: status?.evidenceRef,
      run_id: status?.runId,
      correlation_id: status?.correlationId,
      idempotency_key: status?.idempotencyKey,
      policy_version: status?.policyVersion,
      timestamp,
      capabilities: status?.capabilities,
      state: status?.state,
      source: status?.source,
      message_id: status?.messageId,
    });
    if (!parsed.success || !timestamp) {
      rejected += 1;
      continue;
    }

    // Stored heartbeats may be old; use their timestamp as the authorization clock
    // so this read validates identity/scope/context without applying ingestion freshness twice.
    const authorized = authorizeAgentHeartbeat(parsed.data, caller, {
      nowMs: Date.parse(timestamp),
      maxAgeMs: 1,
      maxFutureSkewMs: 1,
    });
    if (!authorized.ok) {
      rejected += 1;
      continue;
    }

    const envelope = authorized.envelope;
    output[spaceId] = {
      agentId: envelope.agent_id,
      orgId: envelope.org_id,
      businessId: envelope.business_id,
      scope: envelope.scope,
      trustLevel: envelope.trust_level,
      evidenceRef: envelope.evidence_ref,
      runId: envelope.run_id,
      correlationId: envelope.correlation_id,
      idempotencyKey: envelope.idempotency_key,
      policyVersion: envelope.policy_version,
      timestamp: envelope.timestamp,
      capabilities: envelope.capabilities,
      state: envelope.state,
      source: envelope.source ?? null,
      messageId: envelope.message_id ?? null,
      updatedAt: serializeTimestamp(status.updatedAt),
    };
  }

  if (rejected > 0) {
    log?.warn("agent.status.records_rejected", { rejected, reason: "registry_or_context_mismatch" });
  }
  return output;
}

export async function getAgentSpaceStatus(
  uid: string,
  caller: AgentCallerContext,
  log?: Logger
): Promise<Record<string, AgentSpaceStatus>> {
  log?.info("agent.status.read", { uid, orgId: caller.orgId, businessIds: caller.businessIds });
  const doc = await getAdminDb().collection(COLLECTION).doc(uid).get();
  const data = doc.data() as { spaces?: Record<string, StoredSpaceStatus> } | undefined;
  return serializeSpaces(data?.spaces, caller, log);
}

export async function setAgentSpaceStatus(
  uid: string,
  envelope: AgentHeartbeatEnvelope,
  log?: Logger
): Promise<void> {
  log?.info("agent.status.update", {
    uid,
    agentId: envelope.agent_id,
    orgId: envelope.org_id,
    businessId: envelope.business_id,
    spaceId: envelope.space_id,
    scope: envelope.scope,
    trustLevel: envelope.trust_level,
    runId: envelope.run_id,
    correlationId: envelope.correlation_id,
    idempotencyKey: envelope.idempotency_key,
    policyVersion: envelope.policy_version,
    capabilityCount: envelope.capabilities.length,
    state: envelope.state,
  });

  await getAdminDb()
    .collection(COLLECTION)
    .doc(uid)
    .set(
      {
        spaces: {
          [envelope.space_id]: {
            agentId: envelope.agent_id,
            orgId: envelope.org_id,
            businessId: envelope.business_id,
            scope: envelope.scope,
            trustLevel: envelope.trust_level,
            evidenceRef: envelope.evidence_ref,
            runId: envelope.run_id,
            correlationId: envelope.correlation_id,
            idempotencyKey: envelope.idempotency_key,
            policyVersion: envelope.policy_version,
            timestamp: envelope.timestamp,
            capabilities: envelope.capabilities,
            state: envelope.state,
            source: envelope.source || null,
            messageId: envelope.message_id || null,
            updatedAt: FieldValue.serverTimestamp(),
          },
        },
      },
      { merge: true }
    );
}
