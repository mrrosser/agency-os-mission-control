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
  it("keeps owner QA capabilities separate from normal campaign capabilities", () => {
    const campaign = buildWarmReconnectCampaignDraft(summary);
    const input = { campaign, firstName: "Marcus", senderName: "Marcus Rosser", legalEntity: "Marcus Rosser / Rosser Gallery",
      physicalPostalAddress: "2505 N Tonti St, New Orleans, LA 70117", publicOrigin: "https://leadflow-review.web.app",
      contentMode: "preference_buttons" as const, preferencesUrl: `${preferencesUrl}&mode=qa`,
      unsubscribeUrl: oneClickUrl.replace("/unsubscribe/", "/qa/unsubscribe/") };
    const qa = renderWarmReconnectEmail({ ...input, purpose: "owner_qa" });
    expect(qa.html).toContain("&amp;mode=qa&amp;choice=both");
    expect(qa.html).not.toContain("/qa/unsubscribe/");
    expect(() => renderWarmReconnectEmail(input)).toThrow("Invalid preferences URL");
    expect(() => renderWarmReconnectEmail({ ...input, purpose: "owner_qa", preferencesUrl })).toThrow("Invalid preferences URL");
    expect(() => renderWarmReconnectEmail({ ...input, purpose: "owner_qa", unsubscribeUrl: oneClickUrl })).toThrow("Invalid unsubscribe URL");
  });
  it("renders three private choice buttons without artwork and retains the plain-text fallback", () => {
    const campaign = buildWarmReconnectCampaignDraft(summary);
    const rendered = renderWarmReconnectEmail({
      campaign: { ...campaign, artwork: undefined } as never,
      contentMode: "preference_buttons", firstName: "Cody", senderName: "Marcus Rosser",
      legalEntity: "Marcus Rosser / Rosser Gallery", physicalPostalAddress: "2505 N Tonti St, New Orleans, LA 70117",
      preferencesUrl, unsubscribeUrl: oneClickUrl, publicOrigin: "https://leadflow-review.web.app",
    });
    expect(rendered.artworkUrl).toBe("");
    expect(rendered.html).not.toMatch(/<img|<form|<script|<iframe/i);
    expect(rendered.plainText).toContain("Hi Cody,");
    for (const choice of ["rosser_gallery", "rt_solutions", "both"]) {
      expect(rendered.html).toContain(`${preferencesUrl}&amp;choice=${choice}`);
      expect(rendered.plainText).toContain(`${preferencesUrl}&choice=${choice}`);
    }
    expect(rendered.html).toContain("confirm your choice on the next page");
    expect(rendered.html).toContain("2505 N Tonti St");
    expect(rendered.html).toContain('href="https://rossergallery.com"');
    expect(rendered.html).toContain('href="https://rt.solutions"');
    expect(rendered.html).not.toContain(oneClickUrl);
    expect(rendered.plainText).not.toContain(oneClickUrl);
    expect(rendered.html).toContain(`href="${preferencesUrl}" style="color:inherit">Unsubscribe from all messages`);
  });

  it("renders explicit plain text without reading artwork while preserving the real footer and preferences", () => {
    const campaign = buildWarmReconnectCampaignDraft(summary);
    const base = {
      campaign, firstName: "Ari", senderName: "Marcus Rosser", legalEntity: "RT.Solutions",
      physicalPostalAddress: "2505 N Tonti St, New Orleans, LA 70117", preferencesUrl,
      unsubscribeUrl: oneClickUrl, publicOrigin: "https://leadflow-review.web.app",
    };
    const artwork = renderWarmReconnectEmail(base);
    const plain = renderWarmReconnectEmail({ ...base, contentMode: "plain_text" });
    expect(plain.contentMode).toBe("plain_text");
    expect(plain.html).toBe("");
    expect(plain.artworkUrl).toBe("");
    expect(plain.plainText).toBe(artwork.plainText);
    expect(plain.plainText).toContain("RT.Solutions");
    expect(plain.plainText).toContain(base.physicalPostalAddress);
    expect(plain.plainText).toContain(`Unsubscribe from all messages: ${preferencesUrl}`);
    expect(plain.plainText).not.toContain(oneClickUrl);
    expect(plain.contractFingerprint).not.toBe(artwork.contractFingerprint);
    expect(() => renderWarmReconnectEmail({
      ...base, contentMode: "plain_text", campaign: { ...campaign, artwork: undefined } as never,
    })).not.toThrow();
    expect(() => renderWarmReconnectEmail({ ...base, contentMode: "unknown" as never }))
      .toThrow("Invalid warm reconnect content mode");
    expect(() => renderWarmReconnectEmail({
      ...base, contentMode: "plain_text", preferencesUrl: "https://other.example/preferences#token=" + preferenceToken,
    })).toThrow("Invalid preferences URL");
  });

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
