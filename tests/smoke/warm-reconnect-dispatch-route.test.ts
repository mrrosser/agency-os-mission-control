import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/jobs/warm-reconnect-dispatch/route";
import { ApiError } from "@/lib/api/handler";
import { dispatchWarmReconnectBatch } from "@/lib/crm/warm-reconnect-dispatcher";
import { isWarmReconnectProviderSendEnabled } from "@/lib/crm/warm-reconnect-provider-config";
import { authorizeRevenueAutomationWorker, resolveRevenueAutomationWorkerUid } from "@/lib/revenue/worker-auth";

vi.mock("@/lib/crm/warm-reconnect-dispatcher", () => ({ dispatchWarmReconnectBatch: vi.fn() }));
vi.mock("@/lib/crm/warm-reconnect-provider-config", () => ({ isWarmReconnectProviderSendEnabled: vi.fn() }));
vi.mock("@/lib/revenue/worker-auth", () => ({ authorizeRevenueAutomationWorker: vi.fn(), resolveRevenueAutomationWorkerUid: vi.fn() }));

const dispatchMock = vi.mocked(dispatchWarmReconnectBatch);
const enabledMock = vi.mocked(isWarmReconnectProviderSendEnabled);
const authorizeMock = vi.mocked(authorizeRevenueAutomationWorker);
const uidMock = vi.mocked(resolveRevenueAutomationWorkerUid);
const pilotId = `wrp_${"a".repeat(32)}`;

function request(body: unknown = {}, query = "", headers: Record<string, string> = {}) {
  return new Request(`http://localhost/api/jobs/warm-reconnect-dispatch${query}`, {
    method: "POST",
    headers: {
      authorization: "Bearer short-lived-oidc", "content-type": "application/json",
      "x-correlation-id": "dispatch-correlation-1", ...headers,
    },
    body: JSON.stringify(body),
  });
}

function post(req: Request = request()) {
  return POST(req as never, { params: Promise.resolve({}) });
}

describe("warm reconnect batch dispatch route", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    enabledMock.mockReturnValue(true);
    authorizeMock.mockResolvedValue({ mode: "oidc", principalHash: "principal-hash" });
    uidMock.mockReturnValue("server-owner");
    dispatchMock.mockResolvedValue({ ok: true, outcome: "sent", providerCalled: true, pilotId, receiptId: "receipt-1", complete: false });
  });

  it("authenticates before checking the kill flag or accepting any target", async () => {
    authorizeMock.mockRejectedValue(new ApiError(401, "Unauthorized"));
    enabledMock.mockReturnValue(false);
    const response = await post(request({ pilotId: "caller-pilot" }, "?uid=caller-owner"));
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(enabledMock).not.toHaveBeenCalled();
    expect(uidMock).not.toHaveBeenCalled();
    expect(dispatchMock).not.toHaveBeenCalled();
  });

  it("rejects legacy token authentication before checking the kill flag", async () => {
    authorizeMock.mockResolvedValue({ mode: "legacy_token", principalHash: "legacy-hash" });
    enabledMock.mockReturnValue(false);
    expect((await post()).status).toBe(403);
    expect(enabledMock).not.toHaveBeenCalled();
    expect(uidMock).not.toHaveBeenCalled();
    expect(dispatchMock).not.toHaveBeenCalled();
  });

  it("fails closed for authenticated OIDC when sending is disabled", async () => {
    enabledMock.mockReturnValue(false);
    expect((await post()).status).toBe(503);
    expect(authorizeMock).toHaveBeenCalledOnce();
    expect(enabledMock).toHaveBeenCalledOnce();
    expect(uidMock).not.toHaveBeenCalled();
    expect(dispatchMock).not.toHaveBeenCalled();
  });

  it.each([{ pilotId }, { uid: "caller-owner" }, { batchSequence: 5 }, { recipientCap: 10 }, { force: true }, null, []])("rejects caller-controlled body %j", async (body) => {
    expect((await post(request(body))).status).toBe(400);
    expect(uidMock).not.toHaveBeenCalled();
    expect(dispatchMock).not.toHaveBeenCalled();
  });

  it.each([`?pilotId=${pilotId}`, "?uid=caller-owner", "?force=", "?unknown=value"])("rejects query override %s", async (query) => {
    expect((await post(request({}, query))).status).toBe(400);
    expect(uidMock).not.toHaveBeenCalled();
    expect(dispatchMock).not.toHaveBeenCalled();
  });

  it("accepts only a bounded JSON object", async () => {
    expect((await post(request({}, "", { "content-type": "text/plain" }))).status).toBe(415);
    expect((await post(request({}, "", { "content-length": "1025" }))).status).toBe(413);
    expect((await post(request({ padding: "x".repeat(1024) }))).status).toBe(413);
    const malformed = new Request("http://localhost/api/jobs/warm-reconnect-dispatch", {
      method: "POST", headers: { "content-type": "application/json" }, body: "{",
    });
    expect((await post(malformed)).status).toBe(400);
    expect(dispatchMock).not.toHaveBeenCalled();
  });

  it("dispatches exactly once using only server-owned uid and the incoming correlation id", async () => {
    const response = await post();
    expect(response.status).toBe(200);
    expect(response.headers.get("x-correlation-id")).toBe("dispatch-correlation-1");
    expect(await response.json()).toMatchObject({ outcome: "sent", providerCalled: true, pilotId, authMode: "oidc", correlationId: "dispatch-correlation-1" });
    expect(dispatchMock).toHaveBeenCalledOnce();
    expect(dispatchMock).toHaveBeenCalledWith({ uid: "server-owner", correlationId: "dispatch-correlation-1", log: expect.any(Object) });
    expect(authorizeMock.mock.invocationCallOrder[0]).toBeLessThan(enabledMock.mock.invocationCallOrder[0]);
  });

  it.each(["idle", "awaiting_launch", "inactive", "complete"] as const)("returns %s as a no-send result", async (outcome) => {
    dispatchMock.mockResolvedValue({ ok: true, outcome, pilotId, providerCalled: false });
    const response = await post();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ outcome, providerCalled: false, authMode: "oidc" });
    expect(dispatchMock).toHaveBeenCalledOnce();
  });

  it("propagates a changed-lock gate without retrying dispatch", async () => {
    dispatchMock.mockRejectedValue(new ApiError(409, "The active batch changed."));
    const response = await post();
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "The active batch changed.", correlationId: "dispatch-correlation-1" });
    expect(dispatchMock).toHaveBeenCalledOnce();
  });
});
