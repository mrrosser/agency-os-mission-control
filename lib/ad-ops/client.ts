import "server-only";

const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_META_API_VERSION = "v23.0";
const DEFAULT_GOOGLE_ADS_API_VERSION = "v19";

export type AdOpsProviderId = "meta_ads" | "google_ads";
export type AdOpsCampaignAction = "pause" | "resume" | "sync";
export type AdOpsCampaignStatus = "active" | "paused" | "draft" | "unknown";
export type AdOpsTransportMode = "control_plane" | "direct_meta" | "direct_google" | "disabled";

export interface AdOpsProviderConfig {
  providerId: AdOpsProviderId;
  label: string;
  transport: AdOpsTransportMode;
  baseUrl: string | null;
  serviceToken: string | null;
  accountId: string | null;
  writeEnabled: boolean;
  campaignsPath: string;
  actionPathTemplate: string;
  timeoutMs: number;
  metaAccessToken?: string | null;
  metaApiVersion?: string | null;
  googleApiVersion?: string | null;
  googleDeveloperToken?: string | null;
  googleClientId?: string | null;
  googleClientSecret?: string | null;
  googleRefreshToken?: string | null;
  googleLoginCustomerId?: string | null;
}

export interface AdOpsCampaignRecord {
  providerId: AdOpsProviderId;
  providerLabel: string;
  campaignId: string;
  name: string;
  status: AdOpsCampaignStatus;
  objective: string | null;
  dailyBudgetUsd: number | null;
  spendMonthToDateUsd: number | null;
  updatedAt: string | null;
  writeEnabled: boolean;
}

export interface AdOpsCampaignListInput {
  providerId?: AdOpsProviderId;
  correlationId: string;
  requestedByUid: string;
  limit?: number;
}

export interface AdOpsCampaignActionEnvelope {
  agentId: string;
  delegatedBy?: string | null;
  scope: string[];
  trustLevel: "medium" | "high";
  evidenceRef: string;
  approvalRef?: string | null;
}

export interface AdOpsCampaignActionInput {
  providerId: AdOpsProviderId;
  campaignId: string;
  action: AdOpsCampaignAction;
  correlationId: string;
  requestedByUid: string;
  note?: string | null;
  autonomyClass: string;
  envelope: AdOpsCampaignActionEnvelope;
}

export class AdOpsClientError extends Error {
  status: number;

  constructor(message: string, status: number = 500) {
    super(message);
    this.name = "AdOpsClientError";
    this.status = status;
  }
}

function trimValue(value: string | undefined | null): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readBooleanEnv(name: string, env: NodeJS.ProcessEnv): boolean {
  const raw = env[name];
  if (typeof raw !== "string") return false;
  return ["1", "true", "yes", "on"].includes(raw.trim().toLowerCase());
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
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
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

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string | null {
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(Math.max(0, parsed) * 100) / 100 : null;
}

function toIso(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
  }
  return null;
}

function extractItems(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  const record = asRecord(payload);
  if (!record) return [];
  for (const key of ["campaigns", "items", "data", "results"]) {
    const candidate = record[key];
    if (Array.isArray(candidate)) return candidate;
    const nested = asRecord(candidate);
    if (!nested) continue;
    for (const nestedKey of ["campaigns", "items", "data", "results"]) {
      if (Array.isArray(nested[nestedKey])) return nested[nestedKey] as unknown[];
    }
  }
  return [];
}

function normalizeStatus(value: unknown): AdOpsCampaignStatus {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return "unknown";
  if (normalized.includes("active") || normalized.includes("enabled") || normalized.includes("serving")) {
    return "active";
  }
  if (normalized.includes("pause")) return "paused";
  if (normalized.includes("draft")) return "draft";
  return "unknown";
}

