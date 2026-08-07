import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/agents/actions/route";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { getIdempotencyKey, withIdempotency } from "@/lib/api/idempotency";
import { PaperclipClient, readPaperclipClientConfig } from "@/lib/paperclip/client";
import { getAutonomyPolicy } from "@/lib/agents/autonomy-policy-store";
import { createDefaultAutonomyPolicy } from "@/lib/agents/autonomy-policy";

vi.mock("@/lib/api/auth", () => ({
  requireFirebaseAuth: vi.fn(),
}));

vi.mock("@/lib/api/idempotency", () => ({
  getIdempotencyKey: vi.fn(),
  withIdempotency: vi.fn(),
}));

vi.mock("@/lib/paperclip/client", () => ({
  readPaperclipClientConfig: vi.fn(),
  PaperclipClient: vi.fn(),
  PaperclipClientError: class PaperclipClientError extends Error {
    status: number;
    constructor(message: string, status: number = 500) {
      super(message);
      this.status = status;
    }
  },
}));

vi.mock("@/lib/agents/autonomy-policy-store", () => ({
  getAutonomyPolicy: vi.fn(),
}));

const requireAuthMock = vi.mocked(requireFirebaseAuth);
const getIdempotencyKeyMock = vi.mocked(getIdempotencyKey);
const withIdempotencyMock = vi.mocked(withIdempotency);
const readPaperclipClientConfigMock = vi.mocked(readPaperclipClientConfig);
const PaperclipClientMock = vi.mocked(PaperclipClient);
const getAutonomyPolicyMock = vi.mocked(getAutonomyPolicy);

function createContext() {
  return { params: Promise.resolve({}) };
}

