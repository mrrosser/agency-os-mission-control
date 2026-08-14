import { describe, expect, it } from "vitest";
import {
  ACTION_EXECUTOR_AGENT_ID,
  AGENT_PROTOCOL_POLICY_VERSION,
  AGENT_REGISTRY,
  AGENT_SPACE_IDS,
  AgentHeartbeatEnvelopeSchema,
  authorizeAgentHeartbeat,
  isConsequentialExternalCapability,
  resolveAgentDefinition,
  resolveCallerBusinessIds,
} from "@/lib/agents/registry";

function heartbeat(overrides: Record<string, unknown> = {}) {
  return AgentHeartbeatEnvelopeSchema.parse({
    agent_id: "opportunity-scout",
    org_id: "org-1",
    business_id: "rt_solutions",
    space_id: AGENT_SPACE_IDS.research,
    scope: ["opportunities"],
    trust_level: "read_only",
    evidence_ref: "drive:opportunity-source-1",
    run_id: "run-1",
    correlation_id: "correlation-1",
    idempotency_key: "heartbeat-1",
    policy_version: AGENT_PROTOCOL_POLICY_VERSION,
    timestamp: "2026-08-06T15:00:00.000Z",
    capabilities: ["research.search", "opportunity.discover"],
    state: "active",
    ...overrides,
  });
}

describe("canonical agent registry", () => {
  it("contains the five bounded specialists and only one external-write executor", () => {
    expect(
      AGENT_REGISTRY.map((agent) => agent.id)
    ).toEqual(
      expect.arrayContaining([
        "opportunity-scout",
        "qualification-verifier",
        "application-drafter",
        "meeting-outreach-prep",
        "crm-reconciler",
      ])
    );

    const consequentialAgents = AGENT_REGISTRY.filter((agent) =>
      agent.capabilities.some(isConsequentialExternalCapability)
    );
    expect(consequentialAgents.map((agent) => agent.id)).toEqual([ACTION_EXECUTOR_AGENT_ID]);
  });

  it("canonicalizes declared aliases", () => {
    expect(resolveAgentDefinition("coding")?.id).toBe("orchestrator");
    expect(resolveAgentDefinition("opportunity_scout")?.id).toBe("opportunity-scout");
    expect(resolveAgentDefinition("made-up-agent")).toBeNull();
    expect(resolveAgentDefinition("biz-aicf")).toBeNull();
  });

  it("authorizes a fresh heartbeat in the caller org context", () => {
    const result = authorizeAgentHeartbeat(
      heartbeat(),
      { orgId: "org-1", businessIds: ["rt_solutions"] },
      { nowMs: Date.parse("2026-08-06T15:01:00.000Z") }
    );

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.envelope.agent_id).toBe("opportunity-scout");
  });

  it.each([
    ["unknown agent", { agent_id: "unknown-agent" }, "unknown_agent"],
    ["unknown space", { space_id: "spaces/UNKNOWN" }, "unknown_space"],
    ["other org", { org_id: "org-2" }, "org_context_mismatch"],
    ["other business", { business_id: "rosser_nft_gallery" }, "business_context_forbidden"],
    ["forbidden scope", { scope: ["actions"] }, "scope_forbidden"],
    ["forbidden capability", { capabilities: ["external.email.send"] }, "capability_forbidden"],
    ["wrong trust", { trust_level: "bounded_internal" }, "trust_level_mismatch"],
  ])("rejects %s fail-closed", (_label, overrides, reason) => {
    const result = authorizeAgentHeartbeat(
      heartbeat(overrides as Record<string, unknown>),
      { orgId: "org-1", businessIds: ["rt_solutions"] },
      { nowMs: Date.parse("2026-08-06T15:01:00.000Z") }
    );
    expect(result).toEqual({ ok: false, reason });
  });

  it("rejects stale envelopes", () => {
    const result = authorizeAgentHeartbeat(
      heartbeat(),
      { orgId: "org-1", businessIds: ["rt_solutions"] },
      { nowMs: Date.parse("2026-08-06T15:20:01.000Z") }
    );
    expect(result).toEqual({ ok: false, reason: "stale_timestamp" });
  });

  it("uses explicit business claims fail-closed and preserves the org-wide default", () => {
    expect(resolveCallerBusinessIds({})).toEqual([
      "rosser_nft_gallery",
      "rt_solutions",
    ]);
    expect(resolveCallerBusinessIds({ business_ids: ["rt_solutions", "unknown"] })).toEqual([
      "rt_solutions",
    ]);
    expect(resolveCallerBusinessIds({ business_ids: "unknown" })).toEqual([]);
    expect(resolveCallerBusinessIds({ business_ids: "ai_cofoundry" })).toEqual([]);
  });
});
