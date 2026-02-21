import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/runtime/preflight/route";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { buildRuntimePreflightReport } from "@/lib/runtime/preflight";

vi.mock("@/lib/api/auth", () => ({
  requireFirebaseAuth: vi.fn(),
}));

vi.mock("@/lib/runtime/preflight", () => ({
  buildRuntimePreflightReport: vi.fn(),
}));

const requireAuthMock = vi.mocked(requireFirebaseAuth);
const buildReportMock = vi.mocked(buildRuntimePreflightReport);

function createContext() {
  return { params: Promise.resolve({}) };
}

describe("runtime preflight route", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    requireAuthMock.mockResolvedValue({ uid: "user-1" } as unknown as { uid: string });
    buildReportMock.mockReturnValue({
      status: "warn",
      generatedAt: "2026-02-21T00:00:00.000Z",
      checks: [],
    });
  });

  it("returns runtime preflight report for authenticated users", async () => {
    const req = new Request("http://localhost/api/runtime/preflight", { method: "GET" });
    const res = await GET(
      req as unknown as Parameters<typeof GET>[0],
      createContext() as unknown as Parameters<typeof GET>[1]
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.status).toBe("warn");
    expect(buildReportMock).toHaveBeenCalled();
  });
});

