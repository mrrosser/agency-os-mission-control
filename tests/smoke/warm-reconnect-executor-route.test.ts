import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/jobs/warm-reconnect/route";
import {
  isWarmReconnectProviderSendEnabled,
  runWarmReconnectPilotExecutor,
} from "@/lib/crm/warm-reconnect-executor";
import {
  authorizeRevenueAutomationWorker,
  resolveRevenueAutomationWorkerUid,
} from "@/lib/revenue/worker-auth";

vi.mock("@/lib/crm/warm-reconnect-executor", () => ({
  isWarmReconnectProviderSendEnabled: vi.fn(),
  runWarmReconnectPilotExecutor: vi.fn(),
}));

vi.mock("@/lib/revenue/worker-auth", () => ({
  authorizeRevenueAutomationWorker: vi.fn(),
  resolveRevenueAutomationWorkerUid: vi.fn(),
}));

const enabledMock = vi.mocked(isWarmReconnectProviderSendEnabled);
const executorMock = vi.mocked(runWarmReconnectPilotExecutor);
const authorizeMock = vi.mocked(authorizeRevenueAutomationWorker);
const uidMock = vi.mocked(resolveRevenueAutomationWorkerUid);
const pilotId = "wrp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

function context() {
  return { params: Promise.resolve({}) };
}

function request(body: unknown) {
  return new Request("http://localhost/api/jobs/warm-reconnect", {
    method: "POST",
    headers: {
      authorization: "Bearer short-lived-oidc",
      "content-type": "application/json",
      "x-correlation-id": "executor-correlation-1",
    },
    body: JSON.stringify(body),
  });
}

describe("warm reconnect executor worker route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    enabledMock.mockReturnValue(true);
    authorizeMock.mockResolvedValue({
      mode: "oidc",
      principalHash: "principal-hash",
    });
    uidMock.mockReturnValue("owner-1");
    executorMock.mockResolvedValue({
      ok: true,
      outcome: "sent",
      providerCalled: true,
      receiptId: "wre_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      complete: false,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("authenticates first, then fails closed before provider work when the kill switch is off", async () => {
    enabledMock.mockReturnValue(false);
    const response = await POST(request({ pilotId }) as never, context() as never);
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(authorizeMock).toHaveBeenCalledOnce();
    expect(executorMock).not.toHaveBeenCalled();
  });

  it("requires OIDC and rejects the repository's legacy worker-token mode", async () => {
    enabledMock.mockReturnValue(false);
    authorizeMock.mockResolvedValue({
      mode: "legacy_token",
      principalHash: "legacy-hash",
    });
    const response = await POST(request({ pilotId }) as never, context() as never);
    expect(response.status).toBe(403);
    expect(enabledMock).not.toHaveBeenCalled();
    expect(executorMock).not.toHaveBeenCalled();
  });

  it("accepts only a strict pilot id and invokes one executor run", async () => {
    const response = await POST(request({ pilotId }) as never, context() as never);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      outcome: "sent",
      providerCalled: true,
      authMode: "oidc",
      correlationId: "executor-correlation-1",
    });
    expect(executorMock).toHaveBeenCalledOnce();
    expect(executorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        uid: "owner-1",
        pilotId,
        correlationId: "executor-correlation-1",
      })
    );

    const invalid = await POST(
      request({ pilotId, uid: "caller-controlled-owner" }) as never,
      context() as never
    );
    expect(invalid.status).toBe(400);
    expect(executorMock).toHaveBeenCalledTimes(1);
  });

  it("rejects non-JSON and declared or actual bodies over 1 KiB", async () => {
    const wrongType = new Request("http://localhost/api/jobs/warm-reconnect", {
      method: "POST",
      headers: {
        authorization: "Bearer short-lived-oidc",
        "content-type": "text/plain",
      },
      body: JSON.stringify({ pilotId }),
    });
    expect(await POST(wrongType as never, context() as never)).toMatchObject({
      status: 415,
    });

    const declaredOversize = new Request(
      "http://localhost/api/jobs/warm-reconnect",
      {
        method: "POST",
        headers: {
          authorization: "Bearer short-lived-oidc",
          "content-type": "application/json",
          "content-length": "1025",
        },
        body: JSON.stringify({ pilotId }),
      }
    );
    expect(
      await POST(declaredOversize as never, context() as never)
    ).toMatchObject({ status: 413 });

    const actualOversize = request({ pilotId, padding: "x".repeat(1_024) });
    expect(await POST(actualOversize as never, context() as never)).toMatchObject({
      status: 413,
    });
    expect(executorMock).not.toHaveBeenCalled();
  });
});
