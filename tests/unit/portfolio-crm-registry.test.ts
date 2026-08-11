import { describe, expect, it, vi } from "vitest";
import type { Firestore } from "firebase-admin/firestore";
import { ApiError } from "@/lib/api/handler";
import {
  assertPortfolioRegistryAccess,
  buildPortfolioCrmSummary,
  PORTFOLIO_CRM_MAX_READ_OPERATIONS,
  portfolioRegistryWorkspaceIdForUid,
} from "@/lib/crm/portfolio-registry";

const access = {
  workspaceId: "workspace_default_owner-1",
  role: "owner" as const,
};

function aggregateInput() {
  return {
    access,
    totals: {
      people: 1_830,
      contactPoints: 2_097,
      emailContactPoints: 403,
      phoneContactPoints: 1_694,
      sourceRecords: 1_915,
      openConflicts: 0,
    },
    brandCounts: { rosser_gallery: 120, rt_solutions: 1, kgclassy: 0 },
    brandedPeople: 121,
    sourceCounts: { google_people: 1_687, google_sheets: 134, blinq_csv: 94 },
    permissionStateCounts: {
      unknown: 2_097,
      opted_in: 0,
      opted_out: 0,
      reconfirm_required: 0,
      transactional_only: 0,
    },
    sourceRecordsWithNoPermissionBasis: 1_915,
    permissionEvents: 0,
    suppressions: 0,
    freshness: {
      peopleUpdatedAt: "2026-07-21T23:04:01.000Z",
      contactPointsUpdatedAt: "2026-07-21T23:04:04.000Z",
      sourceRecordsUpdatedAt: "2026-07-21T23:04:03.000Z",
    },
    observedAt: "2026-08-11T15:00:00.000Z",
  };
}

function fakeAccessDb(options?: {
  workspace?: Record<string, unknown> | null;
  members?: Array<Record<string, unknown>>;
}) {
  const workspace =
    options?.workspace === undefined
      ? { name: "Portfolio Registry", status: "active", ownerUid: "owner-1" }
      : options.workspace;
  const members = options?.members ?? [{ status: "active", role: "owner" }];
  const memberQuery = {
    where: vi.fn(),
    limit: vi.fn(),
    get: vi.fn(async () => ({ docs: members.map((member) => ({ data: () => member })) })),
  };
  memberQuery.where.mockReturnValue(memberQuery);
  memberQuery.limit.mockReturnValue(memberQuery);

  const db = {
    collection: vi.fn((name: string) => {
      if (name === "workspaces") {
        return {
          doc: vi.fn(() => ({
            get: vi.fn(async () => ({
              exists: Boolean(workspace),
              data: () => workspace || undefined,
            })),
          })),
        };
      }
      if (name === "workspace_members") return memberQuery;
      throw new Error(`Unexpected collection: ${name}`);
    }),
  };
  return db as unknown as Firestore;
}

describe("portfolio CRM registry", () => {
  it("builds an aggregate-only, outreach-blocked summary with exact segments", () => {
    const summary = buildPortfolioCrmSummary(aggregateInput());

    expect(summary).toMatchObject({
      schemaVersion: 1,
      sourceOfTruth: "firestore_portfolio_registry",
      dataClassification: "aggregate_only",
      readOnly: true,
      registry: { accessRole: "owner" },
      totals: { people: 1_830, contactPoints: 2_097, emailContactPoints: 403 },
      brands: { rosser_gallery: 120, rt_solutions: 1, unassigned: 1_709 },
      sources: { google_people: 1_687, google_sheets: 134, blinq_csv: 94, other: 0 },
      outreach: { status: "blocked", eligibleContacts: 0 },
    });
    expect(summary.outreach.reasons).toEqual(
      expect.arrayContaining([
        "No canonical permission events are recorded.",
        "No canonical suppression evidence is recorded.",
        "Every canonical contact point has unknown permission.",
      ])
    );
    expect(summary.freshness.latestUpdatedAt).toBe("2026-07-21T23:04:04.000Z");
    expect(JSON.stringify(summary)).not.toContain(access.workspaceId);
  });

  it("derives one exact source workspace and rejects unsafe identifiers", () => {
    expect(PORTFOLIO_CRM_MAX_READ_OPERATIONS).toBe(26);
    expect(portfolioRegistryWorkspaceIdForUid("owner-1")).toBe("workspace_default_owner-1");
    expect(() => portfolioRegistryWorkspaceIdForUid(" ")).toThrow(ApiError);
    expect(() => portfolioRegistryWorkspaceIdForUid("owner/other")).toThrow(ApiError);
  });

  it("requires an active owned workspace and exactly one active privileged membership", async () => {
    await expect(assertPortfolioRegistryAccess("owner-1", fakeAccessDb())).resolves.toEqual(access);

    await expect(
      assertPortfolioRegistryAccess(
        "owner-1",
        fakeAccessDb({ workspace: { status: "active", ownerUid: "someone-else" } })
      )
    ).rejects.toMatchObject({ status: 403 });

    await expect(
      assertPortfolioRegistryAccess(
        "owner-1",
        fakeAccessDb({ members: [{ status: "active", role: "owner" }, { status: "active", role: "admin" }] })
      )
    ).rejects.toMatchObject({ status: 409 });

    await expect(
      assertPortfolioRegistryAccess(
        "owner-1",
        fakeAccessDb({ members: [{ status: "inactive", role: "owner" }] })
      )
    ).rejects.toMatchObject({ status: 403 });
  });
});
