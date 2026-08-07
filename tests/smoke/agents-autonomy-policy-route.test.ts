import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, PUT } from "@/app/api/agents/autonomy-policy/route";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { getIdempotencyKey, withIdempotency } from "@/lib/api/idempotency";
import {
  getAutonomyPolicy,
  listAutonomyPolicyAudit,
  updateAutonomyPolicy,
} from "@/lib/agents/autonomy-policy-store";
import { createDefaultAutonomyPolicy } from "@/lib/agents/autonomy-policy";

vi.mock("@/lib/api/auth", () => ({
  requireFirebaseAuth: vi.fn(),
}));

vi.mock("@/lib/api/idempotency", () => ({
  getIdempotencyKey: vi.fn(),
  withIdempotency: vi.fn(),
}));

vi.mock("@/lib/agents/autonomy-policy-store", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/lib/agents/autonomy-policy-store")
  >();
  return {
    ...actual,
    getAutonomyPolicy: vi.fn(),
    listAutonomyPolicyAudit: vi.fn(),
    updateAutonomyPolicy: vi.fn(),
  };
});

const requireAuthMock = vi.mocked(requireFirebaseAuth);
const getIdempotencyKeyMock = vi.mocked(getIdempotencyKey);
const withIdempotencyMock = vi.mocked(withIdempotency);
const getPolicyMock = vi.mocked(getAutonomyPolicy);
const listAuditMock = vi.mocked(listAutonomyPolicyAudit);
const updatePolicyMock = vi.mocked(updateAutonomyPolicy);
const originalActionAllowlist = process.env.AGENT_ACTION_ALLOWED_UIDS;
const originalPolicyAllowlist = process.env.AGENT_AUTONOMY_POLICY_ALLOWED_UIDS;

function context() {
  return { params: Promise.resolve({}) };
}

function request(method: "GET" | "PUT", body?: Record<string, unknown>) {
  return new Request("http://localhost/api/agents/autonomy-policy", {
    method,
    headers: { "Content-Type": "application/json", "x-idempotency-key": "policy-1" },
    body: body ? JSON.stringify(body) : undefined,
  });
}

describe("agents autonomy policy route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AGENT_ACTION_ALLOWED_UIDS = "user-1";
    delete process.env.AGENT_AUTONOMY_POLICY_ALLOWED_UIDS;
    requireAuthMock.mockResolvedValue({ uid: "user-1", email: "owner@example.com" } as never);
    getIdempotencyKeyMock.mockReturnValue("policy-1");
    withIdempotencyMock.mockImplementation(async (_params, executor) => ({
      data: await executor(),
      replayed: false,
    }));
    getPolicyMock.mockResolvedValue(createDefaultAutonomyPolicy("user-1"));
    listAuditMock.mockResolvedValue([]);
    updatePolicyMock.mockResolvedValue({
      policy: {
        ...createDefaultAutonomyPolicy("user-1"),
        version: 1,
        businessModes: {
          rt_solutions: "supervised",
          rosser_gallery: "autonomous_safe",
        },
        updatedAt: "2026-08-06T12:00:00.000Z",
        updatedByUid: "user-1",
      },
      auditId: "audit-1",
    });
  });

  afterEach(() => {
    if (originalActionAllowlist === undefined) {
      delete process.env.AGENT_ACTION_ALLOWED_UIDS;
    } else {
      process.env.AGENT_ACTION_ALLOWED_UIDS = originalActionAllowlist;
    }
    if (originalPolicyAllowlist === undefined) {
      delete process.env.AGENT_AUTONOMY_POLICY_ALLOWED_UIDS;
    } else {
      process.env.AGENT_AUTONOMY_POLICY_ALLOWED_UIDS = originalPolicyAllowlist;
    }
  });

  it("returns the fail-closed default and immutable contract", async () => {
    const response = await GET(request("GET") as never, context());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.policy.businessModes).toEqual({
      rt_solutions: "assist",
      rosser_gallery: "assist",
    });
    expect(payload.contract.businesses).toEqual({
      rt_solutions: "RT Solutions",
      rosser_gallery: "Rosser Gallery",
    });
    expect(payload.contract.protectedActions).toContain("payment");
    expect(payload.history).toEqual([]);
  });

  it("updates both business modes with optimistic version and trust envelope", async () => {
    const response = await PUT(
      request("PUT", {
        expectedVersion: 0,
        globalKillSwitch: false,
        businessModes: {
          rt_solutions: "supervised",
          rosser_gallery: "autonomous_safe",
        },
        executionEnvelope: {
          agentId: "mission-control/operator",
          scope: ["agent.autonomy_policy.update"],
          trustLevel: "high",
          evidenceRef: "operator:mobile-settings",
        },
        idempotencyKey: "policy-1",
      }) as never,
      context()
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.policy.version).toBe(1);
    expect(payload.replayed).toBe(false);
    expect(updatePolicyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        uid: "user-1",
        actorUid: "user-1",
        expectedVersion: 0,
        businessModes: {
          rt_solutions: "supervised",
          rosser_gallery: "autonomous_safe",
        },
      })
    );
  });

  it("fails closed when no operator allowlist is configured", async () => {
    delete process.env.AGENT_ACTION_ALLOWED_UIDS;
    delete process.env.AGENT_AUTONOMY_POLICY_ALLOWED_UIDS;

    const response = await GET(request("GET") as never, context());
    expect(response.status).toBe(403);
    expect(getPolicyMock).not.toHaveBeenCalled();
  });

  it("uses the intersection when both operator allowlists are configured", async () => {
    process.env.AGENT_AUTONOMY_POLICY_ALLOWED_UIDS = "another-operator";

    const response = await GET(request("GET") as never, context());
    expect(response.status).toBe(403);
  });

  it("rejects extra businesses and incomplete trust envelopes", async () => {
    const response = await PUT(
      request("PUT", {
        expectedVersion: 0,
        globalKillSwitch: false,
        businessModes: {
          rt_solutions: "assist",
          rosser_gallery: "assist",
          another_business: "autonomous_safe",
        },
        executionEnvelope: {
          agentId: "mission-control/operator",
          scope: ["agent.autonomy_policy.update"],
          trustLevel: "high",
        },
      }) as never,
      context()
    );

    expect(response.status).toBe(400);
    expect(updatePolicyMock).not.toHaveBeenCalled();
  });
});
