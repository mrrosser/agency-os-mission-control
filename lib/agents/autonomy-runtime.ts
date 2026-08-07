import type { Logger } from "@/lib/logging";
import { getAutonomyPolicy } from "@/lib/agents/autonomy-policy-store";
import type { AutonomyBusinessId } from "@/lib/agents/autonomy-policy";

export type RuntimePauseReason =
  | "not_paused"
  | "environment_kill_switch"
  | "operator_global_pause"
  | "policy_read_failed";

export interface RuntimePauseDecision {
  paused: boolean;
  reason: RuntimePauseReason;
  businessId: AutonomyBusinessId | null;
}

function readBoolean(value: string | undefined): boolean {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

export function resolveAutonomyBusinessId(value: unknown): AutonomyBusinessId | null {
  const normalized = String(value || "").trim().toLowerCase();
  if (["rt", "rts", "rt_solutions"].includes(normalized)) return "rt_solutions";
  if (["rng", "rosser_gallery", "rosser_nft_gallery"].includes(normalized)) {
    return "rosser_gallery";
  }
  return null;
}

function isExplicitAiCoFoundry(value: unknown): boolean {
  return ["aicf", "ai_cofoundry", "ai-cofoundry"].includes(
    String(value || "").trim().toLowerCase()
  );
}

export async function resolveRuntimePause(input: {
  uid: string;
  businessKey?: unknown;
  businessUnit?: unknown;
  log: Logger;
}): Promise<RuntimePauseDecision> {
  const businessId =
    resolveAutonomyBusinessId(input.businessKey) ||
    resolveAutonomyBusinessId(input.businessUnit);

  if (readBoolean(process.env.MISSION_CONTROL_GLOBAL_KILL_SWITCH)) {
    return { paused: true, reason: "environment_kill_switch", businessId };
  }

  // The stored operator policy intentionally covers only RT Solutions and
  // Rosser Gallery. An explicitly scoped AI CoFoundry run remains governed by
  // the environment switch. Legacy or unknown scopes still consult the global
  // policy so an old RT/Rosser job cannot bypass an operator pause.
  if (
    !businessId &&
    (isExplicitAiCoFoundry(input.businessKey) || isExplicitAiCoFoundry(input.businessUnit))
  ) {
    return { paused: false, reason: "not_paused", businessId: null };
  }

  try {
    const policy = await getAutonomyPolicy(input.uid);
    return policy.globalKillSwitch
      ? { paused: true, reason: "operator_global_pause", businessId }
      : { paused: false, reason: "not_paused", businessId };
  } catch (error) {
    input.log.error("agents.autonomy_runtime.policy_read_failed", {
      uid: input.uid,
      businessId,
      error: error instanceof Error ? error.message : String(error),
    });
    return { paused: true, reason: "policy_read_failed", businessId };
  }
}
