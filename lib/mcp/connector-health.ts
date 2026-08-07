import { GoogleAuth } from "google-auth-library";
import type { Logger } from "@/lib/logging";

export interface McpConnectorProbeResult {
  state: "operational" | "degraded";
  checkedAt: string;
  latencyMs: number;
  protocolVersion: string;
  toolCount: number | null;
  detail: string;
}

interface ProbeInput {
  connectorId: string;
  endpoint: string;
  protocolVersion?: string;
  timeoutMs?: number;
  correlationId: string;
  authHeaders?: Record<string, string>;
  fetchImpl?: typeof fetch;
  log?: Logger;
}

class McpProbeError extends Error {
  constructor(
    readonly stage: "initialize" | "initialized" | "tools_list",
    readonly status: number | null,
    message: string
  ) {
    super(message);
  }
}

function clampTimeout(value: number | undefined): number {
  if (!Number.isFinite(value ?? NaN)) return 2500;
  return Math.min(10_000, Math.max(500, Math.round(value as number)));
}

function parseHttpEndpoint(value: string): URL | null {
  try {
    const endpoint = new URL(value.trim());
    return endpoint.protocol === "http:" || endpoint.protocol === "https:" ? endpoint : null;
  } catch {
    return null;
  }
}

function parseMcpPayload(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const value = JSON.parse(trimmed);
    return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  } catch {
    // Streamable HTTP may return a short SSE response. Read the first JSON data event.
    for (const line of trimmed.split(/\r?\n/)) {
      if (!line.startsWith("data:")) continue;
      try {
        const value = JSON.parse(line.slice("data:".length).trim());
        if (value && typeof value === "object") return value as Record<string, unknown>;
      } catch {
        // Continue to the next data event.
      }
    }
    return null;
  }
}

async function readPayload(response: Response): Promise<Record<string, unknown> | null> {
  const raw = await response.text().catch(() => "");
  return parseMcpPayload(raw);
}

function assertJsonRpcSuccess(
  payload: Record<string, unknown> | null,
  stage: McpProbeError["stage"]
): Record<string, unknown> {
  if (!payload || payload.error || !payload.result || typeof payload.result !== "object") {
    throw new McpProbeError(stage, null, `${stage} returned an invalid JSON-RPC result`);
  }
  return payload.result as Record<string, unknown>;
}

export async function probeMcpConnector(input: ProbeInput): Promise<McpConnectorProbeResult> {
  const startedAt = Date.now();
  const checkedAt = new Date(startedAt).toISOString();
  const protocolVersion = input.protocolVersion || "2025-03-26";
  const endpoint = parseHttpEndpoint(input.endpoint);
  if (!endpoint) {
    return {
      state: "degraded",
      checkedAt,
      latencyMs: 0,
      protocolVersion,
      toolCount: null,
      detail: "Configured endpoint is not a valid http(s) MCP URL.",
    };
  }

  const timeoutMs = clampTimeout(input.timeoutMs);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const fetchImpl = input.fetchImpl || fetch;
  const baseHeaders: Record<string, string> = {
    Accept: "application/json,text/event-stream",
    "Content-Type": "application/json",
    "MCP-Protocol-Version": protocolVersion,
    "X-Correlation-Id": input.correlationId,
    "X-Idempotency-Key": `health:${input.connectorId}:${input.correlationId}`,
    ...(input.authHeaders || {}),
  };

  input.log?.info("connector.mcp.probe_started", {
    connectorId: input.connectorId,
    endpointOrigin: endpoint.origin,
    protocolVersion,
    timeoutMs,
    correlationId: input.correlationId,
  });

  try {
    const initializeResponse = await fetchImpl(endpoint.toString(), {
      method: "POST",
      headers: baseHeaders,
      signal: controller.signal,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: `health-init-${input.correlationId}`,
        method: "initialize",
        params: {
          protocolVersion,
          capabilities: {},
          clientInfo: { name: "agency-os-mission-control-health", version: "1.0.0" },
        },
      }),
    });
    const initializePayload = await readPayload(initializeResponse);
    if (!initializeResponse.ok) {
      throw new McpProbeError("initialize", initializeResponse.status, "initialize request failed");
    }
    assertJsonRpcSuccess(initializePayload, "initialize");

    const sessionId = initializeResponse.headers.get("mcp-session-id");
    const sessionHeaders = sessionId
      ? { ...baseHeaders, "Mcp-Session-Id": sessionId }
      : baseHeaders;

    const initializedResponse = await fetchImpl(endpoint.toString(), {
      method: "POST",
      headers: sessionHeaders,
      signal: controller.signal,
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "notifications/initialized",
        params: {},
      }),
    });
    if (!initializedResponse.ok) {
      throw new McpProbeError("initialized", initializedResponse.status, "initialized notification failed");
    }

    const toolsResponse = await fetchImpl(endpoint.toString(), {
      method: "POST",
      headers: sessionHeaders,
      signal: controller.signal,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: `health-tools-${input.correlationId}`,
        method: "tools/list",
        params: {},
      }),
    });
    const toolsPayload = await readPayload(toolsResponse);
    if (!toolsResponse.ok) {
      throw new McpProbeError("tools_list", toolsResponse.status, "tools/list request failed");
    }
    const toolsResult = assertJsonRpcSuccess(toolsPayload, "tools_list");
    const tools = Array.isArray(toolsResult.tools) ? toolsResult.tools : null;
    if (!tools) {
      throw new McpProbeError("tools_list", toolsResponse.status, "tools/list did not return a tools array");
    }
    if (tools.length === 0) {
      throw new McpProbeError("tools_list", toolsResponse.status, "tools/list returned no capabilities");
    }

    const result: McpConnectorProbeResult = {
      state: "operational",
      checkedAt,
      latencyMs: Math.max(0, Date.now() - startedAt),
      protocolVersion,
      toolCount: tools.length,
      detail: "Live MCP initialize + tools/list probe passed.",
    };
    input.log?.info("connector.mcp.probe_completed", {
      connectorId: input.connectorId,
      state: result.state,
      latencyMs: result.latencyMs,
      toolCount: result.toolCount,
      correlationId: input.correlationId,
    });
    return result;
  } catch (error) {
    const aborted = controller.signal.aborted;
    const probeError = error instanceof McpProbeError ? error : null;
    const stage = probeError?.stage || "initialize";
    const status = probeError?.status ?? null;
    const result: McpConnectorProbeResult = {
      state: "degraded",
      checkedAt,
      latencyMs: Math.max(0, Date.now() - startedAt),
      protocolVersion,
      toolCount: null,
      detail: aborted
        ? `Live MCP probe timed out after ${timeoutMs}ms.`
        : `Live MCP ${stage.replace("_", "/")} probe failed${status ? ` (HTTP ${status})` : ""}.`,
    };
    input.log?.warn("connector.mcp.probe_failed", {
      connectorId: input.connectorId,
      endpointOrigin: endpoint.origin,
      stage,
      status,
      timedOut: aborted,
      latencyMs: result.latencyMs,
      correlationId: input.correlationId,
    });
    return result;
  } finally {
    clearTimeout(timeout);
  }
}

