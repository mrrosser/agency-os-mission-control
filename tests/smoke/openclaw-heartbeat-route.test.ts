import { beforeEach, describe, expect, it, vi } from "vitest";

const { authorizeMock, recordMock } = vi.hoisted(() => ({
  authorizeMock: vi.fn(),
  recordMock: vi.fn(),
}));

vi.mock("@/lib/agents/openclaw-heartbeat", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/agents/openclaw-heartbeat")>();
  return {
    ...actual,
    authorizeOpenClawHeartbeat: authorizeMock,
    recordOpenClawHeartbeat: recordMock,
  };
});

import { POST } from "@/app/api/agents/openclaw-heartbeat/route";
import { ApiError } from "@/lib/api/handler";

function createContext() {
  return { params: Promise.resolve({}) };
}

function validBody() {
  return {
    schema_version: 1,
    runtime_id: "openclaw-gateway",
    heartbeat_id: "openclaw-gateway:boot-a:1786118400000",
    sequence: 1786118400000,
    sent_at: "2026-08-07T16:00:00.000Z",
    source_commit: "a".repeat(40),
    correlation_id: "heartbeat-request-20260807",
    services: {
      openclaw_gateway: "active",
      voice_mcp_rt: "active",
      voice_mcp_rosser: "active",
      voice_mcp_router: "active",
    },
  };
}

describe("OpenClaw heartbeat route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authorizeMock.mockResolvedValue({
      email: "openclaw-gateway@example.iam.gserviceaccount.com",
      subject: "service-account-subject",
    });
    recordMock.mockResolvedValue({ replayed: false, runtimeId: "openclaw-gateway" });
  });

  it("accepts a validated OIDC-authenticated receipt with correlation IDs", async () => {
    const request = new Request("https://agency.example/api/agents/openclaw-heartbeat", {
      method: "POST",
      headers: {
        Authorization: "Bearer google-oidc-token",
        "Content-Type": "application/json",
        "X-Correlation-ID": "request-correlation-20260807",
      },
      body: JSON.stringify(validBody()),
    });

    const response = await POST(
      request as unknown as Parameters<typeof POST>[0],
      createContext() as unknown as Parameters<typeof POST>[1]
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("x-correlation-id")).toBe("request-correlation-20260807");
    expect(payload).toEqual({
      ok: true,
      runtime_id: "openclaw-gateway",
      heartbeat_id: validBody().heartbeat_id,
      replayed: false,
      correlation_id: "request-correlation-20260807",
    });
    expect(recordMock).toHaveBeenCalledWith(
      expect.objectContaining({
        requestCorrelationId: "request-correlation-20260807",
        identity: expect.objectContaining({
          email: "openclaw-gateway@example.iam.gserviceaccount.com",
        }),
      })
    );
  });

  it("fails closed when OIDC authorization rejects the caller", async () => {
    authorizeMock.mockRejectedValue(new ApiError(403, "Invalid Google OIDC token."));
    const request = new Request("https://agency.example/api/agents/openclaw-heartbeat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validBody()),
    });

    const response = await POST(
      request as unknown as Parameters<typeof POST>[0],
      createContext() as unknown as Parameters<typeof POST>[1]
    );

    expect(response.status).toBe(403);
    expect(recordMock).not.toHaveBeenCalled();
  });

  it("rejects malformed service state without writing", async () => {
    const body = validBody();
    body.services.voice_mcp_router = "compromised";
    const request = new Request("https://agency.example/api/agents/openclaw-heartbeat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const response = await POST(
      request as unknown as Parameters<typeof POST>[0],
      createContext() as unknown as Parameters<typeof POST>[1]
    );

    expect(response.status).toBe(400);
    expect(recordMock).not.toHaveBeenCalled();
  });
});
