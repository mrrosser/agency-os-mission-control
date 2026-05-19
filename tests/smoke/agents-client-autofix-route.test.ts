import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/agents/client-autofix/route";
import { GET as GET_RUN } from "@/app/api/agents/client-autofix/[runId]/route";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { withIdempotency } from "@/lib/api/idempotency";
import {
  getClientAutofixRun,
  listClientAutofixRuns,
  queueClientAutofixRun,
  type ClientAutofixRun,
} from "@/lib/client-autofix";

vi.mock("@/lib/api/auth", () => ({
  requireFirebaseAuth: vi.fn(),
}));

vi.mock("@/lib/api/idempotency", () => ({
  withIdempotency: vi.fn(),
}));

vi.mock("@/lib/client-autofix", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/client-autofix")>();
  return {
    ...actual,
    queueClientAutofixRun: vi.fn(),
    listClientAutofixRuns: vi.fn(),
    getClientAutofixRun: vi.fn(),
  };
});

const requireAuthMock = vi.mocked(requireFirebaseAuth);
const withIdempotencyMock = vi.mocked(withIdempotency);
const queueClientAutofixRunMock = vi.mocked(queueClientAutofixRun);
const listClientAutofixRunsMock = vi.mocked(listClientAutofixRuns);
const getClientAutofixRunMock = vi.mocked(getClientAutofixRun);

function createContext(params: Record<string, string> = {}) {
  return { params: Promise.resolve(params) };
}

function makeRun(overrides: Partial<ClientAutofixRun> = {}): ClientAutofixRun {
  return {
    run_id: "run-1",
    client_id: "fortifyy_roofs",
    project_id: "socialops",
    repo_id: "smauto",
    trigger_source: "client_email",
    issue_summary: "Approval link is broken.",
    autonomy_mode: "full_autopilot_client_projects",
    status: "push_blocked_missing_remote",
    branch: "codex/client-autofix-socialops-fortifyy-roofs",
    pr_url: null,
    deploy_target: "production",
    evidence_bundle: {
      test_results: [],
      route_checks: [],
      playwright_screenshots: [],
      playwright_traces: [],
    },
    client_followup_status: "held_until_verified",
    sub_agent_plan: [
      {
        role: "verifier-browser",
        status: "queued",
        task: "Run repo verifiers plus Playwright/Chrome route checks and attach screenshots/traces.",
      },
    ],
    blockers: ["GitHub remote is not configured; local patch/test may run but push/PR is blocked."],
    created_at: "2026-05-18T12:00:00.000Z",
    updated_at: "2026-05-18T12:00:00.000Z",
    correlation_id: "corr-1",
    requested_by_uid: "user-1",
    ...overrides,
  };
}

describe("agents client-autofix routes", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    requireAuthMock.mockResolvedValue({ uid: "user-1" } as Awaited<ReturnType<typeof requireFirebaseAuth>>);
    withIdempotencyMock.mockImplementation(async (_params, executor) => ({
      data: await executor(),
      replayed: false,
    }));
    queueClientAutofixRunMock.mockResolvedValue(makeRun());
    listClientAutofixRunsMock.mockResolvedValue([makeRun()]);
    getClientAutofixRunMock.mockResolvedValue(makeRun({ run_id: "run-2", status: "verified" }));
  });

  it("queues a client autofix run", async () => {
    const request = new Request("http://localhost/api/agents/client-autofix", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: "fortifyy_roofs",
        project_id: "socialops",
        repo_id: "smauto",
        trigger_source: "client_email",
        issue_summary: "Beth says the review link shows no pending approvals.",
        deploy_target: "production",
      }),
    });

    const response = await POST(
      request as unknown as Parameters<typeof POST>[0],
      createContext() as unknown as Parameters<typeof POST>[1]
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.status).toBe("push_blocked_missing_remote");
    expect(payload.run.client_id).toBe("fortifyy_roofs");
    expect(queueClientAutofixRunMock).toHaveBeenCalledOnce();
  });

  it("returns client autofix history", async () => {
    const request = new Request("http://localhost/api/agents/client-autofix?limit=5", {
      method: "GET",
    });

    const response = await GET(
      request as unknown as Parameters<typeof GET>[0],
      createContext() as unknown as Parameters<typeof GET>[1]
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.status).toBe("ok");
    expect(payload.runs).toHaveLength(1);
    expect(listClientAutofixRunsMock).toHaveBeenCalledWith(5);
  });

  it("returns one client autofix run by id", async () => {
    const request = new Request("http://localhost/api/agents/client-autofix/run-2", {
      method: "GET",
    });

    const response = await GET_RUN(
      request as unknown as Parameters<typeof GET_RUN>[0],
      createContext({ runId: "run-2" }) as unknown as Parameters<typeof GET_RUN>[1]
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.status).toBe("ok");
    expect(payload.run.status).toBe("verified");
    expect(getClientAutofixRunMock).toHaveBeenCalledWith("run-2");
  });

  it("returns 404 for a missing run", async () => {
    getClientAutofixRunMock.mockResolvedValueOnce(null);
    const request = new Request("http://localhost/api/agents/client-autofix/missing", {
      method: "GET",
    });

    const response = await GET_RUN(
      request as unknown as Parameters<typeof GET_RUN>[0],
      createContext({ runId: "missing" }) as unknown as Parameters<typeof GET_RUN>[1]
    );
    const payload = await response.json();

    expect(response.status).toBe(404);
    expect(payload.error).toBe("Client autofix run not found");
  });
});
