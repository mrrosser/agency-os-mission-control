import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/integrations/rosser-gallery/intake-notifications/worker/route";
import { runIntakeNotificationWorkerCycle } from "@/lib/crm/rosser-gallery-intake-notification-worker";

vi.mock("@/lib/crm/rosser-gallery-intake-notification-worker", () => ({
  runIntakeNotificationWorkerCycle: vi.fn(),
}));

const workerMock = vi.mocked(runIntakeNotificationWorkerCycle);
const TOKEN = "worker-token-with-at-least-thirty-two-characters";

function context() {
  return { params: Promise.resolve({}) };
}

async function invoke(args?: {
  token?: string;
  body?: Record<string, unknown>;
}) {
  const request = new Request(
    "http://localhost/api/integrations/rosser-gallery/intake-notifications/worker",
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${args?.token ?? TOKEN}`,
        "content-type": "application/json",
        "x-correlation-id": "worker-route-smoke-0001",
      },
      body: JSON.stringify(args?.body || { limit: 10, leaseSeconds: 90 }),
    }
  );
  return POST(
    request as unknown as Parameters<typeof POST>[0],
    context() as unknown as Parameters<typeof POST>[1]
  );
}

describe("intake notification worker route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("GALLERY_INTAKE_GMAIL_USER_ID", "owner-uid");
    vi.stubEnv("GALLERY_INTAKE_NOTIFICATION_WORKER_TOKEN", TOKEN);
    vi.stubEnv("TELEMETRY_SERVER_ERRORS", "false");
    workerMock.mockResolvedValue({
      candidates: 2,
      claimed: 2,
      sent: 2,
      recovered: 0,
      retried: 0,
      deadLettered: 0,
      skipped: 0,
      failed: 0,
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("fails closed when configuration or bearer auth is missing", async () => {
    expect((await invoke({ token: "wrong-token" })).status).toBe(403);
    expect(workerMock).not.toHaveBeenCalled();

    vi.stubEnv("GALLERY_INTAKE_GMAIL_USER_ID", "");
    expect((await invoke()).status).toBe(503);
    expect(workerMock).not.toHaveBeenCalled();
  });

  it("rejects unknown controls so callers cannot choose recipients or templates", async () => {
    const response = await invoke({
      body: {
        limit: 10,
        recipient: "attacker@example.com",
        template: "arbitrary",
      },
    });
    expect(response.status).toBe(400);
    expect(workerMock).not.toHaveBeenCalled();
  });

  it("runs a bounded cycle and returns only aggregate delivery state", async () => {
    const response = await invoke({ body: { limit: 2, leaseSeconds: 60 } });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      ok: true,
      candidates: 2,
      claimed: 2,
      sent: 2,
      recovered: 0,
      retried: 0,
      deadLettered: 0,
      skipped: 0,
      failed: 0,
      correlationId: "worker-route-smoke-0001",
    });
    expect(workerMock).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({ gmailUserId: "owner-uid" }),
        correlationId: "worker-route-smoke-0001",
        limit: 2,
        leaseSeconds: 60,
      })
    );
  });
});
