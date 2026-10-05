import React from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WarmReconnectCampaign } from "@/components/crm/warm-reconnect-campaign";
import { WarmReconnectActivation } from "@/components/crm/warm-reconnect-activation";
import { buildWarmReconnectCampaignDraft } from "@/lib/crm/warm-reconnect";
import type { PortfolioCrmRegistrySummary } from "@/lib/crm/portfolio-registry-types";

const hookState = vi.hoisted(() => ({ values: null as unknown[] | null, index: 0 }));
const authState = vi.hoisted(() => ({ user: null as { uid: string } | null }));

vi.mock("@/components/providers/auth-provider", () => ({
  useAuth: () => authState,
}));

vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof import("react")>();
  return {
    ...react,
    useState: (initial: unknown) => {
      const index = hookState.index++;
      return react.useState(
        hookState.values && index < hookState.values.length ? hookState.values[index] : initial
      );
    },
  };
});

function activationFixture(providerExecutionEnabled: unknown, approved = false) {
  return {
    googleProfiles: [],
    candidates: [],
    candidateSummary: { eligibleForReview: 0, returned: 0, excluded: 0, truncated: false },
    constraints: { providerExecutionEnabled },
    pilots: [{
      pilotId: "fixture-pilot",
      status: approved ? "approved" : "needs_campaign_approval",
      contentMode: "plain_text",
      recipients: [],
      gates: [],
      approval: approved ? { expiresAt: "2030-01-01T00:00:00.000Z" } : null,
      availableActions: { canApprove: false, canLaunch: approved, canStop: true },
    }],
  };
}

function launchButton(html: string): string | undefined {
  return html.match(/<button\b[^>]*>[\s\S]*?<\/button>/g)
    ?.find((button) => button.includes("Authorize exact five-email launch"));
}

