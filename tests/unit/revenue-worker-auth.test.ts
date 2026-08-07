import { beforeEach, describe, expect, it, vi } from "vitest";

const { verifyIdTokenMock } = vi.hoisted(() => ({
  verifyIdTokenMock: vi.fn(),
}));

vi.mock("google-auth-library", () => ({
  OAuth2Client: class {
    verifyIdToken = verifyIdTokenMock;
  },
}));

import type { Logger } from "@/lib/logging";
import {
  authorizeRevenueAutomationWorker,
  resolveRevenueAutomationWorkerUid,
} from "@/lib/revenue/worker-auth";

const SERVICE_ACCOUNT = "revenue-automation-scheduler@leadflow-review.iam.gserviceaccount.com";
const AUDIENCE = "https://ssrleadflowreview-example-uc.a.run.app";

function makeLogger(): Logger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function makeRequest(
  authorization?: string,
  legacyHeader?: { name: string; value: string }
): Request {
  const headers = new Headers();
  if (authorization) headers.set("Authorization", authorization);
  if (legacyHeader) headers.set(legacyHeader.name, legacyHeader.value);
  return new Request("https://example.com/api/revenue/automation/daily/worker-task", {
    method: "POST",
    headers,
  });
}

describe("revenue automation worker auth", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    for (const name of [
      "REVENUE_AUTOMATION_SCHEDULER_SERVICE_ACCOUNT_EMAIL",
      "REVENUE_AUTOMATION_WORKER_OIDC_AUDIENCE",
      "REVENUE_AUTOMATION_ALLOW_LEGACY_TOKEN",
      "REVENUE_AUTOMATION_LEGACY_WORKER_TOKEN",
      "REVENUE_DAY30_WORKER_TOKEN",
      "REVENUE_DAY2_WORKER_TOKEN",
      "REVENUE_DAY1_WORKER_TOKEN",
      "REVENUE_POS_WORKER_TOKEN",
      "REVENUE_WEEKLY_KPI_WORKER_TOKEN",
      "REVENUE_AUTOMATION_UID",
    ]) {
      delete process.env[name];
    }
    verifyIdTokenMock.mockReset();
  });

  it("accepts only the exact verified scheduler identity and audience", async () => {
    process.env.REVENUE_AUTOMATION_SCHEDULER_SERVICE_ACCOUNT_EMAIL = SERVICE_ACCOUNT;
    process.env.REVENUE_AUTOMATION_WORKER_OIDC_AUDIENCE = AUDIENCE;
    verifyIdTokenMock.mockResolvedValue({
      getPayload: () => ({
        iss: "https://accounts.google.com",
        sub: "scheduler-subject",
        email: SERVICE_ACCOUNT,
        email_verified: true,
      }),
    });

    const result = await authorizeRevenueAutomationWorker({
      request: makeRequest("Bearer signed-oidc-token"),
      correlationId: "corr-oidc",
      log: makeLogger(),
    });

    expect(result).toMatchObject({ mode: "oidc" });
    expect(result.principalHash).toMatch(/^[a-f0-9]{12}$/);
    expect(verifyIdTokenMock).toHaveBeenCalledWith({
      idToken: "signed-oidc-token",
      audience: AUDIENCE,
    });
  });

  it.each([
    { email: "other@leadflow-review.iam.gserviceaccount.com", email_verified: true, sub: "sub" },
    { email: SERVICE_ACCOUNT, email_verified: false, sub: "sub" },
    { email: SERVICE_ACCOUNT, email_verified: true, sub: "" },
  ])("rejects invalid OIDC claims %#", async (claims) => {
    process.env.REVENUE_AUTOMATION_SCHEDULER_SERVICE_ACCOUNT_EMAIL = SERVICE_ACCOUNT;
    process.env.REVENUE_AUTOMATION_WORKER_OIDC_AUDIENCE = AUDIENCE;
    verifyIdTokenMock.mockResolvedValue({
      getPayload: () => ({
        iss: "https://accounts.google.com",
        ...claims,
      }),
    });

    await expect(
      authorizeRevenueAutomationWorker({
        request: makeRequest("Bearer signed-oidc-token"),
        correlationId: "corr-rejected",
        log: makeLogger(),
      })
    ).rejects.toMatchObject({ status: 403 });
  });

  it("supports a bounded legacy-token canary only behind the explicit flag", async () => {
    process.env.REVENUE_AUTOMATION_SCHEDULER_SERVICE_ACCOUNT_EMAIL = SERVICE_ACCOUNT;
    process.env.REVENUE_AUTOMATION_WORKER_OIDC_AUDIENCE = AUDIENCE;
    process.env.REVENUE_AUTOMATION_ALLOW_LEGACY_TOKEN = "true";
    process.env.REVENUE_DAY30_WORKER_TOKEN = "legacy-secret";
    verifyIdTokenMock.mockRejectedValue(new Error("not an OIDC token"));

    const result = await authorizeRevenueAutomationWorker({
      request: makeRequest("Bearer legacy-secret"),
      correlationId: "corr-legacy",
      log: makeLogger(),
    });

    expect(result.mode).toBe("legacy_token");
  });

  it("checks every distinct historical token and legacy header only during canary", async () => {
    process.env.REVENUE_AUTOMATION_ALLOW_LEGACY_TOKEN = "true";
    process.env.REVENUE_DAY30_WORKER_TOKEN = "different-day30-secret";
    process.env.REVENUE_DAY2_WORKER_TOKEN = "different-day2-secret";
    process.env.REVENUE_DAY1_WORKER_TOKEN = "different-day1-secret";
    process.env.REVENUE_POS_WORKER_TOKEN = "different-pos-secret";
    process.env.REVENUE_WEEKLY_KPI_WORKER_TOKEN = "different-kpi-secret";

    const day2Result = await authorizeRevenueAutomationWorker({
      request: makeRequest(undefined, {
        name: "x-revenue-day2-token",
        value: "different-day2-secret",
      }),
      correlationId: "corr-distinct-day2",
      log: makeLogger(),
    });
    expect(day2Result.mode).toBe("legacy_token");

    const day1Result = await authorizeRevenueAutomationWorker({
      request: makeRequest(undefined, {
        name: "x-revenue-day1-token",
        value: "different-day1-secret",
      }),
      correlationId: "corr-distinct-day1",
      log: makeLogger(),
    });
    expect(day1Result.mode).toBe("legacy_token");

    const posResult = await authorizeRevenueAutomationWorker({
      request: makeRequest(undefined, {
        name: "x-revenue-pos-token",
        value: "different-pos-secret",
      }),
      correlationId: "corr-distinct-pos",
      log: makeLogger(),
    });
    expect(posResult.mode).toBe("legacy_token");

    const kpiResult = await authorizeRevenueAutomationWorker({
      request: makeRequest(undefined, {
        name: "x-revenue-weekly-kpi-token",
        value: "different-kpi-secret",
      }),
      correlationId: "corr-distinct-kpi",
      log: makeLogger(),
    });
    expect(kpiResult.mode).toBe("legacy_token");

    process.env.REVENUE_AUTOMATION_ALLOW_LEGACY_TOKEN = "false";
    await expect(
      authorizeRevenueAutomationWorker({
        request: makeRequest(undefined, {
          name: "x-revenue-day2-token",
          value: "different-day2-secret",
        }),
        correlationId: "corr-distinct-disabled",
        log: makeLogger(),
      })
    ).rejects.toMatchObject({ status: 503 });
  });

  it("does not accept a configured legacy token after the canary flag is removed", async () => {
    process.env.REVENUE_DAY30_WORKER_TOKEN = "legacy-secret";

    await expect(
      authorizeRevenueAutomationWorker({
        request: makeRequest("Bearer legacy-secret"),
        correlationId: "corr-no-legacy",
        log: makeLogger(),
      })
    ).rejects.toMatchObject({ status: 503 });
  });

  it("fails closed on partial or non-origin OIDC configuration", async () => {
    process.env.REVENUE_AUTOMATION_SCHEDULER_SERVICE_ACCOUNT_EMAIL = SERVICE_ACCOUNT;
    await expect(
      authorizeRevenueAutomationWorker({
        request: makeRequest("Bearer token"),
        correlationId: "corr-partial",
        log: makeLogger(),
      })
    ).rejects.toMatchObject({ status: 503 });

    process.env.REVENUE_AUTOMATION_WORKER_OIDC_AUDIENCE = `${AUDIENCE}/api/revenue`;
    await expect(
      authorizeRevenueAutomationWorker({
        request: makeRequest("Bearer token"),
        correlationId: "corr-path",
        log: makeLogger(),
      })
    ).rejects.toMatchObject({ status: 503 });
    expect(verifyIdTokenMock).not.toHaveBeenCalled();
  });

  it("requires the configured worker uid and rejects caller substitution", () => {
    expect(() => resolveRevenueAutomationWorkerUid()).toThrowError(
      "REVENUE_AUTOMATION_UID is not configured."
    );
    process.env.REVENUE_AUTOMATION_UID = "worker-uid";
    expect(resolveRevenueAutomationWorkerUid()).toBe("worker-uid");
    expect(resolveRevenueAutomationWorkerUid("worker-uid")).toBe("worker-uid");
    expect(() => resolveRevenueAutomationWorkerUid("other-uid")).toThrowError(
      "Worker uid must match the configured revenue automation identity."
    );
  });
});