function readEnv(name: string): string | null {
  const value = process.env[name];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function readProbeTimeoutMs(): number {
  const parsed = Number.parseInt(readEnv("MCP_HEALTH_PROBE_TIMEOUT_MS") || "", 10);
  return clampTimeout(parsed);
}

async function buildSmAutoProbeAuthHeaders(endpoint: string): Promise<Record<string, string>> {
  const mode = (readEnv("SMAUTO_MCP_AUTH_MODE") || "none").toLowerCase();
  if (mode === "none") return {};
  if (mode === "api_key") {
    const apiKey = readEnv("SMAUTO_MCP_API_KEY");
    if (!apiKey) throw new Error("SMAuto API-key auth is configured without a credential");
    return { Authorization: `Bearer ${apiKey}`, "x-api-key": apiKey };
  }
  if (mode !== "id_token") throw new Error("Unsupported SMAuto MCP auth mode");

  const audience = readEnv("SMAUTO_MCP_ID_TOKEN_AUDIENCE");
  if (!audience) throw new Error("SMAuto ID-token auth is configured without an audience");
  const client = await new GoogleAuth().getIdTokenClient(audience);
  const headers = (await client.getRequestHeaders(endpoint)) as Record<string, string | undefined>;
  const authorization = headers.Authorization || headers.authorization;
  if (!authorization) throw new Error("Unable to mint SMAuto ID token");
  return { Authorization: authorization };
}

function degradedWithoutNetwork(protocolVersion: string, detail: string): McpConnectorProbeResult {
  return {
    state: "degraded",
    checkedAt: new Date().toISOString(),
    latencyMs: 0,
    protocolVersion,
    toolCount: null,
    detail,
  };
}

export async function probeConfiguredMcpConnectors(args: {
  smAutoEndpoint: string | null;
  leadOpsEndpoint: string | null;
  correlationId: string;
  log?: Logger;
}): Promise<{
  smAutoProbe: McpConnectorProbeResult | null;
  leadOpsProbe: McpConnectorProbeResult | null;
}> {
  const smAutoProtocolVersion = readEnv("SMAUTO_MCP_PROTOCOL_VERSION") || "2025-03-26";
  const leadOpsProtocolVersion = readEnv("LEADOPS_MCP_PROTOCOL_VERSION") || "2025-03-26";
  const timeoutMs = readProbeTimeoutMs();

  const smAutoProbePromise = args.smAutoEndpoint
    ? buildSmAutoProbeAuthHeaders(args.smAutoEndpoint)
        .then((authHeaders) =>
          probeMcpConnector({
            connectorId: "smauto_mcp",
            endpoint: args.smAutoEndpoint as string,
            protocolVersion: smAutoProtocolVersion,
            timeoutMs,
            correlationId: args.correlationId,
            authHeaders,
            log: args.log,
          })
        )
        .catch(() => {
          args.log?.warn("connector.mcp.probe_skipped", {
            connectorId: "smauto_mcp",
            reason: "auth_unavailable",
            correlationId: args.correlationId,
          });
          return degradedWithoutNetwork(
            smAutoProtocolVersion,
            "SMAuto endpoint is configured, but probe authentication could not be established."
          );
        })
    : Promise.resolve(null);

  const leadOpsApiKey = readEnv("LEADOPS_MCP_API_KEY");
  const leadOpsProbePromise = args.leadOpsEndpoint
    ? probeMcpConnector({
        connectorId: "leadops_mcp",
        endpoint: args.leadOpsEndpoint,
        protocolVersion: leadOpsProtocolVersion,
        timeoutMs,
        correlationId: args.correlationId,
        authHeaders: leadOpsApiKey
          ? { Authorization: `Bearer ${leadOpsApiKey}`, "x-api-key": leadOpsApiKey }
          : {},
        log: args.log,
      })
    : Promise.resolve(null);

  const [smAutoProbe, leadOpsProbe] = await Promise.all([
    smAutoProbePromise,
    leadOpsProbePromise,
  ]);
  return { smAutoProbe, leadOpsProbe };
}