function buildHeaders(serviceToken: string | null, correlationId?: string): HeadersInit {
  return {
    Accept: "application/json",
    ...(serviceToken ? { Authorization: `Bearer ${serviceToken}` } : {}),
    ...(correlationId ? { "x-correlation-id": correlationId } : {}),
  };
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
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function buildProviderConfig(providerId: AdOpsProviderId, env: NodeJS.ProcessEnv): AdOpsProviderConfig {
  if (providerId === "meta_ads") {
    const baseUrl = ensureValidBaseUrl(trimValue(env.META_ADS_CONTROL_URL));
    const accountId = trimValue(env.META_ADS_ACCOUNT_ID);
    const accessToken = trimValue(env.META_ADS_ACCESS_TOKEN);
    return {
      providerId,
      label: "Meta Ads",
      transport: baseUrl ? "control_plane" : accountId && accessToken ? "direct_meta" : "disabled",
      baseUrl,
      serviceToken: trimValue(env.META_ADS_CONTROL_TOKEN),
      accountId,
      writeEnabled: readBooleanEnv("META_ADS_WRITE_ENABLED", env),
      campaignsPath: trimValue(env.META_ADS_CAMPAIGNS_PATH) || "/campaigns",
      actionPathTemplate: trimValue(env.META_ADS_ACTION_PATH_TEMPLATE) || "/campaigns/{campaignId}/actions",
      timeoutMs: asTimeoutMs(env.META_ADS_TIMEOUT_MS),
      metaAccessToken: accessToken,
      metaApiVersion: trimValue(env.META_ADS_API_VERSION) || DEFAULT_META_API_VERSION,
    };
  }

  const baseUrl = ensureValidBaseUrl(trimValue(env.GOOGLE_ADS_CONTROL_URL));
  const accountId = trimValue(env.GOOGLE_ADS_CUSTOMER_ID);
  const developerToken = trimValue(env.GOOGLE_ADS_DEVELOPER_TOKEN);
  const clientId = trimValue(env.GOOGLE_ADS_CLIENT_ID);
  const clientSecret = trimValue(env.GOOGLE_ADS_CLIENT_SECRET);
  const refreshToken = trimValue(env.GOOGLE_ADS_REFRESH_TOKEN);
  return {
    providerId,
    label: "Google Ads",
    transport: baseUrl
      ? "control_plane"
      : accountId && developerToken && clientId && clientSecret && refreshToken
        ? "direct_google"
        : "disabled",
    baseUrl,
    serviceToken: trimValue(env.GOOGLE_ADS_CONTROL_TOKEN),
    accountId,
    writeEnabled: readBooleanEnv("GOOGLE_ADS_WRITE_ENABLED", env),
    campaignsPath: trimValue(env.GOOGLE_ADS_CAMPAIGNS_PATH) || "/campaigns",
    actionPathTemplate: trimValue(env.GOOGLE_ADS_ACTION_PATH_TEMPLATE) || "/campaigns/{campaignId}/actions",
    timeoutMs: asTimeoutMs(env.GOOGLE_ADS_TIMEOUT_MS),
    googleApiVersion: trimValue(env.GOOGLE_ADS_API_VERSION) || DEFAULT_GOOGLE_ADS_API_VERSION,
    googleDeveloperToken: developerToken,
    googleClientId: clientId,
    googleClientSecret: clientSecret,
    googleRefreshToken: refreshToken,
    googleLoginCustomerId: trimValue(env.GOOGLE_ADS_LOGIN_CUSTOMER_ID),
  };
}

export function readAdOpsProviderConfig(
  providerId: AdOpsProviderId,
  env: NodeJS.ProcessEnv = process.env
): AdOpsProviderConfig {
  return buildProviderConfig(providerId, env);
}

export function readAdOpsProviderConfigs(env: NodeJS.ProcessEnv = process.env): AdOpsProviderConfig[] {
  return [buildProviderConfig("meta_ads", env), buildProviderConfig("google_ads", env)];
}

export function normalizeCampaigns(
  provider: AdOpsProviderConfig,
  payload: unknown
): AdOpsCampaignRecord[] {
  return extractItems(payload)
    .map((item) => {
      const row = asRecord(item);
      if (!row) return null;
      const campaignId = asString(row.campaignId) || asString(row.id) || asString(row.externalId);
      const name = asString(row.name) || asString(row.title);
      if (!campaignId || !name) return null;
      return {
        providerId: provider.providerId,
        providerLabel: provider.label,
        campaignId,
        name,
        status: normalizeStatus(row.status || row.state || row.deliveryStatus),
        objective: asString(row.objective) || asString(row.goal),
        dailyBudgetUsd: asNumber(row.dailyBudgetUsd) || asNumber(asRecord(row.dailyBudget)?.amount) || asNumber(row.daily_budget),
        spendMonthToDateUsd: asNumber(row.spendMonthToDateUsd) || asNumber(row.monthSpendUsd) || asNumber(asRecord(row.spend)?.amount) || asNumber(row.spend),
        updatedAt: toIso(row.updatedAt) || toIso(row.lastUpdatedAt) || toIso(row.createdAt) || null,
        writeEnabled: provider.writeEnabled,
      } satisfies AdOpsCampaignRecord;
    })
    .filter((value): value is AdOpsCampaignRecord => Boolean(value))
    .sort((left, right) => {
      const leftMs = Date.parse(left.updatedAt || "") || 0;
      const rightMs = Date.parse(right.updatedAt || "") || 0;
      return rightMs - leftMs;
    });
}

function metaAccountPath(accountId: string) {
  return accountId.startsWith("act_") ? accountId : `act_${accountId}`;
}

function microsToUsd(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.round((parsed / 1_000_000) * 100) / 100;
}

function minorUnitsToUsd(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.round((parsed / 100) * 100) / 100;
}

function graphErrorMessage(payload: unknown): string | null {
  const error = asRecord(asRecord(payload)?.error);
  return asString(error?.message) || null;
}

function normalizeMetaDirectCampaigns(
  provider: AdOpsProviderConfig,
  campaignsPayload: unknown,
  insightsPayload: unknown
): AdOpsCampaignRecord[] {
  const spendByCampaignId = new Map<string, number>();
  for (const item of extractItems(insightsPayload)) {
    const row = asRecord(item);
    if (!row) continue;
    const campaignId = asString(row.campaign_id) || asString(row.campaignId);
    const spend = asNumber(row.spend);
    if (campaignId && spend !== null) spendByCampaignId.set(campaignId, spend);
  }

  return extractItems(campaignsPayload)
    .map((item) => {
      const row = asRecord(item);
      if (!row) return null;
      const campaignId = asString(row.id);
      const name = asString(row.name);
      if (!campaignId || !name) return null;
      return {
        providerId: provider.providerId,
        providerLabel: provider.label,
        campaignId,
        name,
        status: normalizeStatus(row.effective_status || row.status),
        objective: asString(row.objective),
        dailyBudgetUsd: minorUnitsToUsd(row.daily_budget),
        spendMonthToDateUsd: spendByCampaignId.get(campaignId) ?? null,
        updatedAt: toIso(row.updated_time),
        writeEnabled: provider.writeEnabled,
      } satisfies AdOpsCampaignRecord;
    })
    .filter((value): value is AdOpsCampaignRecord => Boolean(value));
}

function extractGoogleSearchResults(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) {
    return payload.flatMap((chunk) => {
      const record = asRecord(chunk);
      return asArray(record?.results).map((value) => asRecord(value)).filter(Boolean) as Record<string, unknown>[];
    });
  }
  const record = asRecord(payload);
  return asArray(record?.results).map((value) => asRecord(value)).filter(Boolean) as Record<string, unknown>[];
}

