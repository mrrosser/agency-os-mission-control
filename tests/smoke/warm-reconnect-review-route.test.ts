import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/crm/warm-reconnect/review/route";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { ApiError } from "@/lib/api/handler";
import { loadPortfolioCrmSummaryForUid } from "@/lib/crm/portfolio-registry";
import { storeTelemetryErrorEvent } from "@/lib/telemetry/store";

vi.mock("@/lib/api/auth", () => ({ requireFirebaseAuth: vi.fn() }));
vi.mock("@/lib/crm/portfolio-registry", () => ({
  loadPortfolioCrmSummaryForUid: vi.fn(),
}));
vi.mock("@/lib/telemetry/store", () => ({ storeTelemetryErrorEvent: vi.fn() }));

const requireAuthMock = vi.mocked(requireFirebaseAuth);
const loadSummaryMock = vi.mocked(loadPortfolioCrmSummaryForUid);
const storeTelemetryMock = vi.mocked(storeTelemetryErrorEvent);

const summary = {
  schemaVersion: 1 as const,
  sourceOfTruth: "firestore_portfolio_registry" as const,
  dataClassification: "aggregate_only" as const,
  readOnly: true as const,
  registry: { accessRole: "owner" as const },
  totals: { people: 12, contactPoints: 14, emailContactPoints: 4, phoneContactPoints: 10, sourceRecords: 15, openConflicts: 0 },
  brands: { rosser_gallery: 2, rt_solutions: 1, kgclassy: 0, unassigned: 9 },
  sources: { google_people: 10, google_sheets: 3, blinq_csv: 2, other: 0 },
  permissions: {
    contactPointStates: { unknown: 14, opted_in: 0, opted_out: 0, reconfirm_required: 0, transactional_only: 0, other: 0 },
    sourceRecordsWithNoPermissionBasis: 15,
    permissionEvents: 0,
    suppressions: 0,
  },
  outreach: { status: "blocked" as const, eligibleContacts: 0 as const, reasons: ["Read only"] },
  freshness: { peopleUpdatedAt: null, contactPointsUpdatedAt: null, sourceRecordsUpdatedAt: null, latestUpdatedAt: null, observedAt: "2026-08-12T15:00:00.000Z" },
};

function context() {
  return { params: Promise.resolve({}) };
}

describe("warm reconnect review route", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    requireAuthMock.mockResolvedValue({ uid: "owner-1" } as never);
    loadSummaryMock.mockResolvedValue(summary);
    storeTelemetryMock.mockClear();
  });

  it("returns an aggregate-only inert preview with no-store and correlation headers", async () => {
    const response = await GET(
      new Request("http://localhost/api/crm/warm-reconnect/review", {
        headers: { authorization: "Bearer test", "x-correlation-id": "warm-review-cid" },
      }) as never,
      context() as never
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(response.headers.get("pragma")).toBe("no-cache");
    expect(response.headers.get("x-correlation-id")).toBe("warm-review-cid");
    expect(payload).toMatchObject({
      schemaVersion: "crm.warm-reconnect-review.v1",
      dataClassification: "aggregate_only",
      readOnly: true,
      registrySummary: summary,
      campaign: {
        state: "review_only",
        audience: { eligibleContacts: 0 },
        authority: { externalSideEffects: false, recipientData: "aggregate_only" },
        activation: { status: "blocked" },
      },
    });
    expect(JSON.stringify(payload)).not.toContain("workspace_default_owner-1");
    expect(loadSummaryMock).toHaveBeenCalledWith("owner-1", expect.anything());
  });

  it("rejects query parameters before reading registry aggregates", async () => {
    const response = await GET(
      new Request("http://localhost/api/crm/warm-reconnect/review?limit=1") as never,
      context() as never
    );
    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(loadSummaryMock).not.toHaveBeenCalled();
  });

  it("requires authentication and never falls back", async () => {
    requireAuthMock.mockRejectedValue(new ApiError(401, "Unauthorized"));
    const response = await GET(
      new Request("http://localhost/api/crm/warm-reconnect/review") as never,
      context() as never
    );
    expect(response.status).toBe(401);
    expect(response.headers.get("pragma")).toBe("no-cache");
    expect(loadSummaryMock).not.toHaveBeenCalled();
  });

  it("does not persist common telemetry when a read-only review fails", async () => {
    vi.stubEnv("TELEMETRY_ENABLED", "true");
    vi.stubEnv("TELEMETRY_SERVER_ERRORS", "true");
    loadSummaryMock.mockRejectedValue(new Error("synthetic registry failure"));

    const response = await GET(
      new Request("http://localhost/api/crm/warm-reconnect/review") as never,
      context() as never
    );
    await Promise.resolve();

    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(storeTelemetryMock).not.toHaveBeenCalled();
  });
});
