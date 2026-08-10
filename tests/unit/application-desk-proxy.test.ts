import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/handler";
import { forwardApplicationDeskRequest } from "@/lib/application-desk-proxy";
import type { Logger } from "@/lib/logging";

const APPLICATION_DESK_ORIGIN =
  "https://ai-hell-mary-mission-control-gdyt2qma6a-uc.a.run.app";

const fetchMock = vi.fn<typeof fetch>();

const log: Logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

function request(
  method: "GET" | "POST" = "GET",
  overrides: RequestInit = {},
): Request {
  return new Request("https://leadflow-review.web.app/api/application-desk/test", {
    method,
    headers: {
      authorization: "Bearer firebase-id-token",
      "x-workspace-id": "ws_cd43331c4b1648d0",
      ...((overrides.headers as Record<string, string> | undefined) || {}),
    },
    ...overrides,
  });
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

describe("Application Desk upstream proxy", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.mocked(log.info).mockReset();
    vi.mocked(log.warn).mockReset();
    vi.mocked(log.error).mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses the fixed service origin and forwards only the explicit GET header allowlist", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ items: [], canDecide: true }));
    const incoming = request("GET", {
      headers: {
        authorization: "Bearer firebase-id-token",
        "x-workspace-id": "ws_cd43331c4b1648d0",
        "x-correlation-id": "untrusted-client-correlation",
        cookie: "session=must-not-forward",
        "x-forwarded-host": "attacker.example",
        "x-target-origin": "https://attacker.example",
      },
    });

    const response = await forwardApplicationDeskRequest({
      request: incoming,
      path: "/api/artist-manager/application-reviews",
      method: "GET",
      correlationId: "corr-server-owned",
      log,
      requireWorkspace: true,
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(fetchMock).toHaveBeenCalledOnce();
    const [target, init] = fetchMock.mock.calls[0];
    expect(String(target)).toBe(
      `${APPLICATION_DESK_ORIGIN}/api/artist-manager/application-reviews`,
    );
    expect(init?.method).toBe("GET");
    expect(init?.redirect).toBe("error");
    expect(init?.cache).toBe("no-store");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(Object.fromEntries(new Headers(init?.headers).entries())).toEqual({
      accept: "application/json",
      authorization: "Bearer firebase-id-token",
      "x-correlation-id": "corr-server-owned",
      "x-workspace-id": "ws_cd43331c4b1648d0",
    });
  });

  it("forwards bounded JSON and idempotency data for the prepared import without cookies", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, dryRun: true }));
    const body = JSON.stringify({ dryRun: true });
    const incoming = request("POST", {
      headers: {
        authorization: "Bearer firebase-id-token",
        "x-workspace-id": "ws_cd43331c4b1648d0",
        "x-idempotency-key": "prepared-application-import-preview",
        "content-type": "text/plain",
        cookie: "private=cookie",
      },
      body,
    });

    await forwardApplicationDeskRequest({
      request: incoming,
      path: "/api/artist-manager/application-reviews/import-prepared",
      method: "POST",
      correlationId: "corr-import",
      log,
      maxRequestBytes: 256,
      requireWorkspace: true,
    });

    const [target, init] = fetchMock.mock.calls[0];
    expect(String(target)).toBe(
      `${APPLICATION_DESK_ORIGIN}/api/artist-manager/application-reviews/import-prepared`,
    );
    const headers = new Headers(init?.headers);
    expect(Object.fromEntries(headers.entries())).toEqual({
      accept: "application/json",
      authorization: "Bearer firebase-id-token",
      "content-type": "application/json",
      "x-correlation-id": "corr-import",
      "x-idempotency-key": "prepared-application-import-preview",
      "x-workspace-id": "ws_cd43331c4b1648d0",
    });
    expect(new TextDecoder().decode(init?.body as ArrayBuffer)).toBe(body);
  });

  it("rejects a non-fixed or traversal-style upstream path before fetch", async () => {
    for (const path of [
      "https://attacker.example/steal-token",
      "/api/artist-manager/../secrets",
      "/api/artist-manager/reviews?target=https://attacker.example",
      "/api/health",
      "/api/artist-manager/application-reviews/not-a-review/decision",
    ]) {
      await expect(
        forwardApplicationDeskRequest({
          request: request(),
          path,
          method: "GET",
          correlationId: "corr-invalid-path",
          log,
        }),
      ).rejects.toMatchObject({ status: 500 } satisfies Partial<ApiError>);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails closed on an oversized request body", async () => {
    await expect(
      forwardApplicationDeskRequest({
        request: request("POST", { body: "x".repeat(257) }),
        path: "/api/artist-manager/application-reviews/import-prepared",
        method: "POST",
        correlationId: "corr-large-request",
        log,
        maxRequestBytes: 256,
        requireWorkspace: true,
      }),
    ).rejects.toMatchObject({ status: 413 } satisfies Partial<ApiError>);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails closed on oversized or non-JSON upstream responses", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("{}", {
        status: 200,
        headers: {
          "content-type": "application/json",
          "content-length": String(2 * 1024 * 1024 + 1),
        },
      }),
    );
    await expect(
      forwardApplicationDeskRequest({
        request: request(),
        path: "/api/workspaces",
        method: "GET",
        correlationId: "corr-large-response",
        log,
      }),
    ).rejects.toMatchObject({ status: 502 } satisfies Partial<ApiError>);

    fetchMock.mockResolvedValueOnce(
      new Response("<html>gateway error</html>", {
        status: 502,
        headers: { "content-type": "text/html" },
      }),
    );
    await expect(
      forwardApplicationDeskRequest({
        request: request(),
        path: "/api/workspaces",
        method: "GET",
        correlationId: "corr-html-response",
        log,
      }),
    ).rejects.toMatchObject({ status: 502 } satisfies Partial<ApiError>);
  });

  it("uses redirect-error mode and maps redirect/network rejection to a safe 502", async () => {
    fetchMock.mockImplementationOnce(async (_target, init) => {
      expect(init?.redirect).toBe("error");
      throw new TypeError("fetch failed while redirect mode was error");
    });

    await expect(
      forwardApplicationDeskRequest({
        request: request(),
        path: "/api/workspaces",
        method: "GET",
        correlationId: "corr-redirect",
        log,
      }),
    ).rejects.toMatchObject({
      status: 502,
      message: "Application Desk service is temporarily unavailable.",
    } satisfies Partial<ApiError>);
    expect(log.warn).toHaveBeenCalledWith(
      "application_desk.proxy_unavailable",
      expect.objectContaining({ upstreamPath: "/api/workspaces" }),
    );
  });
});
