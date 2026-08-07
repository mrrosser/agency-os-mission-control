import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

const WORKER_PATH = "/api/revenue/kpi/weekly/worker-task";
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_ATTEMPTS = 3;

function requiredString(value, name) {
  const normalized = String(value || "").trim();
  if (!normalized) throw new Error(`${name} is required.`);
  if (normalized.includes("\n") || normalized.includes("\r")) {
    throw new Error(`${name} contains an invalid line break.`);
  }
  return normalized;
}

export function resolveWeeklyKpiConfig(env = process.env) {
  const rawServiceUrl = requiredString(
    env.REVENUE_AUTOMATION_SERVICE_URL || env.KPI_BASE_URL,
    "REVENUE_AUTOMATION_SERVICE_URL"
  );
  const oidcToken = requiredString(
    env.REVENUE_AUTOMATION_WORKER_OIDC_TOKEN,
    "REVENUE_AUTOMATION_WORKER_OIDC_TOKEN"
  );
  const timeZone = String(env.REVENUE_KPI_TIMEZONE || "America/Chicago").trim();
  const weekStartDate = String(env.REVENUE_KPI_WEEK_START_DATE || "").trim();

  let serviceUrl;
  try {
    serviceUrl = new URL(rawServiceUrl);
  } catch {
    throw new Error("REVENUE_AUTOMATION_SERVICE_URL must be a valid URL.");
  }
  if (
    serviceUrl.protocol !== "https:" ||
    serviceUrl.username ||
    serviceUrl.password ||
    !serviceUrl.hostname.toLowerCase().endsWith(".run.app") ||
    serviceUrl.search ||
    serviceUrl.hash ||
    (serviceUrl.pathname !== "" && serviceUrl.pathname !== "/")
  ) {
    throw new Error(
      "REVENUE_AUTOMATION_SERVICE_URL must be an exact HTTPS Cloud Run service origin."
    );
  }
  if (!timeZone || timeZone.length > 80 || /[\r\n]/.test(timeZone)) {
    throw new Error("REVENUE_KPI_TIMEZONE is invalid.");
  }
  if (weekStartDate && !/^\d{4}-\d{2}-\d{2}$/.test(weekStartDate)) {
    throw new Error("REVENUE_KPI_WEEK_START_DATE must use YYYY-MM-DD format.");
  }

  return {
    serviceOrigin: serviceUrl.origin,
    oidcToken,
    timeZone,
    weekStartDate,
  };
}

function parseResponseBody(bodyText) {
  if (!bodyText) return {};
  try {
    return JSON.parse(bodyText);
  } catch {
    return {};
  }
}

function safeServerError(body, fallback) {
  const value = body && typeof body.error === "string" ? body.error.trim() : "";
  return value ? value.slice(0, 300) : fallback;
}

function shouldRetryStatus(status) {
  return status === 429 || status >= 500;
}

export async function runWeeklyKpiRequest({
  config = resolveWeeklyKpiConfig(),
  fetchImpl = fetch,
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
  correlationId = `revenue-weekly-kpi-${randomUUID()}`,
  onEvent = () => undefined,
} = {}) {
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 5) {
    throw new Error("maxAttempts must be an integer between 1 and 5.");
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 300_000) {
    throw new Error("timeoutMs must be an integer between 1000 and 300000.");
  }
  if (!String(correlationId).trim() || /[\r\n]/.test(String(correlationId))) {
    throw new Error("correlationId is invalid.");
  }
  if (typeof onEvent !== "function") throw new Error("onEvent must be a function.");
  const payload = {
    timeZone: config.timeZone,
    ...(config.weekStartDate ? { weekStartDate: config.weekStartDate } : {}),
  };
  const endpoint = `${config.serviceOrigin}${WORKER_PATH}`;
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    onEvent({
      event: "revenue.weekly_kpi.request_started",
      correlationId,
      attempt,
      maxAttempts,
    });
    try {
      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.oidcToken}`,
          "x-correlation-id": correlationId,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const body = parseResponseBody(await response.text());
      if (response.ok) {
        onEvent({
          event: "revenue.weekly_kpi.request_completed",
          correlationId,
          attempt,
          status: response.status,
        });
        return {
          status: response.status,
          report: body.report || {},
          authMode: body.authMode,
          correlationId: body.correlationId || correlationId,
          attempts: attempt,
        };
      }

      lastError = new Error(
        `Weekly KPI worker returned ${response.status}: ${safeServerError(body, "request failed")}`
      );
      onEvent({
        event: "revenue.weekly_kpi.request_rejected",
        correlationId,
        attempt,
        status: response.status,
        retrying: shouldRetryStatus(response.status) && attempt < maxAttempts,
      });
      if (!shouldRetryStatus(response.status)) {
        Object.assign(lastError, { retryable: false });
        throw lastError;
      }
      if (attempt === maxAttempts) throw lastError;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("Weekly KPI worker request failed.");
      if (lastError.retryable === false || attempt === maxAttempts) throw lastError;
      if (!lastError.message.startsWith("Weekly KPI worker returned ")) {
        onEvent({
          event: "revenue.weekly_kpi.request_error",
          correlationId,
          attempt,
          errorType: lastError.name,
          retrying: true,
        });
      }
    }

    await sleep(500 * 2 ** (attempt - 1));
  }

  throw lastError || new Error("Weekly KPI worker request failed.");
}

async function main() {
  const correlationId = `revenue-weekly-kpi-${randomUUID()}`;
  try {
    const result = await runWeeklyKpiRequest({
      correlationId,
      onEvent: (event) => console.log(JSON.stringify(event)),
    });
    console.log(
      JSON.stringify({
        event: "revenue.weekly_kpi.completed",
        status: result.status,
        attempts: result.attempts,
        correlationId: result.correlationId,
        weekStartDate: result.report.weekStartDate,
        leadsSourced: result.report.summary?.leadsSourced,
        depositsCollected: result.report.summary?.depositsCollected,
        dealsWon: result.report.summary?.dealsWon,
      })
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "revenue.weekly_kpi.failed",
        correlationId,
        error: error instanceof Error ? error.message : "Weekly KPI worker request failed.",
      })
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
