import { beforeEach, describe, expect, it, vi } from "vitest";
import { getAgentSpaceStatus, setAgentSpaceStatus } from "@/lib/agent-status";
import { getAdminDb } from "@/lib/firebase-admin";
import {
  AGENT_PROTOCOL_POLICY_VERSION,
  AGENT_SPACE_IDS,
  AgentHeartbeatEnvelopeSchema,
} from "@/lib/agents/registry";

vi.mock("@/lib/firebase-admin", () => ({ getAdminDb: vi.fn() }));

const getAdminDbMock = vi.mocked(getAdminDb);

function storedHeartbeat() {
  return {
    agentId: "opportunity-scout",
    orgId: "org-1",
    businessId: "rt_solutions",
    scope: ["opportunities"],
    trustLevel: "read_only",
    evidenceRef: "drive:source-1",
    runId: "run-1",
    correlationId: "correlation-1",
    idempotencyKey: "heartbeat-1",
    policyVersion: AGENT_PROTOCOL_POLICY_VERSION,
    timestamp: "2026-08-06T15:00:00.000Z",
    capabilities: ["research.search", "opportunity.discover"],
    state: "active",
    updatedAt: { seconds: 1786028400 },
  };
}

describe("agent status storage", () => {
  beforeEach(() => getAdminDbMock.mockReset());

  it("returns only registry-valid records in the caller context", async () => {
    getAdminDbMock.mockReturnValue({
      collection: () => ({
        doc: () => ({
          get: async () => ({
            data: () => ({
              spaces: {
                [AGENT_SPACE_IDS.research]: storedHeartbeat(),
                "spaces/UNKNOWN": { ...storedHeartbeat(), agentId: "unknown" },
              },
            }),
          }),
        }),
      }),
    } as unknown as ReturnType<typeof getAdminDb>);

    const result = await getAgentSpaceStatus("user-1", {
      orgId: "org-1",
      businessIds: ["rt_solutions"],
    });
    expect(Object.keys(result)).toEqual([AGENT_SPACE_IDS.research]);
    expect(result[AGENT_SPACE_IDS.research]).toMatchObject({
      agentId: "opportunity-scout",
      orgId: "org-1",
      businessId: "rt_solutions",
    });
    expect(result[AGENT_SPACE_IDS.research]?.updatedAt).toMatch(/T/);
  });

  it("filters records from another org", async () => {
    getAdminDbMock.mockReturnValue({
      collection: () => ({
        doc: () => ({
          get: async () => ({
            data: () => ({ spaces: { [AGENT_SPACE_IDS.research]: storedHeartbeat() } }),
          }),
        }),
      }),
    } as unknown as ReturnType<typeof getAdminDb>);

    const result = await getAgentSpaceStatus("user-1", {
      orgId: "org-2",
      businessIds: ["rt_solutions"],
    });
    expect(result).toEqual({});
  });

  it("returns an empty object when no document exists", async () => {
    getAdminDbMock.mockReturnValue({
      collection: () => ({ doc: () => ({ get: async () => ({ data: () => undefined }) }) }),
    } as unknown as ReturnType<typeof getAdminDb>);

    await expect(
      getAgentSpaceStatus("user-1", { orgId: "org-1", businessIds: ["rt_solutions"] })
    ).resolves.toEqual({});
  });

  it("stores the complete trust envelope", async () => {
    const set = vi.fn(async (_data: Record<string, unknown>) => undefined);
    getAdminDbMock.mockReturnValue({
      collection: () => ({ doc: () => ({ set }) }),
    } as unknown as ReturnType<typeof getAdminDb>);
    const envelope = AgentHeartbeatEnvelopeSchema.parse({
      agent_id: "opportunity-scout",
      org_id: "org-1",
      business_id: "rt_solutions",
      space_id: AGENT_SPACE_IDS.research,
      scope: ["opportunities"],
      trust_level: "read_only",
      evidence_ref: "drive:source-1",
      run_id: "run-1",
      correlation_id: "correlation-1",
      idempotency_key: "heartbeat-1",
      policy_version: AGENT_PROTOCOL_POLICY_VERSION,
      timestamp: new Date().toISOString(),
      capabilities: ["research.search", "opportunity.discover"],
    });

    await setAgentSpaceStatus("user-1", envelope);
    expect(set).toHaveBeenCalledOnce();
    expect(set.mock.calls[0]?.[0]).toMatchObject({
      spaces: {
        [AGENT_SPACE_IDS.research]: {
          agentId: "opportunity-scout",
          orgId: "org-1",
          businessId: "rt_solutions",
          idempotencyKey: "heartbeat-1",
          policyVersion: AGENT_PROTOCOL_POLICY_VERSION,
        },
      },
    });
  });
});
