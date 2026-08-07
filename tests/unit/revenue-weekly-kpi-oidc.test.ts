import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  resolveWeeklyKpiConfig,
  runWeeklyKpiRequest,
} from "../../scripts/revenue-weekly-kpi-run.mjs";

const SERVICE_ORIGIN = "https://ssrleadflowreview-example-uc.a.run.app";

function config(overrides: Record<string, string> = {}) {
  return resolveWeeklyKpiConfig({
    ...process.env,
    REVENUE_AUTOMATION_SERVICE_URL: SERVICE_ORIGIN,
    REVENUE_AUTOMATION_WORKER_OIDC_TOKEN: "signed-short-lived-token",
    REVENUE_KPI_TIMEZONE: "America/Chicago",
    ...overrides,
  });
}

describe("revenue weekly KPI OIDC runner", () => {
  it("accepts only an exact HTTPS Cloud Run service origin", () => {
    expect(config()).toMatchObject({
      serviceOrigin: SERVICE_ORIGIN,
      timeZone: "America/Chicago",
    });
    expect(() => config({ REVENUE_AUTOMATION_SERVICE_URL: "https://leadflow-review.web.app" })).toThrow(
      "exact HTTPS Cloud Run service origin"
    );
    expect(() => config({ REVENUE_AUTOMATION_SERVICE_URL: `${SERVICE_ORIGIN}/api` })).toThrow(
      "exact HTTPS Cloud Run service origin"
    );
    expect(() =>
      config({ REVENUE_AUTOMATION_WORKER_OIDC_TOKEN: "", REVENUE_KPI_WEEK_START_DATE: "2026/08/03" })
    ).toThrow("REVENUE_AUTOMATION_WORKER_OIDC_TOKEN is required");
    expect(() => config({ REVENUE_KPI_WEEK_START_DATE: "2026/08/03" })).toThrow(
      "REVENUE_KPI_WEEK_START_DATE must use YYYY-MM-DD format"
    );
  });

  it("sends the ephemeral token without a caller-controlled uid", async () => {
    const onEvent = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          authMode: "oidc",
          correlationId: "server-correlation",
          report: { weekStartDate: "2026-08-03", summary: { leadsSourced: 7 } },
        }),
        { status: 200 }
      )
    );

    const result = await runWeeklyKpiRequest({
      config: config({ REVENUE_KPI_WEEK_START_DATE: "2026-08-03" }),
      fetchImpl: fetchMock,
      correlationId: "test-correlation",
      onEvent,
    });

    expect(result).toMatchObject({
      status: 200,
      authMode: "oidc",
      correlationId: "server-correlation",
      attempts: 1,
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${SERVICE_ORIGIN}/api/revenue/kpi/weekly/worker-task`);
    expect(init.headers).toMatchObject({
      Authorization: "Bearer signed-short-lived-token",
      "x-correlation-id": "test-correlation",
    });
    expect(JSON.parse(String(init.body))).toEqual({
      timeZone: "America/Chicago",
      weekStartDate: "2026-08-03",
    });
    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "revenue.weekly_kpi.request_completed",
        correlationId: "test-correlation",
        status: 200,
      })
    );
    expect(JSON.stringify(onEvent.mock.calls)).not.toContain("signed-short-lived-token");
  });

  it("retries transient failures with the same correlation id and stops on 4xx", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const transientFetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "retry" }), { status: 503 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, report: {}, correlationId: "retry-correlation" }), {
          status: 200,
        })
      );

    const result = await runWeeklyKpiRequest({
      config: config(),
      fetchImpl: transientFetch,
      sleep,
      correlationId: "retry-correlation",
    });

    expect(result.attempts).toBe(2);
    expect(transientFetch).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(500);
    for (const [, init] of transientFetch.mock.calls as Array<[string, RequestInit]>) {
      expect(init.headers).toMatchObject({ "x-correlation-id": "retry-correlation" });
    }

    const forbiddenFetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 }));
    await expect(
      runWeeklyKpiRequest({ config: config(), fetchImpl: forbiddenFetch, sleep })
    ).rejects.toThrow("Weekly KPI worker returned 403: Forbidden");
    expect(forbiddenFetch).toHaveBeenCalledOnce();
  });

  it("keeps the workflow free of long-lived worker tokens and caller uid secrets", () => {
    const workflow = readFileSync(
      resolve(process.cwd(), ".github/workflows/revenue-weekly-kpi.yml"),
      "utf8"
    );
    const runner = readFileSync(
      resolve(process.cwd(), "scripts/revenue-weekly-kpi-run.mjs"),
      "utf8"
    );

    expect(workflow).toContain("id-token: write");
    expect(workflow).toContain("google-github-actions/auth@v3");
    expect(workflow).toContain('SERVICE_ACCOUNT="revenue-automation-scheduler@${GCP_PROJECT_ID}.iam.gserviceaccount.com"');
    expect(workflow).toContain("id_token_include_email: true");
    expect(workflow).toContain("id_token_audience: ${{ steps.config.outputs.service_url }}");
    expect(workflow).not.toMatch(/REVENUE_WEEKLY_KPI_WORKER_TOKEN/);
    expect(workflow).not.toMatch(/REVENUE_WEEKLY_KPI_UID/);
    expect(workflow).not.toMatch(/secrets\./);
    expect(runner).not.toMatch(/REVENUE_WEEKLY_KPI_WORKER_TOKEN/);
    expect(runner).not.toMatch(/REVENUE_WEEKLY_KPI_UID/);
  });
});
