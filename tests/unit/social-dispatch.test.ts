import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildSocialDispatchStatusCard,
  buildSmAutoToolCallRequest,
  dispatchSocialQueueItemToSmAuto,
  type SocialDispatchQueueTask,
} from "@/lib/social/dispatch";

const log = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

const task: SocialDispatchQueueTask = {
  queueId: "draft_123",
  uid: "uid-1",
  draftId: "draft-123",
  businessKey: "rng",
  channels: ["instagram_post", "facebook_post"],
  caption: "Weekly spotlight post",
  media: [{ type: "image", url: "https://cdn.example.com/spotlight.jpg" }],
  source: "social_draft_approval",
  status: "pending_external_tool",
  correlationId: "corr-queued",
  queuedAt: "2026-02-26T10:00:00.000Z",
};

describe("social dispatch transport helpers", () => {
  const originalEnv = process.env;
  const originalFetch = globalThis.fetch;
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;
    log.info.mockReset();
    log.warn.mockReset();
    log.error.mockReset();
  });

  afterEach(() => {
    process.env = originalEnv;
    (globalThis as unknown as { fetch: typeof fetch }).fetch = originalFetch;
  });

  it("builds MCP tools/call payload for social dispatch", () => {
    process.env.SMAUTO_MCP_SOCIAL_DISPATCH_TOOL = "social.dispatch.enqueue";
    const request = buildSmAutoToolCallRequest(task, "corr-1");
    expect(request.method).toBe("tools/call");
    expect(request.params.name).toBe("social.dispatch.enqueue");
    expect(request.params.arguments.taskType).toBe("social_draft_dispatch");
    expect(request.params.arguments.queueId).toBe("draft_123");
  });

  it("builds a business status card for Google Space notifications", () => {
    const card = buildSocialDispatchStatusCard({
      uid: "uid-1",
      correlationId: "corr-status",
      summary: {
        businessKey: "rts",
        attempted: 3,
        dispatched: 2,
        failed: 1,
        skipped: 0,
        dryRun: false,
        failures: [{ queueId: "draft_1", draftId: "draft-1", error: "timeout" }],
      },
    });
    const serialized = JSON.stringify(card);
    expect(serialized).toContain("Social Dispatch Status");
    expect(serialized).toContain("RTS dispatch: 2 dispatched, 1 failed");
    expect(serialized).toContain("draft-1");
    expect(serialized).toContain("corr-status");
  });

  it("dispatches through MCP tools/call by default", async () => {
    process.env.SMAUTO_MCP_SERVER_URL = "https://smauto.example/mcp";
    process.env.SMAUTO_MCP_AUTH_MODE = "none";
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ jsonrpc: "2.0", result: { ok: true } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );

    const result = await dispatchSocialQueueItemToSmAuto({
      task,
      correlationId: "corr-dispatch",
      log,
    });

    expect(result.transport).toBe("mcp_tools_call");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://smauto.example/mcp");
    expect(init.method).toBe("POST");
    const headers = (init.headers || {}) as Record<string, string>;
    expect(headers["X-Idempotency-Key"]).toBe("draft_123");
    const body = JSON.parse(String(init.body || "{}"));
    expect(body.method).toBe("tools/call");
    expect(body.params.arguments.draftId).toBe("draft-123");
  });

  it("falls back to webhook body when MCP call returns a fallback status", async () => {
    process.env.SMAUTO_MCP_SERVER_URL = "https://smauto.example/mcp";
    process.env.SMAUTO_MCP_AUTH_MODE = "api_key";
    process.env.SMAUTO_MCP_API_KEY = "secret-key";
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "bad request" }), {
          status: 400,
          headers: { "content-type": "application/json" },
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      );

    const result = await dispatchSocialQueueItemToSmAuto({
      task,
      correlationId: "corr-fallback",
      log,
    });

    expect(result.transport).toBe("webhook");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [, secondInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    const secondHeaders = (secondInit.headers || {}) as Record<string, string>;
    expect(secondHeaders.Authorization).toBe("Bearer secret-key");
    expect(secondHeaders["x-api-key"]).toBe("secret-key");
    const secondBody = JSON.parse(String(secondInit.body || "{}"));
    expect(secondBody.taskType).toBe("social_draft_dispatch");
    expect(secondBody.queueId).toBe("draft_123");
  });

  it("fails fast when SMAUTO_MCP_SERVER_URL is missing", async () => {
    delete process.env.SMAUTO_MCP_SERVER_URL;

    await expect(
      dispatchSocialQueueItemToSmAuto({
        task,
        correlationId: "corr-missing-url",
        log,
      })
    ).rejects.toThrow("SMAUTO_MCP_SERVER_URL");
  });
});
