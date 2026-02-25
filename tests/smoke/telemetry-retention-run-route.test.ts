import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/telemetry/retention-run/route";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { getIdempotencyKey, withIdempotency } from "@/lib/api/idempotency";

vi.mock("@/lib/api/auth", () => ({
  requireFirebaseAuth: vi.fn(),
}));

vi.mock("@/lib/api/idempotency", () => ({
  getIdempotencyKey: vi.fn(),
  withIdempotency: vi.fn(),
}));

const requireAuthMock = vi.mocked(requireFirebaseAuth);
const getIdempotencyKeyMock = vi.mocked(getIdempotencyKey);
const withIdempotencyMock = vi.mocked(withIdempotency);

function createContext() {
  return { params: Promise.resolve({}) };
}

describe("telemetry retention run route", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
    requireAuthMock.mockResolvedValue({ uid: "user-1" } as unknown as Awaited<ReturnType<typeof requireFirebaseAuth>>);
    getIdempotencyKeyMock.mockReturnValue("idempotency-1");
    withIdempotencyMock.mockImplementation(async (_params, executor) => ({
      data: await executor(),
      replayed: false,
    }));
    vi.stubGlobal("fetch", vi.fn());
  });

  it("dispatches telemetry cleanup workflow", async () => {
    process.env.GITHUB_WORKFLOW_DISPATCH_TOKEN = "token-1";
    process.env.GITHUB_WORKFLOW_OWNER = "mrrosser";
    process.env.GITHUB_WORKFLOW_REPO = "agency-os-mission-control";
    process.env.GITHUB_TELEMETRY_RETENTION_WORKFLOW = "telemetry-retention-cleanup.yml";
    process.env.GITHUB_TELEMETRY_RETENTION_REF = "main";

    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

    const req = new Request("http://localhost/api/telemetry/retention-run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        dryRun: true,
        eventRetentionDays: 30,
        groupRetentionDays: 180,
        idempotencyKey: "idempotency-1",
      }),
    });
    const res = await POST(
      req as unknown as Parameters<typeof POST>[0],
      createContext() as unknown as Parameters<typeof POST>[1]
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.dispatchRequested).toBe(true);
    expect(data.replayed).toBe(false);
    expect(data.dryRun).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [dispatchUrl, dispatchInit] = fetchMock.mock.calls[0];
    expect(String(dispatchUrl)).toContain(
      "/repos/mrrosser/agency-os-mission-control/actions/workflows/telemetry-retention-cleanup.yml/dispatches"
    );
    expect(dispatchInit?.method).toBe("POST");
    const dispatchBody = JSON.parse(String(dispatchInit?.body));
    expect(dispatchBody.ref).toBe("main");
    expect(dispatchBody.inputs.dry_run).toBe("true");
    expect(dispatchBody.inputs.event_retention_days).toBe("30");
    expect(dispatchBody.inputs.group_retention_days).toBe("180");
  });

  it("blocks uid when allowlist is configured", async () => {
    process.env.GITHUB_WORKFLOW_DISPATCH_TOKEN = "token-1";
    process.env.TELEMETRY_CLEANUP_ALLOWED_UIDS = "admin-1,admin-2";

    const req = new Request("http://localhost/api/telemetry/retention-run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dryRun: true }),
    });
    const res = await POST(
      req as unknown as Parameters<typeof POST>[0],
      createContext() as unknown as Parameters<typeof POST>[1]
    );
    const data = await res.json();

    expect(res.status).toBe(403);
    expect(data.error).toBe("Forbidden");
  });

  it("returns 503 when dispatch token is missing", async () => {
    delete process.env.GITHUB_WORKFLOW_DISPATCH_TOKEN;
    process.env.GITHUB_WORKFLOW_OWNER = "mrrosser";
    process.env.GITHUB_WORKFLOW_REPO = "agency-os-mission-control";

    const req = new Request("http://localhost/api/telemetry/retention-run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dryRun: true }),
    });
    const res = await POST(
      req as unknown as Parameters<typeof POST>[0],
      createContext() as unknown as Parameters<typeof POST>[1]
    );
    const data = await res.json();

    expect(res.status).toBe(503);
    expect(String(data.error || "")).toContain("dispatch token");
  });
});
