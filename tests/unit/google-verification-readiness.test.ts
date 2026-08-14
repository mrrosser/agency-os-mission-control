import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/handler";
import {
  buildVerificationReadinessReport,
  resolveVerificationReadinessOrigin,
} from "@/lib/google/verification-readiness";

describe("Google verification readiness", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("fetches only the exact pinned public origin without following redirects", async () => {
    vi.stubEnv("MISSION_CONTROL_PUBLIC_ORIGIN", "https://leadflow-review.web.app");
    const fetchMock = vi.fn(async (input: string | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/login")) {
        return new Response('<a href="/privacy">Privacy</a><a href="/terms">Terms</a>Mission Control', {
          status: 200,
        });
      }
      if (url.endsWith("/privacy") || url.endsWith("/terms")) {
        return new Response("ok", { status: 200 });
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const report = await buildVerificationReadinessReport();

    expect(report.status).toBe("ready");
    expect(report.baseUrl).toBe("https://leadflow-review.web.app");
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      "https://leadflow-review.web.app/login",
      "https://leadflow-review.web.app/privacy",
      "https://leadflow-review.web.app/terms",
    ]);
    for (const [, options] of fetchMock.mock.calls) {
      expect(options).toMatchObject({
        method: "GET",
        cache: "no-store",
        redirect: "manual",
      });
    }
    expect(report.checks.find((check) => check.id === "domain-recommendation")?.status).toBe(
      "warn"
    );
  });

  it("reports a redirect as unreachable without fetching its metadata target", async () => {
    vi.stubEnv("MISSION_CONTROL_PUBLIC_ORIGIN", "https://leadflow-review.web.app");
    const fetchMock = vi.fn(async (input: string | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/login")) {
        return new Response(null, {
          status: 302,
          headers: { location: "http://169.254.169.254/latest/meta-data" },
        });
      }
      return new Response("ok", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const report = await buildVerificationReadinessReport();

    expect(report.status).toBe("needs_action");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls.map(([url]) => String(url))).not.toContain(
      "http://169.254.169.254/latest/meta-data"
    );
  });

  it("returns needs_action when required pages are missing", async () => {
    vi.stubEnv("MISSION_CONTROL_PUBLIC_ORIGIN", "https://gallery.example.com");
    const fetchMock = vi.fn(async () => new Response("missing", { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);

    const report = await buildVerificationReadinessReport();

    expect(report.status).toBe("needs_action");
    expect(report.baseUrl).toBe("https://gallery.example.com");
    expect(report.checks.find((check) => check.id === "privacy-page")?.status).toBe("fail");
    expect(report.checks.find((check) => check.id === "domain-recommendation")?.status).toBe(
      "pass"
    );
  });

  it("fails closed when the canonical public origin is not pinned", () => {
    vi.stubEnv("MISSION_CONTROL_PUBLIC_ORIGIN", "");

    let error: unknown;
    try {
      resolveVerificationReadinessOrigin();
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 503,
      message: "Google verification readiness requires a configured public origin",
    });
  });

  it.each([
    "http://localhost:3000",
    "https://localhost",
    "https://127.0.0.1",
    "https://[::1]",
    "https://169.254.169.254",
    "https://metadata.google.internal",
  ])("rejects a non-public pinned origin: %s", (origin) => {
    vi.stubEnv("MISSION_CONTROL_PUBLIC_ORIGIN", origin);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    let error: unknown;
    try {
      resolveVerificationReadinessOrigin();
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 500,
      message: "MISSION_CONTROL_PUBLIC_ORIGIN must be an exact public HTTPS origin",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    "https://leadflow-review.web.app/",
    "https://leadflow-review.web.app/path",
    "https://leadflow-review.web.app?target=https://example.com",
    "https://user@leadflow-review.web.app",
  ])("rejects a non-canonical pinned origin: %s", (origin) => {
    vi.stubEnv("MISSION_CONTROL_PUBLIC_ORIGIN", origin);

    let error: unknown;
    try {
      resolveVerificationReadinessOrigin();
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 500,
      message: "MISSION_CONTROL_PUBLIC_ORIGIN must be an exact public HTTPS origin",
    });
  });
});
