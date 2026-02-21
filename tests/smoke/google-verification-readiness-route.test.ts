import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/google/verification-readiness/route";
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

describe("google verification readiness route", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    requireAuthMock.mockResolvedValue({ uid: "user-1" } as unknown as { uid: string });
    buildReportMock.mockResolvedValue({
      status: "ready",
      generatedAt: "2026-02-21T00:00:00.000Z",
      baseUrl: "https://leadflow-review.web.app",
      checks: [],
    });
  });

  it("returns readiness report for authenticated users", async () => {
    const req = new Request(
      "http://localhost/api/google/verification-readiness?baseUrl=https://leadflow-review.web.app",
      { method: "GET" }
    );
    const res = await GET(
      req as unknown as Parameters<typeof GET>[0],
      createContext() as unknown as Parameters<typeof GET>[1]
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.status).toBe("ready");
    expect(buildReportMock).toHaveBeenCalledWith("https://leadflow-review.web.app");
  });
});

