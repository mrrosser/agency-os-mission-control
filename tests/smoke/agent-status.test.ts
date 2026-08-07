import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/agents/status/route";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { withIdempotency } from "@/lib/api/idempotency";
import { getAgentSpaceStatus, setAgentSpaceStatus } from "@/lib/agent-status";
import { resolveLeadRunOrgId } from "@/lib/lead-runs/quotas";
import { AGENT_PROTOCOL_POLICY_VERSION, AGENT_SPACE_IDS } from "@/lib/agents/registry";

vi.mock("@/lib/api/auth", () => ({ requireFirebaseAuth: vi.fn() }));
vi.mock("@/lib/api/idempotency", () => ({ withIdempotency: vi.fn() }));
vi.mock("@/lib/agent-status", () => ({
  getAgentSpaceStatus: vi.fn(),
  setAgentSpaceStatus: vi.fn(),
}));
vi.mock("@/lib/lead-runs/quotas", () => ({ resolveLeadRunOrgId: vi.fn() }));

const requireAuthMock = vi.mocked(requireFirebaseAuth);
const withIdempotencyMock = vi.mocked(withIdempotency);
const getStatusMock = vi.mocked(getAgentSpaceStatus);
const setStatusMock = vi.mocked(setAgentSpaceStatus);
const resolveOrgMock = vi.mocked(resolveLeadRunOrgId);

function context() {
  return { params: Promise.resolve({}) };
}

function heartbeat(overrides: Record<string, unknown> = {}) {
  return {
    agent_id: "opportunity-scout",
    org_id: "org-1",
    business_id: "rt_solutions",
    space_id: AGENT_SPACE_IDS.research,
    scope: ["opportunities"],
    trust_level: "read_only",
    evidence_ref: "drive:source-1",
    run_id: "run-1",
    correlation_id: "envelope-correlation-1",
    idempotency_key: "heartbeat-1",
    policy_version: AGENT_PROTOCOL_POLICY_VERSION,
    timestamp: new Date().toISOString(),
    capabilities: ["research.search", "opportunity.discover"],
    state: "active",
    ...overrides,
  };
}

describe("agent status route", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    requireAuthMock.mockResolvedValue({
      uid: "user-1",
      business_ids: ["rt_solutions"],
    } as unknown as Awaited<ReturnType<typeof requireFirebaseAuth>>);
    resolveOrgMock.mockResolvedValue("org-1");
    getStatusMock.mockResolvedValue({});
    setStatusMock.mockResolvedValue(undefined);
    withIdempotencyMock.mockImplementation(async (_params, executor) => ({
      data: await executor(),
      replayed: false,
    }));
  });

  it("returns only the caller-scoped registry and status", async () => {
    const response = await GET(
      new Request("http://localhost/api/agents/status") as Parameters<typeof GET>[0],
      context()
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.org_id).toBe("org-1");
    expect(payload.business_ids).toEqual(["rt_solutions"]);
    expect(payload.policy.some((agent: { agent_id: string }) => agent.agent_id === "opportunity-scout")).toBe(true);
    expect(getStatusMock).toHaveBeenCalledWith(
      "user-1",
      { orgId: "org-1", businessIds: ["rt_solutions"] },
      expect.anything()
    );
  });

  it("accepts an authorized idempotent heartbeat", async () => {
    const response = await POST(
      new Request("http://localhost/api/agents/status", {
        method: "POST",
        headers: { "content-type": "application/json", "x-correlation-id": "request-correlation-1" },
        body: JSON.stringify(heartbeat()),
      }) as Parameters<typeof POST>[0],
      context()
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      ok: true,
      agent_id: "opportunity-scout",
      org_id: "org-1",
      business_id: "rt_solutions",
      replayed: false,
      correlation_id: "request-correlation-1",
    });
    expect(withIdempotencyMock).toHaveBeenCalledWith(
      expect.objectContaining({ key: "heartbeat-1", route: "agents.status.update" }),
      expect.any(Function)
    );
    expect(setStatusMock).toHaveBeenCalledOnce();
  });

  it("rejects an arbitrary agent without writing", async () => {
    const response = await POST(
      new Request("http://localhost/api/agents/status", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(heartbeat({ agent_id: "arbitrary-admin-agent" })),
      }) as Parameters<typeof POST>[0],
      context()
    );
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.details?.reason).toBe("unknown_agent");
    expect(setStatusMock).not.toHaveBeenCalled();
  });

  it("rejects a heartbeat for another org", async () => {
    const response = await POST(
      new Request("http://localhost/api/agents/status", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(heartbeat({ org_id: "org-2" })),
      }) as Parameters<typeof POST>[0],
      context()
    );

    expect(response.status).toBe(403);
    expect(setStatusMock).not.toHaveBeenCalled();
  });
});
