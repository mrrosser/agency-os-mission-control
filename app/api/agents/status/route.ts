import { NextResponse } from "next/server";
import { withApiHandler, ApiError } from "@/lib/api/handler";
import { parseJson } from "@/lib/api/validation";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { withIdempotency } from "@/lib/api/idempotency";
import { getAgentSpaceStatus, setAgentSpaceStatus } from "@/lib/agent-status";
import {
  AgentHeartbeatEnvelopeSchema,
  authorizeAgentHeartbeat,
  listAgentCapabilityDescriptors,
  resolveCallerBusinessIds,
} from "@/lib/agents/registry";
import { resolveLeadRunOrgId } from "@/lib/lead-runs/quotas";

export const GET = withApiHandler(
  async ({ request, log }) => {
    const user = await requireFirebaseAuth(request, log);
    const orgId = await resolveLeadRunOrgId(user.uid, log);
    const businessIds = resolveCallerBusinessIds(user as unknown as Record<string, unknown>);
    const spaces = await getAgentSpaceStatus(user.uid, { orgId, businessIds }, log);

    return NextResponse.json({
      org_id: orgId,
      business_ids: businessIds,
      policy: listAgentCapabilityDescriptors(businessIds),
      spaces,
    });
  },
  { route: "agents.status" }
);

export const POST = withApiHandler(
  async ({ request, correlationId, log }) => {
    const user = await requireFirebaseAuth(request, log);
    const body = await parseJson(request, AgentHeartbeatEnvelopeSchema);
    const orgId = await resolveLeadRunOrgId(user.uid, log);
    const businessIds = resolveCallerBusinessIds(user as unknown as Record<string, unknown>);
    const authorization = authorizeAgentHeartbeat(body, { orgId, businessIds });

    if (!authorization.ok) {
      log.warn("agent.status.authorization_rejected", {
        uid: user.uid,
        agentId: body.agent_id,
        orgId,
        requestedOrgId: body.org_id,
        businessId: body.business_id,
        spaceId: body.space_id,
        envelopeCorrelationId: body.correlation_id,
        reason: authorization.reason,
      });
      throw new ApiError(403, "Heartbeat envelope is not authorized", {
        reason: authorization.reason,
      });
    }

    const envelope = authorization.envelope;
    const result = await withIdempotency(
      {
        uid: user.uid,
        route: "agents.status.update",
        key: envelope.idempotency_key,
        log,
      },
      async () => {
        await setAgentSpaceStatus(user.uid, envelope, log);
        return {
          ok: true,
          agent_id: envelope.agent_id,
          org_id: envelope.org_id,
          business_id: envelope.business_id,
          space_id: envelope.space_id,
          policy_version: envelope.policy_version,
          envelope_correlation_id: envelope.correlation_id,
        };
      }
    );

    log.info("agent.status.heartbeat_accepted", {
      uid: user.uid,
      agentId: envelope.agent_id,
      orgId: envelope.org_id,
      businessId: envelope.business_id,
      spaceId: envelope.space_id,
      runId: envelope.run_id,
      correlationId,
      envelopeCorrelationId: envelope.correlation_id,
      idempotencyKey: envelope.idempotency_key,
      replayed: result.replayed,
    });

    return NextResponse.json({
      ...result.data,
      replayed: result.replayed,
      correlation_id: correlationId,
    });
  },
  { route: "agents.status.update" }
);
