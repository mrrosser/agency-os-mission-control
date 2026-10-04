import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  GoogleConnectionCancelledError,
  GoogleConnectionTimeoutError,
  requestGoogleSenderConnection,
  withGoogleConnectionDeadline,
} from "@/components/crm/google-sender-connection-client";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const authUrl = "https://accounts.google.com/o/oauth2/v2/auth?state=synthetic-state";
const profile = { profileId: "rt_solutions_send", businessId: "rt_solutions" } as const;
const authHeaders: Record<string, string> = { Authorization: "Bearer synthetic-test-token", "Content-Type": "application/json", "X-Idempotency-Key": "synthetic-attempt" };
const reply = (overrides: Record<string, unknown> = {}) => new Response(JSON.stringify({ ...profile, authUrl, ...overrides }), {
  headers: { "content-type": "application/json" },
});

function setup() {
  const controller = new AbortController();
  const getAuthHeaders = vi.fn(async () => authHeaders);
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(reply());
  const run = () => requestGoogleSenderConnection({ ...profile, getAuthHeaders, fetcher, signal: controller.signal, timeoutMs: 1_000 });
  return { controller, getAuthHeaders, fetcher, run };
}

describe("Google sender connection client recovery", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it("requests only the selected send-only profile once and returns a verified Google destination", async () => {
    const context = setup();
    await expect(context.run()).resolves.toBe(authUrl);
    expect(context.fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = context.fetcher.mock.calls[0];
    expect(url).toBe("/api/google/connect");
    expect(init).toMatchObject({ method: "POST", cache: "no-store", credentials: "same-origin", headers: authHeaders });
    expect(JSON.parse(String(init?.body))).toEqual({ ...profile, returnTo: "/dashboard/crm", scopePreset: "gmail_send" });
    expect(vi.getTimerCount()).toBe(0);
    context.controller.abort();
    expect(context.fetcher).toHaveBeenCalledTimes(1);
  });

  it("times out a pending token refresh and never posts when authentication resolves late", async () => {
    const context = setup();
    const authentication = deferred<Record<string, string>>();
    context.getAuthHeaders.mockReturnValue(authentication.promise);
    const result = context.run();
    const assertion = expect(result).rejects.toBeInstanceOf(GoogleConnectionTimeoutError);
    await vi.advanceTimersByTimeAsync(1_000);
    await assertion;
    authentication.resolve(authHeaders);
    await vi.advanceTimersByTimeAsync(0);
    expect(context.fetcher).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("aborts a pending request at the deadline without automatically retrying", async () => {
    const context = setup();
    const pending = deferred<Response>();
    context.fetcher.mockReturnValue(pending.promise);
    const result = context.run();
    const assertion = expect(result).rejects.toBeInstanceOf(GoogleConnectionTimeoutError);
    await vi.advanceTimersByTimeAsync(1_000);
    await assertion;
    expect(context.fetcher).toHaveBeenCalledTimes(1);
    expect(context.fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
    pending.resolve(reply());
    await vi.advanceTimersByTimeAsync(5_000);
    expect(context.fetcher).toHaveBeenCalledTimes(1);
  });

  it("bounds response-body parsing even when the mock transport ignores abort", async () => {
    const context = setup();
    const body = deferred<unknown>();
    const json = vi.fn(() => body.promise);
    context.fetcher.mockResolvedValue({ ok: true, headers: new Headers(), json } as unknown as Response);
    const result = context.run();
    const assertion = expect(result).rejects.toBeInstanceOf(GoogleConnectionTimeoutError);
    await vi.advanceTimersByTimeAsync(0);
    expect(json).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_000);
    await assertion;
    expect(context.fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
    body.resolve({ ...profile, authUrl });
    await vi.advanceTimersByTimeAsync(0);
    expect(context.fetcher).toHaveBeenCalledTimes(1);
  });

  it("uses one total deadline rather than restarting it after authentication", async () => {
    const context = setup();
    const authentication = deferred<Record<string, string>>();
    context.getAuthHeaders.mockReturnValue(authentication.promise);
    context.fetcher.mockReturnValue(new Promise<Response>(() => {}));
    const result = context.run();
    const assertion = expect(result).rejects.toBeInstanceOf(GoogleConnectionTimeoutError);
    await vi.advanceTimersByTimeAsync(800);
    authentication.resolve(authHeaders);
    await vi.advanceTimersByTimeAsync(0);
    expect(context.fetcher).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(200);
    await assertion;
  });

  it("does not begin authentication after an already-canceled intent", async () => {
    const context = setup();
    context.controller.abort();
    await expect(context.run()).rejects.toBeInstanceOf(GoogleConnectionCancelledError);
    expect(context.getAuthHeaders).not.toHaveBeenCalled();
    expect(context.fetcher).not.toHaveBeenCalled();
  });

  it("cancels a non-abortable authentication wait without a late POST", async () => {
    const context = setup();
    const authentication = deferred<Record<string, string>>();
    context.getAuthHeaders.mockReturnValue(authentication.promise);
    const result = context.run();
    const assertion = expect(result).rejects.toBeInstanceOf(GoogleConnectionCancelledError);
    await vi.advanceTimersByTimeAsync(0);
    context.controller.abort();
    await assertion;
    authentication.resolve(authHeaders);
    await vi.advanceTimersByTimeAsync(0);
    expect(context.fetcher).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("ignores a late success after a caller cancels the network wait", async () => {
    const context = setup();
    const pending = deferred<Response>();
    context.fetcher.mockReturnValue(pending.promise);
    const result = context.run();
    const assertion = expect(result).rejects.toBeInstanceOf(GoogleConnectionCancelledError);
    await vi.advanceTimersByTimeAsync(0);
    context.controller.abort();
    await assertion;
    pending.resolve(reply());
    await vi.advanceTimersByTimeAsync(0);
    expect(context.fetcher).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("preserves safe server feedback and a support ID without returning response metadata", async () => {
    const context = setup();
    context.fetcher.mockResolvedValue(new Response(JSON.stringify({ error: "A Google connection is already completing for this profile.", authUrl: "private response metadata" }), {
      status: 409, headers: { "content-type": "application/json", "x-correlation-id": "synthetic-support-id" },
    }));
    await expect(context.run()).rejects.toThrow("A Google connection is already completing for this profile. Support ID: synthetic-support-id");
    expect(context.fetcher).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("uses a generic error for invalid JSON instead of echoing response text", async () => {
    const context = setup();
    context.fetcher.mockResolvedValue(new Response("private response metadata", { status: 502 }));
    await expect(context.run()).rejects.toThrow("Google connection returned an unreadable response.");
    expect(context.fetcher).toHaveBeenCalledTimes(1);
  });

  it("rejects a successful response for another sending profile", async () => {
    const context = setup();
    context.fetcher.mockResolvedValue(reply({ profileId: "rosser_gallery_send", businessId: "rosser_nft_gallery" }));
    await expect(context.run()).rejects.toThrow("different sending profile");
  });

  it.each([
    "http://accounts.google.com/o/oauth2/v2/auth",
    "https://accounts.google.com.attacker.invalid/o/oauth2/v2/auth",
    "https://synthetic:synthetic@accounts.google.com/o/oauth2/v2/auth",
    "https://accounts.google.com:8443/o/oauth2/v2/auth",
    "javascript:alert('synthetic')",
  ])("rejects an untrusted authorization destination: %s", async (destination) => {
    const context = setup();
    context.fetcher.mockResolvedValue(reply({ authUrl: destination }));
    await expect(context.run()).rejects.toThrow("authorization destination");
  });

  it("allows a new explicit attempt after a deadline without retrying the old attempt", async () => {
    const context = setup();
    context.fetcher.mockReturnValueOnce(new Promise<Response>(() => {}));
    const first = context.run();
    const assertion = expect(first).rejects.toBeInstanceOf(GoogleConnectionTimeoutError);
    await vi.advanceTimersByTimeAsync(1_000);
    await assertion;
    expect(context.fetcher).toHaveBeenCalledTimes(1);
    await expect(context.run()).resolves.toBe(authUrl);
    expect(context.fetcher).toHaveBeenCalledTimes(2);
  });

  it("bounds a read-only status wait with its own actionable message", async () => {
    const controller = new AbortController();
    const result = withGoogleConnectionDeadline(() => new Promise<never>(() => {}), {
      signal: controller.signal, timeoutMs: 10, timeoutMessage: "Refresh connection status when ready.",
    });
    const assertion = expect(result).rejects.toThrow("Refresh connection status when ready.");
    await vi.advanceTimersByTimeAsync(10);
    await assertion;
    expect(vi.getTimerCount()).toBe(0);
  });
});
