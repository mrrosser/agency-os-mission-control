import { WARM_RECONNECT_ALLOWED_GOOGLE_PROFILES } from "@/lib/crm/warm-reconnect-activation-types";
import type { WarmReconnectActivationResponse, WarmReconnectBusinessId, WarmReconnectGoogleProfileId } from "@/lib/crm/warm-reconnect-activation-types";

export const GOOGLE_CONNECTION_TIMEOUT_MS = 20_000;

export class GoogleConnectionCancelledError extends Error {
  constructor() { super("The connection attempt was canceled."); this.name = "GoogleConnectionCancelledError"; }
}

export class GoogleConnectionTimeoutError extends Error {
  constructor(message = "Google connection did not finish in time. Refresh connection status, then start a new connection when you are ready.") {
    super(message); this.name = "GoogleConnectionTimeoutError";
  }
}

export function assertGoogleConnectionActive(signal: AbortSignal): void {
  if (signal.aborted) throw new GoogleConnectionCancelledError();
}

/** One deadline spans authentication, fetch and body parsing, including non-abortable waits. */
export function withGoogleConnectionDeadline<T>(
  work: (signal: AbortSignal) => Promise<T>,
  options: { signal: AbortSignal; timeoutMs?: number; timeoutMessage?: string },
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? GOOGLE_CONNECTION_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return Promise.reject(new Error("Invalid Google connection deadline."));
  if (options.signal.aborted) return Promise.reject(new GoogleConnectionCancelledError());
  const controller = new AbortController();
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const cleanup = () => { clearTimeout(timer); options.signal.removeEventListener("abort", cancel); };
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      controller.abort();
      reject(error);
    };
    const cancel = () => fail(new GoogleConnectionCancelledError());
    options.signal.addEventListener("abort", cancel, { once: true });
    const timer = setTimeout(() => fail(new GoogleConnectionTimeoutError(options.timeoutMessage)), timeoutMs);
    Promise.resolve().then(() => {
      assertGoogleConnectionActive(controller.signal);
      return work(controller.signal);
    }).then((result) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    }, fail);
  });
}

export async function requestGoogleSenderConnection(input: {
  profileId: WarmReconnectGoogleProfileId;
  businessId: WarmReconnectBusinessId;
  getAuthHeaders: () => Promise<Record<string, string>>;
  signal: AbortSignal;
  timeoutMs?: number;
  fetcher?: typeof fetch;
}): Promise<string> {
  return withGoogleConnectionDeadline(async (signal) => {
    const headers = await input.getAuthHeaders();
    assertGoogleConnectionActive(signal);
    const response = await (input.fetcher || fetch)("/api/google/connect", {
      method: "POST", headers, cache: "no-store", credentials: "same-origin", signal,
      body: JSON.stringify({ returnTo: "/dashboard/crm", scopePreset: "gmail_send", businessId: input.businessId, profileId: input.profileId }),
    });
    assertGoogleConnectionActive(signal);
    let body: unknown;
    try { body = await response.json(); }
    catch { throw new Error("Google connection returned an unreadable response. Refresh connection status before trying again."); }
    assertGoogleConnectionActive(signal);
    const row = body && typeof body === "object" ? body as Record<string, unknown> : {};
    if (!response.ok) {
      const error = typeof row.error === "string" && row.error.trim() ? row.error.trim().slice(0, 500) : `Google connection failed (${response.status}).`;
      const correlationId = response.headers.get("x-correlation-id") || "";
      throw new Error(`${error}${/^[A-Za-z0-9_-]{8,128}$/.test(correlationId) ? ` Support ID: ${correlationId}` : ""}`);
    }
    if (row.profileId !== input.profileId || row.businessId !== input.businessId) throw new Error("Google returned a different sending profile. Refresh connection status before trying again.");
    let authUrl: URL;
    try { authUrl = new URL(typeof row.authUrl === "string" ? row.authUrl : ""); }
    catch { throw new Error("Google returned an invalid authorization destination."); }
    if (authUrl.protocol !== "https:" || authUrl.hostname !== "accounts.google.com" || authUrl.username || authUrl.password || (authUrl.port && authUrl.port !== "443")) {
      throw new Error("Google returned an unexpected authorization destination.");
    }
    return authUrl.toString();
  }, { signal: input.signal, timeoutMs: input.timeoutMs });
}


/** Validate server profile data before rendering it or using it as a connect target. */
export function parseGoogleSenderProfiles(value: unknown): WarmReconnectActivationResponse["googleProfiles"] {
  const invalid = () => new Error("Sender connection status could not be verified.");
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid();
  const row = value as Record<string, unknown>;
  if (row.schemaVersion !== "crm.warm-reconnect-sender-profiles.v1" || row.providerActions !== "none" ||
      !Array.isArray(row.googleProfiles) || row.googleProfiles.length > WARM_RECONNECT_ALLOWED_GOOGLE_PROFILES.length) throw invalid();
  const seen = new Set<string>();
  for (const item of row.googleProfiles) {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw invalid();
    const profile = item as Record<string, unknown>;
    const allowed = WARM_RECONNECT_ALLOWED_GOOGLE_PROFILES.find(candidate => candidate.profileId === profile.profileId && candidate.businessId === profile.businessId);
    if (!allowed || seen.has(allowed.profileId) || typeof profile.label !== "string" || !profile.label.trim() || profile.label.length > 100 ||
        typeof profile.connected !== "boolean" || typeof profile.gmailCapable !== "boolean" ||
        (typeof profile.state !== "string" || !["connected", "not_connected", "reconnect_required", "unavailable"].includes(profile.state)) ||
        !(profile.accountEmail === null || (typeof profile.accountEmail === "string" && profile.accountEmail.length <= 320 && /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(profile.accountEmail))) ||
        !(profile.accountId === null || (typeof profile.accountId === "string" && profile.accountId.length > 0 && profile.accountId.length <= 256))) throw invalid();
    seen.add(allowed.profileId);
  }
  return row.googleProfiles as WarmReconnectActivationResponse["googleProfiles"];
}
