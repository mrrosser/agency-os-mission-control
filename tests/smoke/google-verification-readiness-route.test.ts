import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/google/verification-readiness/route";
import { ApiError } from "@/lib/api/handler";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { buildVerificationReadinessReport } from "@/lib/google/verification-readiness";

vi.mock("@/lib/api/auth", () => ({
  requireFirebaseAuth: vi.fn(),
}));

vi.mock("@/lib/google/verification-readiness", () => ({
  buildVerificationReadinessReport: vi.fn(),
}));

const requireAuthMock = vi.mocked(requireFirebaseAuth);
const buildReportMock = vi.mocked(buildVerificationReadinessReport);

function createContext() {
  return { params: Promise.resolve({}) };
}

async function callRoute(url: string, headers?: Record<string, string>) {
  const request = new Request(url, { method: "GET", headers });
  return GET(
    request as unknown as Parameters<typeof GET>[0],
    createContext() as unknown as Parameters<typeof GET>[1]
  );
}

describe("google verification readiness route", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    requireAuthMock.mockResolvedValue({
      uid: "user-1",
    } as unknown as Awaited<ReturnType<typeof requireFirebaseAuth>>);
    buildReportMock.mockResolvedValue({
      status: "ready",
      generatedAt: "2026-08-13T00:00:00.000Z",
      baseUrl: "https://leadflow-review.web.app",
      checks: [],
    });
  });

  it("returns the pinned report with private no-store caching and correlation", async () => {
    const response = await callRoute(
      "http://localhost/api/google/verification-readiness",
      { "x-correlation-id": "readiness-correlation-1" }
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.status).toBe("ready");
    expect(data.baseUrl).toBe("https://leadflow-review.web.app");
    expect(buildReportMock).toHaveBeenCalledWith();
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(response.headers.get("pragma")).toBe("no-cache");
    expect(response.headers.get("x-correlation-id")).toBe("readiness-correlation-1");
  });

  it("ignores an untrusted external request host", async () => {
    const response = await callRoute(
      "https://attacker.example/api/google/verification-readiness"
    );

    expect(response.status).toBe(200);
    expect(buildReportMock).toHaveBeenCalledWith();
  });

  it.each([
    "http://localhost:3000",
    "http://169.254.169.254/latest/meta-data",
    "http://metadata.google.internal/computeMetadata/v1",
    "https://attacker.example",
  ])("rejects every query parameter without probing its value: %s", async (target) => {
    const response = await callRoute(
      `https://leadflow-review.web.app/api/google/verification-readiness?baseUrl=${encodeURIComponent(target)}`,
      { "x-correlation-id": "readiness-query-rejected" }
    );
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe("Query parameters are not supported.");
    expect(data.correlationId).toBe("readiness-query-rejected");
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(response.headers.get("pragma")).toBe("no-cache");
    expect(response.headers.get("x-correlation-id")).toBe("readiness-query-rejected");
    expect(buildReportMock).not.toHaveBeenCalled();
  });

  it("rejects query parameters other than the removed baseUrl input", async () => {
    const response = await callRoute(
      "https://leadflow-review.web.app/api/google/verification-readiness?debug=true"
    );

    expect(response.status).toBe(400);
    expect(buildReportMock).not.toHaveBeenCalled();
  });

  it("requires authentication before generating or validating a report", async () => {
    requireAuthMock.mockRejectedValue(new ApiError(401, "Missing Authorization header"));

    const response = await callRoute(
      "https://leadflow-review.web.app/api/google/verification-readiness?baseUrl=https://attacker.example",
      { "x-correlation-id": "readiness-unauthorized" }
    );
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.error).toBe("Missing Authorization header");
    expect(data.correlationId).toBe("readiness-unauthorized");
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(response.headers.get("x-correlation-id")).toBe("readiness-unauthorized");
    expect(buildReportMock).not.toHaveBeenCalled();
  });
});