function normalizeGoogleSearchResults(
  provider: AdOpsProviderConfig,
  payload: unknown
): AdOpsCampaignRecord[] {
  return extractGoogleSearchResults(payload).flatMap((row) => {
      const campaign = asRecord(row.campaign);
      const budget = asRecord(row.campaignBudget) || asRecord(row.campaign_budget);
      const metrics = asRecord(row.metrics);
      const campaignId = asString(campaign?.id) || asString(row.campaignId);
      const name = asString(campaign?.name) || asString(row.name);
      if (!campaignId || !name) return [];
      return [{
        providerId: provider.providerId,
        providerLabel: provider.label,
        campaignId,
        name,
        status: normalizeStatus(campaign?.status),
        objective: asString(campaign?.advertisingChannelType) || asString(campaign?.advertising_channel_type),
        dailyBudgetUsd: microsToUsd(budget?.amountMicros ?? budget?.amount_micros),
        spendMonthToDateUsd: microsToUsd(metrics?.costMicros ?? metrics?.cost_micros),
        updatedAt: null,
        writeEnabled: provider.writeEnabled,
      } satisfies AdOpsCampaignRecord];
    });
}

export class AdOpsClient {
  constructor(
    readonly fetchImpl: typeof fetch = fetch,
    readonly providers: AdOpsProviderConfig[] = readAdOpsProviderConfigs()
  ) {}

