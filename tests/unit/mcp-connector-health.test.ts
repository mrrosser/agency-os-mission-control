import { describe, expect, it, vi } from "vitest";
import { probeMcpConnector } from "@/lib/mcp/connector-health";

describe("MCP connector health probe", () => {
  it("reports operational only after initialize and tools/list succeed", async () => {
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body || "{}")) as { method?: string };
      if (request.method === "initialize") {
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: "init",
            result: { protocolVersion: "2025-03-26", capabilities: { tools: {} } },
          }),
          { status: 200, headers: { "mcp-session-id": "session-1" } }
        );
      }
      if (request.method === "notifications/initialized") {
        return new Response(null, { status: 202 });
      }
      if (request.method === "tools/list") {
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: "tools",
            result: { tools: [{ name: "opportunity.search" }, { name: "crm.reconcile" }] },
          }),
          { status: 200 }
        );
      }
      return new Response(null, { status: 500 });
    });

    const result = await probeMcpConnector({
      connectorId: "leadops_mcp",
      endpoint: "https://leadops.example/mcp",
      correlationId: "correlation-1",
      fetchImpl: fetchMock as typeof fetch,
    });

    expect(result.state).toBe("operational");
    expect(result.toolCount).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const toolsHeaders = fetchMock.mock.calls[2]?.[1]?.headers as Record<string, string>;
    expect(toolsHeaders["Mcp-Session-Id"]).toBe("session-1");
  });

  it("accepts Streamable HTTP SSE JSON-RPC responses", async () => {
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body || "{}")) as { method?: string };
      if (request.method === "notifications/initialized") return new Response(null, { status: 204 });
      const result =
        request.method === "tools/list"
          ? { tools: [{ name: "research.search" }] }
          : { protocolVersion: "2025-03-26", capabilities: { tools: {} } };
      return new Response(`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: "1", result })}\n\n`, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    });

    const result = await probeMcpConnector({
      connectorId: "smauto_mcp",
      endpoint: "https://smauto.example/mcp",
      correlationId: "correlation-2",
      fetchImpl: fetchMock as typeof fetch,
    });
    expect(result).toMatchObject({ state: "operational", toolCount: 1 });
  });

  it("reports degraded when a configured endpoint cannot prove tools", async () => {
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body || "{}")) as { method?: string };
      if (request.method === "initialize") {
        return new Response(
          JSON.stringify({ jsonrpc: "2.0", id: "init", result: { capabilities: {} } }),
          { status: 200 }
        );
      }
      if (request.method === "notifications/initialized") return new Response(null, { status: 202 });
      return new Response(
        JSON.stringify({ jsonrpc: "2.0", id: "tools", result: { tools: [] } }),
        { status: 200 }
      );
    });

    const result = await probeMcpConnector({
      connectorId: "leadops_mcp",
      endpoint: "https://leadops.example/mcp?token=do-not-reflect",
      correlationId: "correlation-3",
      fetchImpl: fetchMock as typeof fetch,
    });

    expect(result.state).toBe("degraded");
    expect(result.toolCount).toBeNull();
    expect(result.detail).not.toContain("do-not-reflect");
  });

  it("does not call the network for an invalid endpoint", async () => {
    const fetchMock = vi.fn();
    const result = await probeMcpConnector({
      connectorId: "leadops_mcp",
      endpoint: "file:///tmp/mcp",
      correlationId: "correlation-4",
      fetchImpl: fetchMock as typeof fetch,
    });
    expect(result.state).toBe("degraded");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
