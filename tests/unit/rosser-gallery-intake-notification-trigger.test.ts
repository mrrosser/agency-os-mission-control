import { describe, expect, it, vi } from "vitest";
import { triggerIntakeNotificationWorker } from "@/lib/crm/rosser-gallery-intake-notification-trigger";

const log = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};
const TOKEN = "worker-token-with-at-least-thirty-two-characters";

describe("intake notification immediate trigger", () => {
  it("stays disabled when no internal worker route is configured", async () => {
    const fetchImpl = vi.fn();
    await expect(
      triggerIntakeNotificationWorker({
        correlationId: "trigger-unit-test-0001",
        log,
        environment: {},
        fetchImpl,
      })
    ).resolves.toBe("disabled");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("calls only the exact protected worker path with no intake PII", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    const result = await triggerIntakeNotificationWorker({
      correlationId: "trigger-unit-test-0002",
      log,
      environment: {
        GALLERY_INTAKE_NOTIFICATION_WORKER_URL:
          "https://mission-control.example.com/api/integrations/rosser-gallery/intake-notifications/worker",
        GALLERY_INTAKE_NOTIFICATION_WORKER_TOKEN: TOKEN,
      },
      fetchImpl,
    });

    expect(result).toBe("triggered");
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toBe(
      "https://mission-control.example.com/api/integrations/rosser-gallery/intake-notifications/worker"
    );
    expect(init).toMatchObject({
      method: "POST",
      headers: {
        authorization: `Bearer ${TOKEN}`,
        "x-correlation-id": "trigger-unit-test-0002",
      },
      body: JSON.stringify({ limit: 10, leaseSeconds: 90 }),
    });
    expect(String(init.body)).not.toContain("email");
    expect(String(init.body)).not.toContain("recipient");
  });

  it("fails closed for an unsafe URL or incomplete token pairing", async () => {
    const fetchImpl = vi.fn();
    for (const environment of [
      {
        GALLERY_INTAKE_NOTIFICATION_WORKER_URL:
          "http://public.example.com/api/integrations/rosser-gallery/intake-notifications/worker",
        GALLERY_INTAKE_NOTIFICATION_WORKER_TOKEN: TOKEN,
      },
      {
        GALLERY_INTAKE_NOTIFICATION_WORKER_URL:
          "https://mission-control.example.com/api/integrations/rosser-gallery/intake-notifications/worker?recipient=someone",
        GALLERY_INTAKE_NOTIFICATION_WORKER_TOKEN: TOKEN,
      },
      { GALLERY_INTAKE_NOTIFICATION_WORKER_TOKEN: TOKEN },
    ]) {
      await expect(
        triggerIntakeNotificationWorker({
          correlationId: "trigger-unit-test-0003",
          log,
          environment,
          fetchImpl,
        })
      ).resolves.toBe("failed");
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