  private requireProvider(providerId: AdOpsProviderId): AdOpsProviderConfig {
    const provider = this.providers.find((candidate) => candidate.providerId === providerId);
    if (!provider || provider.transport === "disabled") {
      throw new AdOpsClientError(`Ad-ops provider ${providerId} is not configured.`, 503);
    }
    return provider;
  }

  private async fetchJson(
    provider: AdOpsProviderConfig,
    pathOrUrl: string,
    init: RequestInit,
    correlationId?: string
  ): Promise<{ ok: boolean; status: number; payload: unknown }> {
    if (!provider.baseUrl) {
      throw new AdOpsClientError(`${provider.label} control plane is not configured.`, 503);
    }
    const response = await fetchWithTimeout(
      this.fetchImpl,
      resolveUrl(provider.baseUrl, pathOrUrl),
      {
        ...init,
        headers: {
          ...buildHeaders(provider.serviceToken, correlationId),
          ...(init.headers || {}),
        },
      },
      provider.timeoutMs
    );
    return {
      ok: response.ok,
      status: response.status,
      payload: await readJson(response),
    };
  }

  private async fetchAbsoluteJson(
    provider: AdOpsProviderConfig,
    url: string,
    init: RequestInit,
    correlationId?: string
  ): Promise<{ ok: boolean; status: number; payload: unknown }> {
    const response = await fetchWithTimeout(
      this.fetchImpl,
      url,
      {
        ...init,
        headers: {
          Accept: "application/json",
          ...(correlationId ? { "x-correlation-id": correlationId } : {}),
          ...(init.headers || {}),
        },
      },
      provider.timeoutMs
    );
    return {
      ok: response.ok,
      status: response.status,
      payload: await readJson(response),
    };
  }

  private async fetchMetaCampaign(
    provider: AdOpsProviderConfig,
    campaignId: string,
    correlationId: string
  ): Promise<AdOpsCampaignRecord | null> {
    const version = provider.metaApiVersion || DEFAULT_META_API_VERSION;
    const accessToken = provider.metaAccessToken;
    if (!provider.accountId || !accessToken) {
      throw new AdOpsClientError("Meta Ads direct credentials are incomplete.", 503);
    }

    const campaignUrl = new URL(`https://graph.facebook.com/${version}/${encodeURIComponent(campaignId)}`);
    campaignUrl.searchParams.set("fields", "id,name,status,effective_status,objective,daily_budget,updated_time");
    campaignUrl.searchParams.set("access_token", accessToken);

    const insightsUrl = new URL(`https://graph.facebook.com/${version}/${encodeURIComponent(campaignId)}/insights`);
    insightsUrl.searchParams.set("fields", "campaign_id,spend");
    insightsUrl.searchParams.set("date_preset", "this_month");
    insightsUrl.searchParams.set("access_token", accessToken);

    const [campaignResponse, insightsResponse] = await Promise.all([
      this.fetchAbsoluteJson(provider, campaignUrl.toString(), { method: "GET" }, correlationId),
      this.fetchAbsoluteJson(provider, insightsUrl.toString(), { method: "GET" }, correlationId),
    ]);

    if (!campaignResponse.ok) {
      throw new AdOpsClientError(
        graphErrorMessage(campaignResponse.payload) ||
          `Meta Ads campaign lookup failed with status ${campaignResponse.status}.`,
        campaignResponse.status
      );
    }
    if (!insightsResponse.ok) {
      throw new AdOpsClientError(
        graphErrorMessage(insightsResponse.payload) ||
          `Meta Ads insights lookup failed with status ${insightsResponse.status}.`,
        insightsResponse.status
      );
    }

    const normalized = normalizeMetaDirectCampaigns(provider, { data: [campaignResponse.payload] }, insightsResponse.payload);
    return normalized[0] ?? null;
  }

