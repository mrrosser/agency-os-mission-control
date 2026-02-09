import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/telemetry/error/route";
import { storeTelemetryErrorEvent } from "@/lib/telemetry/store";

vi.mock("@/lib/telemetry/store", () => ({
  storeTelemetryErrorEvent: vi.fn(),
}));

const storeMock = vi.mocked(storeTelemetryErrorEvent);

function createContext() {
  return { params: Promise.resolve({}) };
}

describe("telemetry error ingest", () => {
  beforeEach(() => {
    storeMock.mockReset();
    storeMock.mockResolvedValue({ replayed: false });
  });

  it("accepts valid payload and returns fingerprint", async () => {
    const payload = {
      eventId: crypto.randomUUID(),
      kind: "client",
      message: "Expected JSON but got text/plain",
      stack: "Error: Expected JSON\n  at readApiJson",
      route: "/dashboard/inbox",
      url: "https://leadflow-review.web.app/dashboard/inbox",
      userAgent: "vitest",
      occurredAt: new Date().toISOString(),
    };

    const req = new Request("http://localhost/api/telemetry/error", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const res = await POST(
      req as unknown as Parameters<typeof POST>[0],
      createContext() as unknown as Parameters<typeof POST>[1]
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(typeof data.fingerprint).toBe("string");
    expect(data.fingerprint.length).toBeGreaterThan(10);
    expect(data.eventId).toBe(payload.eventId);
    expect(storeMock).toHaveBeenCalledOnce();
  });
});

