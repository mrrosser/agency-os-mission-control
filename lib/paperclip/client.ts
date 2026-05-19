import "server-only";

import type { Logger } from "@/lib/logging";
import type { PaperclipControlSnapshot } from "@/lib/control-plane/autonomous-business";

const DEFAULT_TIMEOUT_MS = 8_000;

export type PaperclipLifecycleAction = "pause" | "resume" | "terminate" | "wakeup";

export interface PaperclipClientConfig {
  baseUrl: string;
  serviceToken: string | null;
  timeoutMs: number;
  defaultCompanyId: string | null;
  healthPath: string;
  companiesPath: string;
  agentsPath: string;
  activeRunsPath: string;
  actionPathTemplate: string;
  customerRecordsPath: string;
  customerTimelinePathTemplate: string;
  customerUpdatePathTemplate: string;
}

export interface PaperclipLifecycleActionInput {
  agentId: string;
  action: PaperclipLifecycleAction;
  correlationId: string;
  requestedByUid: string;
  note?: string | null;
  target?: string | null;
  evidenceRef: string;
  autonomyClass: string;
}

export interface PaperclipLifecycleActionResult {
  ok: boolean;
  status: number;
  detail: string;
  payload: unknown;
}

export interface PaperclipCustomerListInput {
  correlationId: string;
  requestedByUid: string;
  limit?: number;
  companyId?: string | null;
}

export interface PaperclipCustomerTimelineInput {
  customerId: string;
  correlationId: string;
  requestedByUid: string;
  limit?: number;
  companyId?: string | null;
}

export interface PaperclipCustomerUpsertInput {
  customerId?: string | null;
  correlationId: string;
  requestedByUid: string;
  companyId?: string | null;
  payload: Record<string, unknown>;
}

export class PaperclipClientError extends Error {
  status: number;

  constructor(message: string, status: number = 500) {
    super(message);
    this.name = "PaperclipClientError";
    this.status = status;
  }
}

function trimValue(value: string | undefined | null): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asTimeoutMs(value: string | undefined): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1_000) return DEFAULT_TIMEOUT_MS;
  return Math.floor(parsed);
}

function ensureValidBaseUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed.origin + parsed.pathname.replace(/\/+$/, "");
  } catch {
    return null;
  }
}

