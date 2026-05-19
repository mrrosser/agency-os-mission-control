import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/agents/actions/route";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { getIdempotencyKey, withIdempotency } from "@/lib/api/idempotency";
import { getAdminDb } from "@/lib/firebase-admin";
import { PaperclipClient, readPaperclipClientConfig } from "@/lib/paperclip/client";

vi.mock("@/lib/api/auth", () => ({
  requireFirebaseAuth: vi.fn(),
}));

vi.mock("@/lib/api/idempotency", () => ({
  getIdempotencyKey: vi.fn(),
  withIdempotency: vi.fn(),
}));

vi.mock("@/lib/firebase-admin", () => ({
  getAdminDb: vi.fn(),
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

const requireAuthMock = vi.mocked(requireFirebaseAuth);
const getIdempotencyKeyMock = vi.mocked(getIdempotencyKey);
const withIdempotencyMock = vi.mocked(withIdempotency);
const getAdminDbMock = vi.mocked(getAdminDb);
const readPaperclipClientConfigMock = vi.mocked(readPaperclipClientConfig);
const PaperclipClientMock = vi.mocked(PaperclipClient);

function createContext() {
  return { params: Promise.resolve({}) };
}

describe("agents actions route", () => {
  const originalEnv = process.env;
  const setMock = vi.fn(async (_data: Record<string, unknown>) => undefined);

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
    setMock.mockReset();
    setMock.mockImplementation(async (_data: Record<string, unknown>) => undefined);
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
    getAdminDbMock.mockReturnValue({
      collection: vi.fn(() => ({
        doc: vi.fn(() => ({
          set: setMock,
        })),
      })),
    } as unknown as ReturnType<typeof getAdminDb>);
  });

  it("queues ping action", async () => {
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

    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.status).toBe("queued");
    expect(data.agentId).toBe("orchestrator");
    expect(data.action).toBe("ping");
    expect(typeof data.requestId).toBe("string");
    expect(setMock).toHaveBeenCalledOnce();
    expect(setMock.mock.calls[0]?.[0]).toMatchObject({
      uid: "user-1",
      agentId: "orchestrator",
      action: "ping",
      status: "queued",
    });
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

  it("forwards resume to Paperclip when proxy is configured", async () => {
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
        action: "resume",
        idempotencyKey: "resume-1",
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
    expect(setMock).not.toHaveBeenCalled();
  });
});
