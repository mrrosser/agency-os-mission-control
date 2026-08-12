import { describe, expect, it } from "vitest";
import { buildWarmReconnectCampaignDraft } from "@/lib/crm/warm-reconnect";
import {
  renderWarmReconnectEmail,
  warmReconnectRendererImplementationFingerprint,
} from "@/lib/crm/warm-reconnect-email-renderer";
import type { PortfolioCrmRegistrySummary } from "@/lib/crm/portfolio-registry-types";

const summary = {
  schemaVersion: 1,
  sourceOfTruth: "firestore_portfolio_registry",
  dataClassification: "aggregate_only",
  readOnly: true,
  registry: { accessRole: "owner" },
  totals: {
    people: 10,
    contactPoints: 4,
    emailContactPoints: 4,
    phoneContactPoints: 0,
    sourceRecords: 4,
    openConflicts: 0,
  },
  brands: { rosser_gallery: 1, rt_solutions: 1, kgclassy: 0, unassigned: 8 },
  sources: { google_people: 4, google_sheets: 0, blinq_csv: 0, other: 0 },
  permissions: {
    contactPointStates: {
      unknown: 4,
      opted_in: 0,
      opted_out: 0,
      reconfirm_required: 0,
      transactional_only: 0,
      other: 0,
    },
    sourceRecordsWithNoPermissionBasis: 4,
    permissionEvents: 0,
    suppressions: 0,
  },
  outreach: { status: "blocked", eligibleContacts: 0, reasons: [] },
  freshness: {
    peopleUpdatedAt: null,
    contactPointsUpdatedAt: null,
    sourceRecordsUpdatedAt: null,
    latestUpdatedAt: null,
    observedAt: "2026-08-12T12:00:00.000Z",
  },
} satisfies PortfolioCrmRegistrySummary;

const preferenceToken = "p".repeat(43);
const unsubscribeOnlyToken = "u".repeat(43);
const preferencesUrl = `https://leadflow-review.web.app/preferences#token=${preferenceToken}`;
const oneClickUrl =
  `https://leadflow-review.web.app/api/crm/warm-reconnect/unsubscribe/${unsubscribeOnlyToken}`;

describe("warm reconnect email renderer", () => {
  it("renders live text, a pinned artwork URL, postal address, and both preference controls", () => {
    const campaign = buildWarmReconnectCampaignDraft(summary);
    const rendered = renderWarmReconnectEmail({
      campaign,
      firstName: "Ari",
      senderName: "Marcus Rosser",
      legalEntity: "Rosser Gallery",
      physicalPostalAddress: "2505 N Tonti St, New Orleans, LA 70117",
      preferencesUrl,
      unsubscribeUrl: oneClickUrl,
      publicOrigin: "https://leadflow-review.web.app",
    });

    expect(rendered.plainText).toContain("Hi Ari,");
    expect(rendered.plainText).toContain("2505 N Tonti St");
    expect(rendered.plainText).toContain("Update preferences:");
    expect(rendered.plainText).toContain("Unsubscribe from all messages:");
    expect(rendered.plainText).toContain(preferencesUrl);
    expect(rendered.plainText).not.toContain(oneClickUrl);
    expect(rendered.html).toContain("glass-braider-black-d53693963446e74b.webp");
    expect(rendered.html).toContain("Update preferences");
    expect(rendered.html).toContain("Unsubscribe");
    expect(rendered.html).toContain(`href="${preferencesUrl}"`);
    expect(rendered.html).not.toContain(oneClickUrl);
    expect(rendered.html).not.toContain("<script");
    expect(rendered.contractFingerprint).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(warmReconnectRendererImplementationFingerprint()).toMatch(
      /^sha256:[a-f0-9]{64}$/
    );
    const drifted = renderWarmReconnectEmail({
      campaign: {
        ...campaign,
        copy: { ...campaign.copy, subject: "Changed after approval" as never },
      },
      firstName: "Ari",
      senderName: "Marcus Rosser",
      legalEntity: "Rosser Gallery",
      physicalPostalAddress: "2505 N Tonti St, New Orleans, LA 70117",
      preferencesUrl,
      unsubscribeUrl: oneClickUrl,
      publicOrigin: "https://leadflow-review.web.app",
    });
    expect(drifted.contractFingerprint).not.toBe(rendered.contractFingerprint);
  });

  it("escapes recipient-visible inputs and rejects non-HTTPS links", () => {
    const campaign = buildWarmReconnectCampaignDraft(summary);
    const base = {
      campaign,
      firstName: "<Ari>",
      senderName: "Marcus Rosser",
      legalEntity: "Rosser Gallery",
      physicalPostalAddress: "2505 N Tonti St, New Orleans, LA 70117",
      preferencesUrl,
      unsubscribeUrl: oneClickUrl,
      publicOrigin: "https://leadflow-review.web.app",
    };
    expect(renderWarmReconnectEmail(base).html).toContain("Hi &lt;Ari&gt;,");
    expect(() =>
      renderWarmReconnectEmail({ ...base, unsubscribeUrl: "http://example.com/out" })
    ).toThrow("Invalid unsubscribe URL");
  });

  it("requires distinct same-origin preference and one-click capabilities", () => {
    const campaign = buildWarmReconnectCampaignDraft(summary);
    const base = {
      campaign,
      firstName: "Ari",
      senderName: "Marcus Rosser",
      legalEntity: "Rosser Gallery",
      physicalPostalAddress: "2505 N Tonti St, New Orleans, LA 70117",
      preferencesUrl,
      unsubscribeUrl: oneClickUrl,
      publicOrigin: "https://leadflow-review.web.app",
    };

    expect(() =>
      renderWarmReconnectEmail({
        ...base,
        unsubscribeUrl:
          `https://leadflow-review.web.app/api/crm/warm-reconnect/unsubscribe/${preferenceToken}`,
      })
    ).toThrow("must be distinct");
    expect(() =>
      renderWarmReconnectEmail({
        ...base,
        preferencesUrl: `https://other.example/preferences#token=${preferenceToken}`,
      })
    ).toThrow("Invalid preferences URL");
  });
});