  private async listMetaDirect(
    provider: AdOpsProviderConfig,
    input: AdOpsCampaignListInput
  ): Promise<AdOpsCampaignRecord[]> {
    const version = provider.metaApiVersion || DEFAULT_META_API_VERSION;
    const accessToken = provider.metaAccessToken;
    if (!provider.accountId || !accessToken) {
      throw new AdOpsClientError("Meta Ads direct credentials are incomplete.", 503);
    }

    const accountPath = metaAccountPath(provider.accountId);
    const limit = Math.max(1, Math.min(100, Math.floor(input.limit ?? 20)));
    const campaignsUrl = new URL(`https://graph.facebook.com/${version}/${accountPath}/campaigns`);
    campaignsUrl.searchParams.set("fields", "id,name,status,effective_status,objective,daily_budget,updated_time");
    campaignsUrl.searchParams.set("limit", String(limit));
    campaignsUrl.searchParams.set("access_token", accessToken);

    const insightsUrl = new URL(`https://graph.facebook.com/${version}/${accountPath}/insights`);
    insightsUrl.searchParams.set("level", "campaign");
    insightsUrl.searchParams.set("fields", "campaign_id,spend");
    insightsUrl.searchParams.set("date_preset", "this_month");
    insightsUrl.searchParams.set("limit", String(limit));
    insightsUrl.searchParams.set("access_token", accessToken);

    const [campaignsResponse, insightsResponse] = await Promise.all([
      this.fetchAbsoluteJson(provider, campaignsUrl.toString(), { method: "GET" }, input.correlationId),
      this.fetchAbsoluteJson(provider, insightsUrl.toString(), { method: "GET" }, input.correlationId),
    ]);

    if (!campaignsResponse.ok) {
      throw new AdOpsClientError(
        graphErrorMessage(campaignsResponse.payload) ||
          `Meta Ads campaigns request failed with status ${campaignsResponse.status}.`,
        campaignsResponse.status
      );
    }
    if (!insightsResponse.ok) {
      throw new AdOpsClientError(
        graphErrorMessage(insightsResponse.payload) ||
          `Meta Ads insights request failed with status ${insightsResponse.status}.`,
        insightsResponse.status
      );
    }

    return normalizeMetaDirectCampaigns(provider, campaignsResponse.payload, insightsResponse.payload);
  }

