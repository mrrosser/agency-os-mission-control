import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/crm/registry/summary/route";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { ApiError } from "@/lib/api/handler";
import { loadPortfolioCrmSummaryForUid } from "@/lib/crm/portfolio-registry";

vi.mock("@/lib/api/auth", () => ({ requireFirebaseAuth: vi.fn() }));
vi.mock("@/lib/crm/portfolio-registry", () => ({
  loadPortfolioCrmSummaryForUid: vi.fn(),
}));

const requireAuthMock = vi.mocked(requireFirebaseAuth);
const loadSummaryMock = vi.mocked(loadPortfolioCrmSummaryForUid);

function context() {
  return { params: Promise.resolve({}) };
}

const summary = {
  schemaVersion: 1 as const,
  sourceOfTruth: "firestore_portfolio_registry" as const,
  dataClassification: "aggregate_only" as const,
  readOnly: true as const,
  registry: { accessRole: "owner" as const },
  totals: {
    people: 12,
    contactPoints: 14,
    emailContactPoints: 4,
    phoneContactPoints: 10,
    sourceRecords: 15,
    openConflicts: 0,
  },
  brands: { rosser_gallery: 2, rt_solutions: 1, kgclassy: 0, unassigned: 9 },
  sources: { google_people: 10, google_sheets: 3, blinq_csv: 2, other: 0 },
  permissions: {
    contactPointStates: {
      unknown: 14,
      opted_in: 0,
      opted_out: 0,
      reconfirm_required: 0,
      transactional_only: 0,
      other: 0,
    },
    sourceRecordsWithNoPermissionBasis: 15,
    permissionEvents: 0,
    suppressions: 0,
  },
  outreach: { status: "blocked" as const, eligibleContacts: 0 as const, reasons: ["Read only"] },
  freshness: {
    peopleUpdatedAt: null,
    contactPointsUpdatedAt: null,
    sourceRecordsUpdatedAt: null,
    latestUpdatedAt: null,
    observedAt: "2026-08-11T15:00:00.000Z",
  },
};

describe("portfolio CRM registry summary route", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    requireAuthMock.mockResolvedValue({ uid: "owner-1" } as never);
    loadSummaryMock.mockResolvedValue(summary);
  });

  it("returns only the authenticated aggregate contract with no-store headers", async () => {
    const response = await GET(
      new Request("http://localhost/api/crm/registry/summary", {
        headers: { authorization: "Bearer test", "x-correlation-id": "crm-registry-cid" },
      }) as never,
      context() as never
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(response.headers.get("pragma")).toBe("no-cache");
    expect(response.headers.get("x-correlation-id")).toBe("crm-registry-cid");
    expect(payload).toEqual(summary);
    expect(loadSummaryMock).toHaveBeenCalledWith("owner-1", expect.anything());
    expect(JSON.stringify(payload)).not.toContain("workspace_default_owner-1");
  });

  it("rejects every query parameter without calling the registry loader", async () => {
    const response = await GET(
      new Request("http://localhost/api/crm/registry/summary?limit=1") as never,
      context() as never
    );

    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(loadSummaryMock).not.toHaveBeenCalled();
  });

  it("requires Firebase authentication and keeps the failure non-cacheable", async () => {
    requireAuthMock.mockRejectedValue(new ApiError(401, "Unauthorized"));
    const response = await GET(
      new Request("http://localhost/api/crm/registry/summary") as never,
      context() as never
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(loadSummaryMock).not.toHaveBeenCalled();
  });

  it("does not fall back when exact workspace membership is unavailable", async () => {
    loadSummaryMock.mockRejectedValue(new ApiError(409, "Membership could not be reconciled"));
    const response = await GET(
      new Request("http://localhost/api/crm/registry/summary") as never,
      context() as never
    );
    const payload = await response.json();

    expect(response.status).toBe(409);
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(payload.error).toBe("Membership could not be reconciled");
  });
});
