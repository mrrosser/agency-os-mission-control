import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/revenue/daily-outcomes/route";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { getDailyOutcomeDashboard } from "@/lib/revenue/daily-outcome";

vi.mock("@/lib/api/auth", () => ({
  requireFirebaseAuth: vi.fn(),
}));

vi.mock("@/lib/revenue/daily-outcome", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/revenue/daily-outcome")>();
  return {
    ...actual,
    getDailyOutcomeDashboard: vi.fn(),
  };
});

const requireAuthMock = vi.mocked(requireFirebaseAuth);
const dashboardMock = vi.mocked(getDailyOutcomeDashboard);

function createContext() {
  return { params: Promise.resolve({}) };
}

describe("daily outcomes API", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    requireAuthMock.mockResolvedValue({ uid: "owner-1" } as Awaited<
      ReturnType<typeof requireFirebaseAuth>
    >);
    dashboardMock.mockResolvedValue({
      asOf: "2026-08-07T17:00:00.000Z",
      timeZone: "America/Chicago",
      outcomes: [
        {
          outcomeId: "daily-outcome-2026-08-07-safe",
          businessUnit: "rosser_nft_gallery",
          organizationName: "Rosser Gallery",
          localDate: "2026-08-07",
          timeZone: "America/Chicago",
          asOf: "2026-08-07T17:00:00.000Z",
          status: "at_risk",
          winningKind: null,
          evidence: [],
          counts: {
            verifiedMeetings: 0,
            applicationReady: 0,
            rejectedCandidates: 27,
            observedRecords: 27,
          },
          sourceHealth: {
            status: "observed",
            lastObservedAt: "2026-08-07T16:55:00.000Z",
            reasonCodes: [],
          },
          alert: {
            active: true,
            severity: "warning",
            reason: "No qualifying outcome receipt yet today.",
          },
          rejectionReasonCodes: ["missing_requirements"],
        },
      ],
    });
  });

  it("requires auth and returns only the public receipt projection with correlation evidence", async () => {
    const request = new Request("http://localhost/api/revenue/daily-outcomes", {
      headers: {
        authorization: "Bearer test-token",
        "x-correlation-id": "daily-smoke-cid",
      },
    });
    const response = await GET(
      request as Parameters<typeof GET>[0],
      createContext() as Parameters<typeof GET>[1]
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("x-correlation-id")).toBe("daily-smoke-cid");
    expect(payload.ok).toBe(true);
    expect(payload.timeZone).toBe("America/Chicago");
    expect(payload.outcomes[0].status).toBe("at_risk");
    expect(payload.outcomes[0].counts.applicationReady).toBe(0);
    expect(JSON.stringify(payload)).not.toContain("ws_cd43331c4b1648d0");
    expect(dashboardMock).toHaveBeenCalledWith(
      expect.objectContaining({
        uid: "owner-1",
        timeZone: "America/Chicago",
        correlationId: "daily-smoke-cid",
      })
    );
  });

  it("keeps the CRM proof surface responsive and explicit about fail-closed discovery", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile("app/dashboard/crm/page.tsx", "utf8");
    expect(source).toContain('data-testid="crm-daily-outcome-proof"');
    expect(source).toContain("grid grid-cols-1 gap-3 sm:grid-cols-2");
    expect(source).toContain("A discovery does not count");
    expect(source).toContain("Proof unavailable — not counted");
  });
});