  private async invokeMetaDirect(input: AdOpsCampaignActionInput, provider: AdOpsProviderConfig): Promise<unknown> {
    const version = provider.metaApiVersion || DEFAULT_META_API_VERSION;
    const accessToken = provider.metaAccessToken;
    if (!accessToken) {
      throw new AdOpsClientError("Meta Ads direct credentials are incomplete.", 503);
    }

    if (input.action === "sync") {
      return {
        ok: true,
        campaign: await this.fetchMetaCampaign(provider, input.campaignId, input.correlationId),
      };
    }

    const body = new URLSearchParams({
      status: input.action === "pause" ? "PAUSED" : "ACTIVE",
      access_token: accessToken,
    });
    const response = await this.fetchAbsoluteJson(
      provider,
      `https://graph.facebook.com/${version}/${encodeURIComponent(input.campaignId)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      },
      input.correlationId
    );

    if (!response.ok) {
      throw new AdOpsClientError(
        graphErrorMessage(response.payload) ||
          `Meta Ads campaign action ${input.action} failed with status ${response.status}.`,
        response.status
      );
    }

    return {
      ok: true,
      payload: response.payload,
      campaign: await this.fetchMetaCampaign(provider, input.campaignId, input.correlationId),
    };
  }

  private async fetchGoogleAccessToken(provider: AdOpsProviderConfig, correlationId: string): Promise<string> {
    if (!provider.googleClientId || !provider.googleClientSecret || !provider.googleRefreshToken) {
      throw new AdOpsClientError("Google Ads direct credentials are incomplete.", 503);
    }

    const body = new URLSearchParams({
      client_id: provider.googleClientId,
      client_secret: provider.googleClientSecret,
      refresh_token: provider.googleRefreshToken,
      grant_type: "refresh_token",
    });
    const response = await this.fetchAbsoluteJson(
      provider,
      "https://oauth2.googleapis.com/token",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      },
      correlationId
    );
    const accessToken = asString(asRecord(response.payload)?.access_token);
    if (!response.ok || !accessToken) {
      throw new AdOpsClientError(
        `Google Ads token refresh failed with status ${response.status}.`,
        response.status
      );
    }
    return accessToken;
  }

  private googleAdsHeaders(provider: AdOpsProviderConfig, accessToken: string, correlationId: string): HeadersInit {
    if (!provider.googleDeveloperToken) {
      throw new AdOpsClientError("Google Ads developer token is missing.", 503);
    }
    return {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      "developer-token": provider.googleDeveloperToken,
      ...(provider.googleLoginCustomerId ? { "login-customer-id": provider.googleLoginCustomerId } : {}),
      "x-correlation-id": correlationId,
    };
  }

  private async fetchGoogleCampaign(
    provider: AdOpsProviderConfig,
    accessToken: string,
    campaignId: string,
    correlationId: string
  ): Promise<AdOpsCampaignRecord | null> {
    if (!provider.accountId) {
      throw new AdOpsClientError("Google Ads customer ID is missing.", 503);
    }
    const response = await this.fetchAbsoluteJson(
      provider,
      `https://googleads.googleapis.com/${provider.googleApiVersion || DEFAULT_GOOGLE_ADS_API_VERSION}/customers/${provider.accountId}/googleAds:searchStream`,
      {
        method: "POST",
        headers: this.googleAdsHeaders(provider, accessToken, correlationId),
        body: JSON.stringify({
          query: [
            "SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, campaign_budget.amount_micros, metrics.cost_micros",
            "FROM campaign",
            `WHERE campaign.id = ${campaignId}`,
            "AND campaign.status != 'REMOVED'",
            "AND segments.date DURING THIS_MONTH",
            "LIMIT 1",
          ].join(" "),
        }),
      },
      correlationId
    );
    if (!response.ok) {
      throw new AdOpsClientError(
        `Google Ads campaign lookup failed with status ${response.status}.`,
        response.status
      );
    }
    return normalizeGoogleSearchResults(provider, response.payload)[0] ?? null;
  }

  private async listGoogleDirect(
    provider: AdOpsProviderConfig,
    input: AdOpsCampaignListInput
  ): Promise<AdOpsCampaignRecord[]> {
    if (!provider.accountId) {
      throw new AdOpsClientError("Google Ads customer ID is missing.", 503);
    }
    const accessToken = await this.fetchGoogleAccessToken(provider, input.correlationId);
    const limit = Math.max(1, Math.min(100, Math.floor(input.limit ?? 20)));
    const response = await this.fetchAbsoluteJson(
      provider,
      `https://googleads.googleapis.com/${provider.googleApiVersion || DEFAULT_GOOGLE_ADS_API_VERSION}/customers/${provider.accountId}/googleAds:searchStream`,
      {
        method: "POST",
        headers: this.googleAdsHeaders(provider, accessToken, input.correlationId),
        body: JSON.stringify({
          query: [
            "SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, campaign_budget.amount_micros, metrics.cost_micros",
            "FROM campaign",
            "WHERE campaign.status != 'REMOVED'",
            "AND segments.date DURING THIS_MONTH",
            `LIMIT ${limit}`,
          ].join(" "),
        }),
      },
      input.correlationId
    );
    if (!response.ok) {
      throw new AdOpsClientError(
        `Google Ads campaigns request failed with status ${response.status}.`,
        response.status
      );
    }
    return normalizeGoogleSearchResults(provider, response.payload);
  }