describe("agents actions route", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
    process.env.AGENT_ACTION_ALLOWED_UIDS = "user-1";
    getAutonomyPolicyMock.mockResolvedValue(createDefaultAutonomyPolicy("user-1"));
    requireAuthMock.mockResolvedValue({ uid: "user-1" } as unknown as Awaited<ReturnType<typeof requireFirebaseAuth>>);
    getIdempotencyKeyMock.mockReturnValue("idempotency-1");
    withIdempotencyMock.mockImplementation(async (_params, executor) => ({
      data: await executor(),
      replayed: false,
    }));
    readPaperclipClientConfigMock.mockReturnValue(null);
    PaperclipClientMock.mockImplementation(
      () =>
        ({
          invokeLifecycleAction: vi.fn(async () => ({
            ok: true,
            status: 200,
            detail: "forwarded",
            payload: { ok: true },
          })),
        }) as never
    );
  });

  it("fails visibly when ping has no configured executor", async () => {
    const req = new Request("http://localhost/api/agents/actions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agentId: "orchestrator",
        action: "ping",
        idempotencyKey: "idempotency-1",
      }),
    });

    const res = await POST(
      req as unknown as Parameters<typeof POST>[0],
      createContext() as unknown as Parameters<typeof POST>[1]
    );
    const data = await res.json();

    expect(res.status).toBe(503);
    expect(data.error).toBe("No executor configured for agent action 'ping'");
  });

  it("rejects route action without target", async () => {
    const req = new Request("http://localhost/api/agents/actions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agentId: "fn-actions",
        action: "route",
      }),
    });

    const res = await POST(
      req as unknown as Parameters<typeof POST>[0],
      createContext() as unknown as Parameters<typeof POST>[1]
    );
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(String(data.error || "")).toContain("Invalid payload");
  });

  it("fails visibly when route has no configured executor", async () => {
    const req = new Request("http://localhost/api/agents/actions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agentId: "fn-actions",
        action: "route",
        target: "orchestrator",
      }),
    });

    const res = await POST(
      req as unknown as Parameters<typeof POST>[0],
      createContext() as unknown as Parameters<typeof POST>[1]
    );
    const data = await res.json();

    expect(res.status).toBe(503);
    expect(data.error).toBe("No executor configured for agent action 'route'");
  });

  it("rejects an unknown agent target", async () => {
    const req = new Request("http://localhost/api/agents/actions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agentId: "arbitrary-agent",
        action: "ping",
      }),
    });

    const res = await POST(
      req as unknown as Parameters<typeof POST>[0],
      createContext() as unknown as Parameters<typeof POST>[1]
    );
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toBe("Unknown agentId");
  });

  it("enforces allowlist when AGENT_ACTION_ALLOWED_UIDS is set", async () => {
    process.env.AGENT_ACTION_ALLOWED_UIDS = "admin-1,admin-2";

    const req = new Request("http://localhost/api/agents/actions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agentId: "orchestrator",
        action: "pause",
      }),
    });

    const res = await POST(
      req as unknown as Parameters<typeof POST>[0],
      createContext() as unknown as Parameters<typeof POST>[1]
    );
    const data = await res.json();

    expect(res.status).toBe(403);
    expect(data.error).toBe("Forbidden");
  });

  it("fails closed when AGENT_ACTION_ALLOWED_UIDS is missing", async () => {
    delete process.env.AGENT_ACTION_ALLOWED_UIDS;

    const req = new Request("http://localhost/api/agents/actions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agentId: "orchestrator",
        action: "ping",
      }),
    });

    const res = await POST(
      req as unknown as Parameters<typeof POST>[0],
      createContext() as unknown as Parameters<typeof POST>[1]
    );
    const data = await res.json();

    expect(res.status).toBe(403);
    expect(data.error).toBe("Forbidden");
  });

  it.each(["pause", "resume"] as const)(
    "forwards %s to Paperclip when proxy is configured",
    async (action) => {
      readPaperclipClientConfigMock.mockReturnValue({
        baseUrl: "https://paperclip.example/system",
        serviceToken: "secret",
        timeoutMs: 1000,
        defaultCompanyId: "company-1",
        healthPath: "/api/health",
        companiesPath: "/api/companies",
        agentsPath: "/api/agents",
        activeRunsPath: "/api/runs?state=active",
        actionPathTemplate: "/api/agents/{agentId}/{action}",
        customerRecordsPath: "/api/customers",
        customerTimelinePathTemplate: "/api/customers/{customerId}/timeline",
        customerUpdatePathTemplate: "/api/customers/{customerId}",
      });

      const req = new Request("http://localhost/api/agents/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentId: "orchestrator",
          action,
          idempotencyKey: `${action}-1`,
        }),
      });

      const res = await POST(
        req as unknown as Parameters<typeof POST>[0],
        createContext() as unknown as Parameters<typeof POST>[1]
      );
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.status).toBe("forwarded");
      expect(data.proxied).toBe(true);
    }
  );

  it("blocks execution-starting actions while allowing emergency shutdown", async () => {
    getAutonomyPolicyMock.mockResolvedValue({
      ...createDefaultAutonomyPolicy("user-1"),
      globalKillSwitch: true,
    });

    const resume = new Request("http://localhost/api/agents/actions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId: "orchestrator", action: "resume" }),
    });
    const resumeResponse = await POST(
      resume as unknown as Parameters<typeof POST>[0],
      createContext() as unknown as Parameters<typeof POST>[1]
    );
    expect(resumeResponse.status).toBe(423);

    readPaperclipClientConfigMock.mockReturnValue({
      baseUrl: "https://paperclip.example/system",
      serviceToken: "test-token",
      timeoutMs: 1000,
      defaultCompanyId: "company-1",
      healthPath: "/api/health",
      companiesPath: "/api/companies",
      agentsPath: "/api/agents",
      activeRunsPath: "/api/runs?state=active",
      actionPathTemplate: "/api/agents/{agentId}/{action}",
      customerRecordsPath: "/api/customers",
      customerTimelinePathTemplate: "/api/customers/{customerId}/timeline",
      customerUpdatePathTemplate: "/api/customers/{customerId}",
    });
    const terminate = new Request("http://localhost/api/agents/actions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId: "orchestrator", action: "terminate" }),
    });
    const terminateResponse = await POST(
      terminate as unknown as Parameters<typeof POST>[0],
      createContext() as unknown as Parameters<typeof POST>[1]
    );
    expect(terminateResponse.status).toBe(200);
  });
});
