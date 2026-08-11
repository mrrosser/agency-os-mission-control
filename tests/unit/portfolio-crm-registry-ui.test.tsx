import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PortfolioRegistrySummary } from "@/components/crm/portfolio-registry-summary";
import type { PortfolioCrmRegistrySummary } from "@/lib/crm/portfolio-registry-types";

const summary: PortfolioCrmRegistrySummary = {
  schemaVersion: 1,
  sourceOfTruth: "firestore_portfolio_registry",
  dataClassification: "aggregate_only",
  readOnly: true,
  registry: { accessRole: "owner" },
  totals: {
    people: 1_830,
    contactPoints: 2_097,
    emailContactPoints: 403,
    phoneContactPoints: 1_694,
    sourceRecords: 1_915,
    openConflicts: 0,
  },
  brands: { rosser_gallery: 120, rt_solutions: 1, kgclassy: 0, unassigned: 1_709 },
  sources: { google_people: 1_687, google_sheets: 134, blinq_csv: 94, other: 0 },
  permissions: {
    contactPointStates: {
      unknown: 2_097,
      opted_in: 0,
      opted_out: 0,
      reconfirm_required: 0,
      transactional_only: 0,
      other: 0,
    },
    sourceRecordsWithNoPermissionBasis: 1_915,
    permissionEvents: 0,
    suppressions: 0,
  },
  outreach: {
    status: "blocked",
    eligibleContacts: 0,
    reasons: ["No canonical permission events are recorded."],
  },
  freshness: {
    peopleUpdatedAt: "2026-07-21T23:04:01.000Z",
    contactPointsUpdatedAt: "2026-07-21T23:04:04.000Z",
    sourceRecordsUpdatedAt: "2026-07-21T23:04:03.000Z",
    latestUpdatedAt: "2026-07-21T23:04:04.000Z",
    observedAt: "2026-08-11T15:00:00.000Z",
  },
};

describe("portfolio registry summary UI", () => {
  it("renders exact aggregate evidence, a mobile grid, and a prominent block", () => {
    const html = renderToStaticMarkup(
      <PortfolioRegistrySummary summary={summary} loading={false} error={null} />
    );

    expect(html).toContain("Portfolio contact registry");
    expect(html).toContain("Outreach blocked");
    expect(html).toContain("1,830");
    expect(html).toContain("2,097");
    expect(html).toContain("Google People");
    expect(html).toContain("grid-cols-2");
    expect(html).toContain('data-testid="portfolio-crm-outreach-blocked"');
    expect(html).not.toContain("workspace_default_owner-1");
  });

  it("fails closed when aggregate evidence cannot be loaded", () => {
    const html = renderToStaticMarkup(
      <PortfolioRegistrySummary summary={null} loading={false} error="Membership not reconciled" />
    );

    expect(html).toContain("Portfolio registry unavailable — outreach blocked");
    expect(html).toContain("Membership not reconciled");
  });
});