  private async invokeGoogleDirect(
    input: AdOpsCampaignActionInput,
    provider: AdOpsProviderConfig
  ): Promise<unknown> {
    if (!provider.accountId) {
      throw new AdOpsClientError("Google Ads customer ID is missing.", 503);
    }
    const accessToken = await this.fetchGoogleAccessToken(provider, input.correlationId);
    if (input.action === "sync") {
      return {
        ok: true,
        campaign: await this.fetchGoogleCampaign(provider, accessToken, input.campaignId, input.correlationId),
      };
    }

    const response = await this.fetchAbsoluteJson(
      provider,
      `https://googleads.googleapis.com/${provider.googleApiVersion || DEFAULT_GOOGLE_ADS_API_VERSION}/customers/${provider.accountId}/campaigns:mutate`,
      {
        method: "POST",
        headers: this.googleAdsHeaders(provider, accessToken, input.correlationId),
        body: JSON.stringify({
          operations: [
            {
              update: {
                resourceName: `customers/${provider.accountId}/campaigns/${input.campaignId}`,
                status: input.action === "pause" ? "PAUSED" : "ENABLED",
              },
              updateMask: "status",
            },
          ],
        }),
      },
      input.correlationId
    );
    if (!response.ok) {
      throw new AdOpsClientError(
        `Google Ads campaign action ${input.action} failed with status ${response.status}.`,
        response.status
      );
    }
    return {
      ok: true,
      payload: response.payload,
      campaign: await this.fetchGoogleCampaign(provider, accessToken, input.campaignId, input.correlationId),
    };
  }

  async listCampaigns(input: AdOpsCampaignListInput): Promise<AdOpsCampaignRecord[]> {
    const providers = input.providerId
      ? [this.requireProvider(input.providerId)]
      : this.providers.filter((provider) => provider.transport !== "disabled");

    const results = await Promise.all(
      providers.map(async (provider) => {
        if (provider.transport === "direct_meta") {
          return this.listMetaDirect(provider, input);
        }
        if (provider.transport === "direct_google") {
          return this.listGoogleDirect(provider, input);
        }

        const url = new URL(resolveUrl(provider.baseUrl!, provider.campaignsPath));
        if (provider.accountId) {
          url.searchParams.set("accountId", provider.accountId);
        }
        url.searchParams.set("requestedByUid", input.requestedByUid);
        if (typeof input.limit === "number" && Number.isFinite(input.limit) && input.limit > 0) {
          url.searchParams.set("limit", String(Math.max(1, Math.floor(input.limit))));
        }

        const response = await this.fetchJson(provider, url.toString(), { method: "GET" }, input.correlationId);
        if (!response.ok) {
          throw new AdOpsClientError(
            `${provider.label} campaigns request failed with status ${response.status}.`,
            response.status
          );
        }
        return normalizeCampaigns(provider, response.payload);
      })
    );

    return results.flat();
  }

  async invokeCampaignAction(input: AdOpsCampaignActionInput): Promise<unknown> {
    const provider = this.requireProvider(input.providerId);
    if (provider.transport === "direct_meta") {
      return this.invokeMetaDirect(input, provider);
    }
    if (provider.transport === "direct_google") {
      return this.invokeGoogleDirect(input, provider);
    }

    const actionPath = provider.actionPathTemplate.replace("{campaignId}", encodeURIComponent(input.campaignId));
    const response = await this.fetchJson(
      provider,
      actionPath,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campaignId: input.campaignId,
          action: input.action,
          accountId: provider.accountId,
          requestedByUid: input.requestedByUid,
          note: input.note || null,
          autonomyClass: input.autonomyClass,
          executionEnvelope: {
            agent_id: input.envelope.agentId,
            delegated_by: input.envelope.delegatedBy || null,
            scope: input.envelope.scope,
            trust_level: input.envelope.trustLevel,
            evidence_ref: input.envelope.evidenceRef,
            approval_ref: input.envelope.approvalRef || null,
            correlation_id: input.correlationId,
          },
        }),
      },
      input.correlationId
    );

    if (!response.ok) {
      throw new AdOpsClientError(
        `${provider.label} campaign action ${input.action} failed with status ${response.status}.`,
        response.status
      );
    }
    return response.payload;
  }
}
