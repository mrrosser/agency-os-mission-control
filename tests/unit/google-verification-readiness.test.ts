import { afterEach, describe, expect, it, vi } from "vitest";
import { buildVerificationReadinessReport } from "@/lib/google/verification-readiness";

describe("buildVerificationReadinessReport", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns ready when policy pages and login links are present", async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
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

    const report = await buildVerificationReadinessReport("https://app.example.com");
    expect(report.status).toBe("ready");
    expect(report.checks.find((check) => check.id === "domain-recommendation")?.status).toBe(
      "pass"
    );
  });

  it("returns needs_action when required pages are missing", async () => {
    const fetchMock = vi.fn(async () => new Response("missing", { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);

    const report = await buildVerificationReadinessReport("https://leadflow-review.web.app");
    expect(report.status).toBe("needs_action");
    expect(report.checks.find((check) => check.id === "privacy-page")?.status).toBe("fail");
    expect(report.checks.find((check) => check.id === "domain-recommendation")?.status).toBe(
      "warn"
    );
  });
});
