import { describe, expect, it } from "vitest";
import {
  AUTONOMY_ACTION_SCOPES,
  PROTECTED_AUTONOMY_ACTIONS,
  createDefaultAutonomyPolicy,
  normalizeAutonomyPolicy,
  resolveAutonomyDecision,
  resolveMostRestrictiveAutonomyMode,
  type AgentExecutionEnvelope,
} from "@/lib/agents/autonomy-policy";

const VALID_ENVELOPE: AgentExecutionEnvelope = {
  agentId: "mission-control/orchestrator",
  delegatedBy: "operator-1",
  scope: ["crm.internal.sync"],
  trustLevel: "medium",
  evidenceRef: "docs/autonomy-policy.md#provider-boundary-contract",
};

describe("autonomy policy", () => {
  it("defaults both supported businesses to assist", () => {
    const policy = createDefaultAutonomyPolicy("user-1");

    expect(policy.globalKillSwitch).toBe(false);
    expect(policy.version).toBe(0);
    expect(policy.businessModes).toEqual({
      rt_solutions: "assist",
      rosser_gallery: "assist",
    });
    expect(Object.keys(policy.businessModes)).toHaveLength(2);
  });

  it("normalizes malformed or partial stored data fail-closed", () => {
    const policy = normalizeAutonomyPolicy("user-1", {
      version: -4,
      globalKillSwitch: "false",
      businessModes: {
        rt_solutions: "unexpected",
        rosser_gallery: "supervised",
        another_business: "autonomous_safe",
      },
    });

    expect(policy.version).toBe(0);
    expect(policy.globalKillSwitch).toBe(true);
    expect(policy.businessModes).toEqual({
      rt_solutions: "assist",
      rosser_gallery: "supervised",
    });
  });

  it("resolves the most restrictive mode and treats invalid input as assist", () => {
    expect(
      resolveMostRestrictiveAutonomyMode("autonomous_safe", "supervised")
    ).toBe("supervised");
    expect(resolveMostRestrictiveAutonomyMode("autonomous_safe", "assist")).toBe(
      "assist"
    );
    expect(resolveMostRestrictiveAutonomyMode("autonomous_safe", undefined)).toBe(
      "assist"
    );
  });

  it.each(PROTECTED_AUTONOMY_ACTIONS)(
    "never auto-approves protected action %s",
    (action) => {
      const policy = {
        ...createDefaultAutonomyPolicy("user-1"),
        businessModes: {
          rt_solutions: "autonomous_safe" as const,
          rosser_gallery: "autonomous_safe" as const,
        },
      };

      const decision = resolveAutonomyDecision({
        policy,
        businessId: "rt_solutions",
        requestedMode: "autonomous_safe",
        action,
        executionEnvelope: {
          ...VALID_ENVELOPE,
          scope: [AUTONOMY_ACTION_SCOPES[action]],
        },
      });

      expect(decision.outcome).toBe("approval_required");
      expect(decision.canAutoExecute).toBe(false);
      expect(decision.requiresHumanApproval).toBe(true);
      expect(decision.reason).toBe("protected_action");
    }
  );

  it("blocks all actions when either kill switch is active", () => {
    const policy = {
      ...createDefaultAutonomyPolicy("user-1"),
      globalKillSwitch: true,
    };

    expect(
      resolveAutonomyDecision({
        policy,
        businessId: "rt_solutions",
        requestedMode: "autonomous_safe",
        action: "crm_internal_sync",
        executionEnvelope: VALID_ENVELOPE,
      }).reason
    ).toBe("global_kill_switch");

    expect(
      resolveAutonomyDecision({
        policy: { ...policy, globalKillSwitch: false },
        businessId: "rt_solutions",
        requestedMode: "autonomous_safe",
        action: "crm_internal_sync",
        executionEnvelope: VALID_ENVELOPE,
        runtimeGlobalKillSwitch: true,
      }).reason
    ).toBe("global_kill_switch");
  });

  it("requires a trust envelope and only auto-executes safe work at autonomous_safe", () => {
    const policy = {
      ...createDefaultAutonomyPolicy("user-1"),
      businessModes: {
        rt_solutions: "autonomous_safe" as const,
        rosser_gallery: "assist" as const,
      },
    };

    const missingEnvelope = resolveAutonomyDecision({
      policy,
      businessId: "rt_solutions",
      requestedMode: "autonomous_safe",
      action: "crm_internal_sync",
    });
    const allowed = resolveAutonomyDecision({
      policy,
      businessId: "rt_solutions",
      requestedMode: "autonomous_safe",
      action: "crm_internal_sync",
      executionEnvelope: VALID_ENVELOPE,
    });
    const unknownBusiness = resolveAutonomyDecision({
      policy,
      businessId: "unknown",
      requestedMode: "autonomous_safe",
      action: "crm_internal_sync",
      executionEnvelope: VALID_ENVELOPE,
    });
    const unknownAction = resolveAutonomyDecision({
      policy,
      businessId: "rt_solutions",
      requestedMode: "autonomous_safe",
      action: "email_sned",
      executionEnvelope: VALID_ENVELOPE,
    });
    const broadScope = resolveAutonomyDecision({
      policy,
      businessId: "rt_solutions",
      requestedMode: "autonomous_safe",
      action: "crm_internal_sync",
      executionEnvelope: { ...VALID_ENVELOPE, scope: ["crm.*"] },
    });

    expect(missingEnvelope.reason).toBe("invalid_execution_envelope");
    expect(allowed.outcome).toBe("auto_execute");
    expect(allowed.canAutoExecute).toBe(true);
    expect(unknownBusiness.effectiveMode).toBe("assist");
    expect(unknownBusiness.canAutoExecute).toBe(false);
    expect(unknownAction.reason).toBe("unknown_action");
    expect(broadScope.reason).toBe("invalid_execution_envelope");
  });
});
