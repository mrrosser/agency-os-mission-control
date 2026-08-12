import React from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WarmReconnectCampaign } from "@/components/crm/warm-reconnect-campaign";
import { buildWarmReconnectCampaignDraft } from "@/lib/crm/warm-reconnect";
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
  outreach: { status: "blocked", eligibleContacts: 0, reasons: ["Read only"] },
  freshness: {
    peopleUpdatedAt: null,
    contactPointsUpdatedAt: null,
    sourceRecordsUpdatedAt: null,
    latestUpdatedAt: null,
    observedAt: "2026-08-12T15:00:00.000Z",
  },
};

describe("warm reconnect campaign UI", () => {
  it("renders the copy, owned artwork, exact aggregates, and zero-authority boundary", () => {
    const html = renderToStaticMarkup(
      <WarmReconnectCampaign
        campaign={buildWarmReconnectCampaignDraft(summary)}
        loading={false}
        error={null}
      />
    );

    expect(html).toContain("A thoughtful way back into the conversation");
    expect(html).toContain("A quick hello from Marcus");
    expect(html).toContain("RT.Solutions");
    expect(html).toContain("1,709");
    expect(html).toContain("403");
    expect(html).toContain("Eligible recipients");
    expect(html).toContain("No contacts selected · nothing drafted or sent");
    expect(html).toContain("preference link required");
    expect(html).toContain("zero send authority");
    expect(html).toContain("glass-braider-black-d53693963446e74b.webp");
    expect(html).toContain(buildWarmReconnectCampaignDraft(summary).review.previewFingerprint);
    expect(html).toContain('disabled=""');
    expect(html).not.toMatch(/Send campaign|Create Gmail draft|Select recipients/i);
  });

  it("fails closed without a review contract", () => {
    const html = renderToStaticMarkup(
      <WarmReconnectCampaign campaign={null} loading={false} error="Registry unavailable" />
    );

    expect(html).toContain("campaign remains blocked");
    expect(html).toContain("Registry unavailable");
  });

  it("uses the returned email-contact count and labels the loading region", () => {
    const campaign = buildWarmReconnectCampaignDraft({
      ...summary,
      totals: { ...summary.totals, emailContactPoints: 4 },
    });
    const readyHtml = renderToStaticMarkup(
      <WarmReconnectCampaign campaign={campaign} loading={false} error={null} />
    );
    const loadingHtml = renderToStaticMarkup(
      <WarmReconnectCampaign campaign={null} loading error={null} />
    );

    expect(readyHtml).toContain("The 4 email entries are contact points");
    expect(readyHtml).not.toContain("The 403 email entries");
    expect(loadingHtml).toContain('aria-labelledby="warm-reconnect-heading"');
    expect(loadingHtml).toContain('id="warm-reconnect-heading"');
  });

  it("mounts the GET-only review beneath the aggregate CRM without send controls", () => {
    const source = readFileSync(
      join(process.cwd(), "app", "dashboard", "crm", "page.tsx"),
      "utf8"
    );

    expect(source).toContain('fetch("/api/crm/warm-reconnect/review"');
    expect(source).toContain('method: "GET"');
    expect(source).toContain("warmReconnectAbortRef.current?.abort()");
    expect(source).toContain("signal: controller.signal");
    expect(source).toContain("warmReconnectAbortRef.current !== controller");
    expect(source).toContain("setPortfolioRegistry(null)");
    expect(source).toContain("setWarmReconnectCampaign(null)");
    expect(source).not.toContain('fetch("/api/crm/registry/summary"');
    expect(source).toContain("<WarmReconnectCampaign");
    expect(source).not.toMatch(/warm-reconnect\/send|warm-reconnect\/draft/);
  });
});
