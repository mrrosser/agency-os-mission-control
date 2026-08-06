import { NextResponse } from "next/server";
import { z } from "zod";
import {
  AUTONOMY_BUSINESSES,
  AUTONOMY_ACTION_SCOPES,
  AUTONOMY_MODES,
  PROTECTED_AUTONOMY_ACTIONS,
  SAFE_AUTONOMY_ACTIONS,
} from "@/lib/agents/autonomy-policy";
import {
  AutonomyPolicyVersionConflictError,
  getAutonomyPolicy,
  listAutonomyPolicyAudit,
  updateAutonomyPolicy,
} from "@/lib/agents/autonomy-policy-store";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { ApiError, withApiHandler } from "@/lib/api/handler";
import { getIdempotencyKey, withIdempotency } from "@/lib/api/idempotency";
import { parseJson } from "@/lib/api/validation";

export const runtime = "nodejs";

const modeSchema = z.enum(AUTONOMY_MODES);

const executionEnvelopeSchema = z
  .object({
    agentId: z.string().trim().min(1).max(120),
    delegatedBy: z.string().trim().min(1).max(120).optional(),
    scope: z.tuple([z.literal("agent.autonomy_policy.update")]),
    trustLevel: z.literal("high"),
    evidenceRef: z.string().trim().min(1).max(500),
  })
  .strict();

const updateSchema = z
  .object({
    expectedVersion: z.number().int().min(0),
    globalKillSwitch: z.boolean(),
    businessModes: z
      .object({
        rt_solutions: modeSchema,
        rosser_gallery: modeSchema,
      })
      .strict(),
    executionEnvelope: executionEnvelopeSchema,
    idempotencyKey: z.string().trim().min(1).max(200).optional(),
  })
  .strict();

function parseAllowedUids(raw: string | undefined): Set<string> {
  return new Set(
    (raw || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
  );
}

function isAutonomyPolicyOperator(uid: string): boolean {
  const configuredAllowlists = [
    parseAllowedUids(process.env.AGENT_ACTION_ALLOWED_UIDS),
    parseAllowedUids(process.env.AGENT_AUTONOMY_POLICY_ALLOWED_UIDS),
  ].filter((allowlist) => allowlist.size > 0);

  if (configuredAllowlists.length === 0) return false;
  return configuredAllowlists.every((allowlist) => allowlist.has(uid));
}

function requireAutonomyPolicyOperator(uid: string): void {
  if (!isAutonomyPolicyOperator(uid)) {
    throw new ApiError(403, "Forbidden");
  }
}

export const GET = withApiHandler(
  async ({ request, correlationId, log }) => {
    const user = await requireFirebaseAuth(request, log);
    requireAutonomyPolicyOperator(user.uid);

    const [policy, history] = await Promise.all([
      getAutonomyPolicy(user.uid),
      listAutonomyPolicyAudit(user.uid, 25),
    ]);

    log.info("agents.autonomy_policy.read", {
      uid: user.uid,
      version: policy.version,
      auditCount: history.length,
      globalKillSwitch: policy.globalKillSwitch,
    });

    return NextResponse.json({
      policy,
      history,
      contract: {
        modes: AUTONOMY_MODES,
        businesses: AUTONOMY_BUSINESSES,
        protectedActions: PROTECTED_AUTONOMY_ACTIONS,
        safeActions: SAFE_AUTONOMY_ACTIONS,
        actionScopes: AUTONOMY_ACTION_SCOPES,
      },
      correlationId,
    });
  },
  { route: "agents.autonomy-policy.get" }
);

export const PUT = withApiHandler(
  async ({ request, correlationId, log }) => {
    const user = await requireFirebaseAuth(request, log);
    requireAutonomyPolicyOperator(user.uid);
    const payload = await parseJson(request, updateSchema);
    const idempotencyKey = getIdempotencyKey(request, payload);

    const result = await withIdempotency(
      {
        uid: user.uid,
        route: "agents.autonomy-policy.put",
        key: idempotencyKey,
        log,
      },
      async () => {
        try {
          return await updateAutonomyPolicy({
            uid: user.uid,
            actorUid: user.uid,
            expectedVersion: payload.expectedVersion,
            globalKillSwitch: payload.globalKillSwitch,
            businessModes: payload.businessModes,
            executionEnvelope: payload.executionEnvelope,
            correlationId,
            log,
          });
        } catch (error) {
          if (error instanceof AutonomyPolicyVersionConflictError) {
            throw new ApiError(409, "Autonomy policy version conflict", {
              expectedVersion: error.expectedVersion,
              actualVersion: error.actualVersion,
            });
          }
          throw error;
        }
      }
    );

    log.info("agents.autonomy_policy.updated", {
      uid: user.uid,
      version: result.data.policy.version,
      auditId: result.data.auditId,
      replayed: result.replayed,
    });

    return NextResponse.json({
      ...result.data,
      replayed: result.replayed,
      correlationId,
    });
  },
  { route: "agents.autonomy-policy.put" }
);