function resolveUrl(baseUrl: string, pathOrUrl: string): string {
  try {
    return new URL(pathOrUrl).toString();
  } catch {
    return new URL(pathOrUrl.replace(/^\//, ""), `${baseUrl.replace(/\/+$/, "")}/`).toString();
  }
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function buildHeaders(serviceToken: string | null, correlationId?: string): HeadersInit {
  return {
    Accept: "application/json",
    ...(serviceToken ? { Authorization: `Bearer ${serviceToken}` } : {}),
    ...(correlationId ? { "x-correlation-id": correlationId } : {}),
  };
}

function extractCount(payload: unknown): number | null {
  if (Array.isArray(payload)) return payload.length;
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  const directCount = record.count ?? record.total ?? record.totalCount ?? record.activeCount;
  if (typeof directCount === "number" && Number.isFinite(directCount)) {
    return Math.max(0, Math.round(directCount));
  }
  const nestedArrays = [record.items, record.data, record.results, record.runs, record.agents, record.companies];
  for (const candidate of nestedArrays) {
    if (Array.isArray(candidate)) return candidate.length;
    if (candidate && typeof candidate === "object") {
      const nested = candidate as Record<string, unknown>;
      const nestedCount = nested.count ?? nested.total ?? nested.totalCount;
      if (typeof nestedCount === "number" && Number.isFinite(nestedCount)) {
        return Math.max(0, Math.round(nestedCount));
      }
    }
  }
  return null;
}

async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

export function readPaperclipClientConfig(
  env: NodeJS.ProcessEnv = process.env
): PaperclipClientConfig | null {
  const baseUrl = ensureValidBaseUrl(
    trimValue(env.PAPERCLIP_API_BASE_URL) ||
      trimValue(env.PAPERCLIP_SYSTEM_URL) ||
      trimValue(env.PAPERCLIP_MCP_SERVER_URL)
  );
  if (!baseUrl) return null;

  return {
    baseUrl,
    serviceToken: trimValue(env.PAPERCLIP_SERVICE_TOKEN),
    timeoutMs: asTimeoutMs(env.PAPERCLIP_TIMEOUT_MS),
    defaultCompanyId: trimValue(env.PAPERCLIP_DEFAULT_COMPANY_ID),
    healthPath: trimValue(env.PAPERCLIP_HEALTH_PATH) || "/api/health",
    companiesPath: trimValue(env.PAPERCLIP_COMPANIES_PATH) || "/api/companies",
    agentsPath: trimValue(env.PAPERCLIP_AGENTS_PATH) || "/api/agents",
    activeRunsPath: trimValue(env.PAPERCLIP_ACTIVE_RUNS_PATH) || "/api/runs?state=active",
    actionPathTemplate:
      trimValue(env.PAPERCLIP_ACTION_PATH_TEMPLATE) || "/api/agents/{agentId}/{action}",
    customerRecordsPath:
      trimValue(env.PAPERCLIP_CUSTOMER_RECORDS_PATH) || "/api/customers",
    customerTimelinePathTemplate:
      trimValue(env.PAPERCLIP_CUSTOMER_TIMELINE_PATH_TEMPLATE) ||
      "/api/customers/{customerId}/timeline",
    customerUpdatePathTemplate:
      trimValue(env.PAPERCLIP_CUSTOMER_UPDATE_PATH_TEMPLATE) ||
      "/api/customers/{customerId}",
  };
}

export class PaperclipClient {
  constructor(
    readonly config: PaperclipClientConfig,
    readonly fetchImpl: typeof fetch = fetch
  ) {}

  private async fetchJson(
    pathOrUrl: string,
    init: RequestInit = {},
    correlationId?: string
  ): Promise<{ ok: boolean; status: number; payload: unknown }> {
    const response = await fetchWithTimeout(
      this.fetchImpl,
      resolveUrl(this.config.baseUrl, pathOrUrl),
      {
        ...init,
        headers: {
          ...buildHeaders(this.config.serviceToken, correlationId),
          ...(init.headers || {}),
        },
      },
      this.config.timeoutMs
    );
    return {
      ok: response.ok,
      status: response.status,
      payload: await readJson(response),
    };
  }

  async getControlSnapshot(log: Logger): Promise<PaperclipControlSnapshot> {
    const health = await this.fetchJson(this.config.healthPath).catch((error) => {
      log.warn("paperclip.health.error", {
        message: error instanceof Error ? error.message : String(error),
      });
      return { ok: false, status: 503, payload: null };
    });

    if (!health.ok) {
      return {
        state: "degraded",
        configured: true,
        reachable: false,
        canProxyActions: Boolean(this.config.serviceToken),
        baseUrl: this.config.baseUrl,
        sourceOfTruth: this.config.serviceToken ? "paperclip" : "visibility_only",
        companyCount: null,
        agentCount: null,
        activeRunCount: null,
        detail: `Configured, but Paperclip health check returned ${health.status}.`,
        capabilities: {
          lifecycleActions: Boolean(this.config.serviceToken),
          heartbeats: true,
          budgets: true,
          audit: true,
          mobile: true,
        },
      };
    }

    const [companies, agents, activeRuns] = await Promise.all([
      this.fetchJson(this.config.companiesPath).catch(() => ({ ok: false, status: 503, payload: null })),
      this.fetchJson(this.config.agentsPath).catch(() => ({ ok: false, status: 503, payload: null })),
      this.fetchJson(this.config.activeRunsPath).catch(() => ({ ok: false, status: 503, payload: null })),
    ]);

    const companyCount = companies.ok ? extractCount(companies.payload) : null;
    const agentCount = agents.ok ? extractCount(agents.payload) : null;
    const activeRunCount = activeRuns.ok ? extractCount(activeRuns.payload) : null;

    return {
      state: "operational",
      configured: true,
      reachable: true,
      canProxyActions: Boolean(this.config.serviceToken),
      baseUrl: this.config.baseUrl,
      sourceOfTruth: this.config.serviceToken ? "paperclip" : "visibility_only",
      companyCount,
      agentCount,
      activeRunCount,
      detail:
        companyCount !== null || agentCount !== null || activeRunCount !== null
          ? `Paperclip reachable. Companies ${companyCount ?? "n/a"} • agents ${agentCount ?? "n/a"} • active runs ${activeRunCount ?? "n/a"}.`
          : "Paperclip reachable. Health responded, but summary endpoints did not return counts.",
      capabilities: {
        lifecycleActions: Boolean(this.config.serviceToken),
        heartbeats: true,
        budgets: true,
        audit: true,
        mobile: true,
      },
    };
  }

  async invokeLifecycleAction(
    input: PaperclipLifecycleActionInput
  ): Promise<PaperclipLifecycleActionResult> {
    if (!this.config.serviceToken) {
      throw new PaperclipClientError(
        "PAPERCLIP_SERVICE_TOKEN is required for lifecycle proxy actions.",
        503
      );
    }

    const actionPath = this.config.actionPathTemplate
      .replace("{agentId}", encodeURIComponent(input.agentId))
      .replace("{action}", encodeURIComponent(input.action));

    const response = await this.fetchJson(
      actionPath,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          agentId: input.agentId,
          action: input.action,
          correlationId: input.correlationId,
          requestedByUid: input.requestedByUid,
          note: input.note || null,
          target: input.target || null,
          evidenceRef: input.evidenceRef,
          autonomyClass: input.autonomyClass,
        }),
      },
      input.correlationId
    );

    if (!response.ok) {
      throw new PaperclipClientError(
        `Paperclip lifecycle action ${input.action} failed with status ${response.status}.`,
        response.status
      );
    }

    return {
      ok: true,
      status: response.status,
      detail: `Paperclip accepted ${input.action} for ${input.agentId}.`,
      payload: response.payload,
    };
  }

  async listCustomers(input: PaperclipCustomerListInput): Promise<unknown> {
    const url = new URL(resolveUrl(this.config.baseUrl, this.config.customerRecordsPath));
    if (typeof input.limit === "number" && Number.isFinite(input.limit) && input.limit > 0) {
      url.searchParams.set("limit", String(Math.max(1, Math.floor(input.limit))));
    }
    if (input.companyId || this.config.defaultCompanyId) {
      url.searchParams.set("companyId", input.companyId || this.config.defaultCompanyId!);
    }
    url.searchParams.set("requestedByUid", input.requestedByUid);

    const response = await this.fetchJson(url.toString(), { method: "GET" }, input.correlationId);
    if (!response.ok) {
      throw new PaperclipClientError(
        `Paperclip customer list failed with status ${response.status}.`,
        response.status
      );
    }
    return response.payload;
  }

  async getCustomerTimeline(input: PaperclipCustomerTimelineInput): Promise<unknown> {
    const path = this.config.customerTimelinePathTemplate.replace(
      "{customerId}",
      encodeURIComponent(input.customerId)
    );
    const url = new URL(resolveUrl(this.config.baseUrl, path));
    if (typeof input.limit === "number" && Number.isFinite(input.limit) && input.limit > 0) {
      url.searchParams.set("limit", String(Math.max(1, Math.floor(input.limit))));
    }
    if (input.companyId || this.config.defaultCompanyId) {
      url.searchParams.set("companyId", input.companyId || this.config.defaultCompanyId!);
    }
    url.searchParams.set("requestedByUid", input.requestedByUid);

    const response = await this.fetchJson(url.toString(), { method: "GET" }, input.correlationId);
    if (!response.ok) {
      throw new PaperclipClientError(
        `Paperclip customer timeline failed with status ${response.status}.`,
        response.status
      );
    }
    return response.payload;
  }

  async upsertCustomer(input: PaperclipCustomerUpsertInput): Promise<unknown> {
    const path = input.customerId
      ? this.config.customerUpdatePathTemplate.replace(
          "{customerId}",
          encodeURIComponent(input.customerId)
        )
      : this.config.customerRecordsPath;

    const response = await this.fetchJson(
      path,
      {
        method: input.customerId ? "PATCH" : "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          requestedByUid: input.requestedByUid,
          companyId: input.companyId || this.config.defaultCompanyId,
          ...input.payload,
        }),
      },
      input.correlationId
    );

    if (!response.ok) {
      throw new PaperclipClientError(
        `Paperclip customer upsert failed with status ${response.status}.`,
        response.status
      );
    }
    return response.payload;
  }
}