function loadedActivation(providerExecutionEnabled: unknown, approved = false, error: string | null = null) {
  authState.user = { uid: "synthetic-owner" };
  hookState.values = [activationFixture(providerExecutionEnabled, approved), authState.user.uid, false, error];
}

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
  beforeEach(() => {
    hookState.values = null;
    hookState.index = 0;
    authState.user = null;
  });

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
    expect(source).toContain("<WarmReconnectActivation");
    expect(source).not.toMatch(/warm-reconnect\/send|warm-reconnect\/draft/);
  });

  it("renders the activation desk fail-closed before an authenticated contract loads", () => {
    const html = renderToStaticMarkup(<WarmReconnectActivation campaign={null} />);

    expect(html).toContain("Activation desk · controlled pilot");
    expect(html).toContain("Permission first. Approval and launch stay separate.");
    expect(html).toContain("No pilot exists. Approval and launch have zero authority.");
    expect(html).toContain("Launch is the separate action that authorizes those five Gmail sends.");
    expect(html).toContain("Provider execution status is unknown until live controls load.");
    expect(html).not.toContain("Provider execution is currently disabled.");
    expect(html).not.toContain("Launch approved pilot");
  });

  it.each([true, false])("renders the loaded provider setting without granting launch authority: %s", (enabled) => {
    loadedActivation(enabled);
    const html = renderToStaticMarkup(<WarmReconnectActivation campaign={null} />);

    expect(html).toContain(enabled
      ? "Provider execution is enabled."
      : "Provider execution is currently disabled.");
    expect(html).toContain("The provider setting does not approve or launch a pilot.");
    expect(html).not.toContain(enabled
      ? "provider currently disabled"
      : "provider enabled");
    expect(launchButton(html)).toContain(enabled
      ? "Authorize exact five-email launch · provider enabled"
      : "Authorize exact five-email launch · provider currently disabled");
    expect(launchButton(html)).toContain('disabled=""');
  });

  it("shows the approved design in an inert preview without enabling an unapproved launch", () => {
    const activation = activationFixture(false);
    Object.assign(activation.pilots[0], {
      contentMode: "approved_design_v2",
      emailPreview: {
        designVersion: "rosser-rt-library-kit-v1",
        recipientId: "synthetic-recipient",
        greetingName: "Alex",
        subject: "A quick hello from Marcus",
        plainText: "Hi Alex,\nSynthetic reviewed text.",
        html: "<!doctype html><html><body><p>Hi Alex,</p><a>Choose Rosser Gallery</a></body></html>",
      },
    });
    authState.user = { uid: "synthetic-owner" };
    hookState.values = [activation, authState.user.uid, false, null];
    const html = renderToStaticMarkup(<WarmReconnectActivation campaign={null} />);
    expect(html).toContain("Approved v2 design with inline artwork");
    expect(html).toContain("Preview for Alex");
    expect(html).toContain('title="Approved campaign email preview"');
    expect(html).toContain('sandbox=""');
    expect(html).toContain('referrerPolicy="no-referrer"');
    expect(html).toContain("Links are inactive");
    expect(launchButton(html)).toContain('disabled=""');
  });

  it.each([true, false])("preserves the approved pilot's launch control when provider status is %s", (enabled) => {
    loadedActivation(enabled, true);
    const html = renderToStaticMarkup(<WarmReconnectActivation campaign={null} />);

    expect(launchButton(html)).toBeDefined();
    expect(launchButton(html)).not.toContain('disabled=""');
  });

  it.each([undefined, null, "true"])("shows unknown for an absent or malformed provider setting: %s", (enabled) => {
    loadedActivation(enabled);
    const html = renderToStaticMarkup(<WarmReconnectActivation campaign={null} />);

    expect(html).toContain("Provider execution status is unknown until live controls load.");
    expect(launchButton(html)).toContain("provider status unknown");
    expect(html).not.toContain("Provider execution is currently disabled.");
    expect(html).not.toContain("Provider execution is enabled.");
  });

  it("shows unknown after an error instead of reusing the prior disabled status", () => {
    loadedActivation(false, false, "Activation controls unavailable");
    const html = renderToStaticMarkup(<WarmReconnectActivation campaign={null} />);

    expect(html).toContain("Activation controls unavailable");
    expect(html).toContain("Provider execution status is unknown until live controls load.");
    expect(launchButton(html)).toContain("provider status unknown");
    expect(html).not.toContain("provider currently disabled");
  });

  it("withholds a previously loaded owner's controls immediately after a user change", () => {
    loadedActivation(true, true);
    authState.user = { uid: "different-synthetic-owner" };
    const html = renderToStaticMarkup(<WarmReconnectActivation campaign={null} />);

    expect(html).toContain("Provider execution status is unknown until live controls load.");
    expect(html).toContain("No pilot exists. Approval and launch have zero authority.");
    expect(launchButton(html)).toBeUndefined();
    expect(html).not.toContain("fixture-pilot");
  });

  it("keeps Google consent and pilot mutations on exact bounded routes", () => {
    const source = readFileSync(
      join(process.cwd(), "components", "crm", "warm-reconnect-activation.tsx"),
      "utf8"
    );
    const connectionClient = readFileSync(
      join(process.cwd(), "components", "crm", "google-sender-connection-client.ts"),
      "utf8"
    );

    expect(source).toContain('const ACTIVATION_ROUTE = "/api/crm/warm-reconnect/activation"');
    expect(connectionClient).toContain('scopePreset: "gmail_send"');
    expect(connectionClient).toContain('returnTo: "/dashboard/crm"');
    expect(source).not.toContain(
      "profileId: profile.profileId,\n          idempotencyKey,"
    );
    expect(connectionClient).toContain('authUrl.hostname !== "accounts.google.com"');
    expect(source).toContain("availableActions.canApprove");
    expect(source).toContain("availableActions.canLaunch");
    expect(source).toContain("acknowledgeLaunchAuthorizesExactFiveEmailSend: true");
    expect(source).toContain("!activation.candidateSummary.truncated");
    expect(source).toContain("no partial audience can be approved");
    expect(source).not.toMatch(/console\.(?:log|info|warn|error)/);
  });
});
