import React from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WarmReconnectCampaign } from "@/components/crm/warm-reconnect-campaign";
import { WarmReconnectActivation } from "@/components/crm/warm-reconnect-activation";
import { buildWarmReconnectCampaignDraft } from "@/lib/crm/warm-reconnect";
import type { PortfolioCrmRegistrySummary } from "@/lib/crm/portfolio-registry-types";

const hookState = vi.hoisted(() => ({
  values: null as unknown[] | null, overrides: {} as Record<number, unknown>, index: 0,
  interactive: false, refs: [] as Array<{ current: unknown }>, refIndex: 0,
}));
const authState = vi.hoisted(() => ({ user: null as { uid: string } | null }));

vi.mock("@/components/providers/auth-provider", () => ({
  useAuth: () => authState,
}));

vi.mock("@/lib/api/client", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/api/client")>(),
  buildAuthHeaders: vi.fn(async () => ({ Authorization: "Bearer synthetic-test-token" })),
}));

vi.mock("@/components/crm/google-sender-connection-client", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/components/crm/google-sender-connection-client")>(),
  requestGoogleSenderConnection: vi.fn(async () => { throw new Error("Synthetic connection did not finish"); }),
}));

vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof import("react")>();
  return {
    ...react,
    useState: (initial: unknown) => {
      const index = hookState.index++;
      if (hookState.interactive) {
        const values = hookState.values ||= [];
        if (!(index in values)) values[index] = Object.hasOwn(hookState.overrides, index)
          ? hookState.overrides[index] : typeof initial === "function" ? initial() : initial;
        return [values[index], (next: unknown) => {
          values[index] = typeof next === "function" ? next(values[index]) : next;
        }];
      }
      return react.useState(
        Object.hasOwn(hookState.overrides, index) ? hookState.overrides[index]
          : hookState.values && index < hookState.values.length ? hookState.values[index] : initial
      );
    },
    useRef: (initial: unknown) => {
      if (!hookState.interactive) return react.useRef(initial);
      const index = hookState.refIndex++;
      return hookState.refs[index] ||= { current: initial };
    },
    useEffect: (effect: React.EffectCallback, deps?: React.DependencyList) => {
      if (!hookState.interactive) react.useEffect(effect, deps);
    },
    useCallback: (callback: (...args: never[]) => unknown, deps: React.DependencyList) =>
      hookState.interactive ? callback : react.useCallback(callback, deps),
    useMemo: (factory: () => unknown, deps: React.DependencyList) =>
      hookState.interactive ? factory() : react.useMemo(factory, deps),
  };
});

function activationFixture(providerExecutionEnabled: unknown, approved = false) {
  return {
    schemaVersion: "crm.warm-reconnect-activation.v1",
    dataClassification: "authenticated_contact_review",
    providerActions: "none",
    workspace: { accessRole: "owner" },
    googleProfiles: [],
    candidates: [],
    candidateSummary: { eligibleForReview: 0, returned: 0, excluded: 0, truncated: false },
    constraints: { providerExecutionEnabled },
    control: {
      initialPilotId: "fixture-pilot" as string | null,
      activePilotId: "fixture-pilot" as string | null,
      followOnParentPilotId: null as string | null,
      canCreateInitialPilot: false,
      blockedReason: null as string | null,
    },
    history: { pageSize: 20, after: null as string | null, nextCursor: null as string | null, pilotIds: ["fixture-pilot"] },
    pilots: [{
      pilotId: "fixture-pilot",
      status: approved ? "approved" : "needs_campaign_approval",
      contentMode: "plain_text",
      fingerprints: { artifactFingerprint: "artifact", audienceFingerprint: "audience", actionFingerprint: "action" },
      recipients: [],
      gates: [],
      approval: approved ? { approvalId: "synthetic-approval", expiresAt: "2030-01-01T00:00:00.000Z" } : null,
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

function completedInitialFixture() {
  const activation = activationFixture(true);
  const recipient = (id: string, name: string) => ({
    recipientId: id, displayName: name, email: `${id}@example.test`,
    greetingName: name.split(" ")[0],
    permissionState: "unknown", sourceEvidence: [], decision: { status: "eligible" },
  });
  const oldRecipients = Array.from({ length: 5 }, (_, index) => recipient(`invited-${index + 1}`, `Invited ${index + 1}`));
  return {
    ...activation,
    googleProfiles: [{
      profileId: "rosser_gallery_send", businessId: "rosser_nft_gallery", label: "Gallery",
      connected: true, gmailCapable: true, accountEmail: "mrosser@rossergallery.com", state: "connected",
    }],
    candidates: Array.from({ length: 21 }, (_, index) => recipient(`next-${index + 1}`, `Next ${index + 1}`)),
    control: { ...activation.control, initialPilotId: "completed-initial" as string | null, activePilotId: null as string | null, followOnParentPilotId: "completed-initial" as string | null },
    history: { ...activation.history, pilotIds: ["completed-initial"] },
    pilots: [{
      ...activation.pilots[0], pilotId: "completed-initial", status: "launch_requested",
      tranche: "initial_5", recipientCap: 5, recipients: oldRecipients,
      campaignPreviewFingerprint: buildWarmReconnectCampaignDraft(summary).review.previewFingerprint,
      sender: {
        senderName: "Marcus Rosser", legalEntity: "Marcus Rosser / Rosser Gallery",
        fromEmail: "mrosser@rossergallery.com", replyTo: "mrosser@rossergallery.com",
        physicalPostalAddress: "2505 N Tonti St, New Orleans, LA 70117", profileId: "rosser_gallery_send",
      },
      availableActions: { canApprove: false, canLaunch: false, canStop: false },
    }],
  };
}

function loadCompletedInitialResults(complete: boolean, selected: string[] = []) {
  const activation = completedInitialFixture();
  if (!complete) {
    activation.control.activePilotId = "completed-initial";
    activation.control.followOnParentPilotId = null;
  }
  authState.user = { uid: "synthetic-owner" };
  hookState.values = [activation, authState.user.uid, false, null];
  hookState.overrides[4] = selected;
  // Parent component's results state; the child results panel keeps its own loading state.
  hookState.overrides[15] = {
    ownerUid: authState.user.uid,
    data: { pilots: [{ pilotId: "completed-initial", complete }], pilotsTruncated: false },
  };
  return activation;
}

function buttonContaining(html: string, label: string) {
  return html.match(/<button\b[^>]*>[\s\S]*?<\/button>/g)?.find((button) => button.includes(label));
}

function treeText(node: React.ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(treeText).join("");
  return React.isValidElement<{ children?: React.ReactNode }>(node) ? treeText(node.props.children) : "";
}

function treeButton(node: React.ReactNode, label: string): React.ReactElement<{ onClick: () => void; disabled?: boolean }> | undefined {
  if (Array.isArray(node)) return node.map(child => treeButton(child, label)).find(Boolean);
  if (!React.isValidElement<{ children?: React.ReactNode; onClick?: () => void; disabled?: boolean }>(node)) return undefined;
  if (node.props.onClick && treeText(node).trim().startsWith(label)) return node as React.ReactElement<{ onClick: () => void; disabled?: boolean }>;
  return treeButton(node.props.children, label);
}

function renderInteractive() {
  hookState.index = 0;
  hookState.refIndex = 0;
  return WarmReconnectActivation({ campaign: buildWarmReconnectCampaignDraft(summary) });
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
    hookState.overrides = {};
    hookState.index = 0;
    hookState.interactive = false;
    hookState.refs = [];
    hookState.refIndex = 0;
    authState.user = null;
    vi.unstubAllGlobals();
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
    expect(html).toContain("Prepare a recipient list before approving and starting a batch.");
    expect(html).toContain("Each list is reviewed before sending");
    expect(launchButton(html)).toBeUndefined();
    expect(buttonContaining(html, "Approve exact pilot")).toBeUndefined();
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
    expect(html).toContain("Approval covers only this recipient list and the reviewed email for 24 hours.");
    expect(html).not.toContain(enabled
      ? "provider currently disabled"
      : "provider enabled");
    expect(launchButton(html)).toContain(enabled
      ? "Authorize exact five-email launch"
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

  it("offers a guarded return to review for an expired launch without enabling send", () => {
    const activation = activationFixture(true);
    Object.assign(activation.pilots[0], {
      status: "launch_requested",
      approval: { approvalId: "expired-approval", expiresAt: "2020-01-01T00:00:00Z" },
      availableActions: { canApprove: false, canLaunch: false, canStop: true, canReturnToReview: true },
    });
    authState.user = { uid: "synthetic-owner" };
    hookState.values = [activation, authState.user.uid, false, null];
    const html = renderToStaticMarkup(<WarmReconnectActivation campaign={null} />);
    expect(html).toContain("This launch approval expired");
    expect(html).toContain("This sends nothing; approval and launch will be required again");
    expect(html).toContain('aria-label="Return to review reason"');
    const recovery = html.match(/<button\b[^>]*>[\s\S]*?<\/button>/g)?.find(button => button.includes("Check and return to review"));
    expect(recovery).toContain('disabled=""');
    expect(launchButton(html)).toContain('disabled=""');
    expect(html).not.toContain("Approve exact pilot");
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
    expect(html).toContain("Prepare a recipient list before approving and starting a batch.");
    expect(launchButton(html)).toBeUndefined();
    expect(html).not.toContain("fixture-pilot");
  });

  it.each([1, 4, 10, 11, 20])("offers a reviewed follow-on list of %i after proven completion and excludes old recipients", (count) => {
    loadCompletedInitialResults(true, Array.from({ length: count }, (_, index) => `next-${index + 1}`));
    const html = renderToStaticMarkup(<WarmReconnectActivation campaign={buildWarmReconnectCampaignDraft(summary)} />);

    expect(html).toContain("Select 1–20");
    expect(html).toContain("Keep the approved email");
    expect(html).toContain("next-1@example.test");
    expect(html).not.toContain("invited-1@example.test");
    expect(buttonContaining(html, "Prepare next batch for review")).toBeDefined();
    expect(buttonContaining(html, "Prepare next batch for review")).not.toContain('disabled=""');
    expect(launchButton(html)).toBeUndefined();
    expect(buttonContaining(html, "Start approved")).toBeUndefined();
    if (count === 20) {
      const extraCandidate = html.match(/<label\b[^>]*>[\s\S]*?<\/label>/g)?.find((label) => label.includes("next-21@example.test"));
      expect(extraCandidate).toContain('disabled=""');
    }
  });

  it.each([false, null])("does not infer completed-parent authority from launch status with results %j", (completion) => {
    loadCompletedInitialResults(false, ["next-1"]);
    if (completion === null) hookState.overrides[15] = null;
    const html = renderToStaticMarkup(<WarmReconnectActivation campaign={null} />);
    expect(html).not.toContain("Select 1–20");
    expect(buttonContaining(html, "Prepare next batch for review")).toBeUndefined();
    expect(html).toContain("invited-1@example.test");
    expect(launchButton(html)).toContain('disabled=""');
  });

  it("does not prepare a twenty-one-person selection even when client state is oversized", () => {
    loadCompletedInitialResults(true, Array.from({ length: 21 }, (_, index) => `next-${index + 1}`));
    const html = renderToStaticMarkup(<WarmReconnectActivation campaign={buildWarmReconnectCampaignDraft(summary)} />);
    expect(buttonContaining(html, "Prepare next batch for review")).toContain('disabled=""');
  });

  it.each([false, true])("labels an active three-recipient batch and requires its explicit approval to launch: %s", (approved) => {
    const activation = completedInitialFixture();
    activation.pilots[0] = {
      ...activation.pilots[0], pilotId: "follow-on-pilot", tranche: "follow_on", recipientCap: 3,
      status: approved ? "approved" : "needs_campaign_approval",
      recipients: activation.candidates.slice(0, 3),
      approval: approved ? { approvalId: "synthetic-approval", expiresAt: "2030-01-01T00:00:00.000Z" } : null,
      availableActions: { canApprove: !approved, canLaunch: approved, canStop: true },
    };
    activation.control.activePilotId = "follow-on-pilot";
    activation.control.followOnParentPilotId = null;
    activation.history.pilotIds = ["follow-on-pilot"];
    authState.user = { uid: "synthetic-owner" };
    hookState.values = [activation, authState.user.uid, false, null];
    const html = renderToStaticMarkup(<WarmReconnectActivation campaign={null} />);
    const launch = buttonContaining(html, "Start approved 3-email batch");
    expect(launch).toBeDefined();
    expect(launchButton(html)).toBeUndefined();
    if (approved) expect(launch).not.toContain('disabled=""');
    else {
      expect(launch).toContain('disabled=""');
      expect(html).toContain("Exact 3-person audience");
      expect(html).not.toContain("Exact five-person audience");
    }
  });

  it("keeps the authoritative 21st batch active despite a full history page and truncated results", () => {
    const activation = completedInitialFixture();
    const head = {
      ...activation.pilots[0], pilotId: "zz-current-batch", tranche: "follow_on", recipientCap: 3,
      recipients: activation.candidates.slice(0, 3), status: "approved",
      approval: { approvalId: "synthetic-approval", expiresAt: "2030-01-01T00:00:00.000Z" },
      availableActions: { canApprove: false, canLaunch: true, canStop: true },
    };
    const page = Array.from({ length: 20 }, (_, index) => ({
      ...head, pilotId: `history-${String(index + 1).padStart(2, "0")}`, status: "stopped", recipients: [],
    }));
    activation.pilots = [...page, head];
    activation.control.activePilotId = head.pilotId;
    activation.control.followOnParentPilotId = null;
    activation.history.pilotIds = page.map(row => row.pilotId);
    activation.history.nextCursor = page[19].pilotId;
    authState.user = { uid: "synthetic-owner" };
    hookState.values = [activation, authState.user.uid, false, null];
    hookState.overrides[15] = { ownerUid: authState.user.uid, data: {
      pilots: [{ pilotId: page[0].pilotId, complete: true }], pilotsTruncated: true,
    } };

    const html = renderToStaticMarkup(<WarmReconnectActivation campaign={buildWarmReconnectCampaignDraft(summary)} />);
    expect(html).toContain("Current batch: zz-current-batch");
    expect(html).toContain("20 batches on this page; more pages available.");
    expect(html).toContain("listed by document ID, not date");
    expect(html).toContain("next-1@example.test");
    expect(buttonContaining(html, "Start approved 3-email batch")).not.toContain('disabled=""');
    expect(buttonContaining(html, "Prepare next batch for review")).toBeUndefined();
  });

  it("uses the exact completed parent outside the history and results pages", () => {
    const activation = loadCompletedInitialResults(true, ["next-1"]);
    const parent = { ...activation.pilots[0], pilotId: "zz-completed-parent", tranche: "follow_on", batchSequence: 20 };
    const historical = { ...activation.pilots[0], pilotId: "history-01", status: "stopped", recipients: [] };
    activation.pilots = [historical, parent];
    activation.control.followOnParentPilotId = parent.pilotId;
    activation.history.pilotIds = [historical.pilotId];
    hookState.overrides[15] = { ownerUid: authState.user!.uid, data: { pilots: [], pilotsTruncated: true } };

    const html = renderToStaticMarkup(<WarmReconnectActivation campaign={buildWarmReconnectCampaignDraft(summary)} />);
    expect(html).toContain("Completed parent batch: zz-completed-parent");
    expect(buttonContaining(html, "Prepare next batch for review")).not.toContain('disabled=""');
    expect(launchButton(html)).toBeUndefined();
  });

  it.each(["control", "history"] as const)("withholds controls when %s metadata is absent", (field) => {
    const activation = activationFixture(true, true);
    delete (activation as Partial<typeof activation>)[field];
    authState.user = { uid: "synthetic-owner" };
    hookState.values = [activation, authState.user.uid, false, null];
    const html = renderToStaticMarkup(<WarmReconnectActivation campaign={null} />);
    expect(launchButton(html)).toBeUndefined();
    expect(html).not.toContain("fixture-pilot");
    expect(html).toContain("Provider execution status is unknown");
  });

  it("shows the stored neutral greeting without substituting the contact label", () => {
    const activation = loadCompletedInitialResults(false);
    activation.pilots[0].recipients[0].displayName = "Contact";
    activation.pilots[0].recipients[0].greetingName = "there";
    const html = renderToStaticMarkup(<WarmReconnectActivation campaign={null} />);
    expect(html).toContain("Email greeting: Hi there,");
    expect(html).not.toContain("Email greeting: Hi Contact,");
  });

  it("allows initial preparation only when the server explicitly permits it", () => {
    const activation = completedInitialFixture();
    activation.pilots = [];
    activation.history.pilotIds = [];
    activation.control = { initialPilotId: null, activePilotId: null, followOnParentPilotId: null, canCreateInitialPilot: true, blockedReason: null };
    authState.user = { uid: "synthetic-owner" };
    hookState.values = [activation, authState.user.uid, false, null];
    hookState.overrides[4] = activation.candidates.slice(0, 5).map(row => row.recipientId);
    hookState.overrides[5] = {
      senderName: "Synthetic Sender", legalEntity: "Synthetic Entity", replyTo: "sender@example.test",
      physicalPostalAddress: "123 Example Street", profileId: "rosser_gallery_send", contentMode: "plain_text",
      artworkEvidenceNote: "", artworkApproved: false,
    };
    let html = renderToStaticMarkup(<WarmReconnectActivation campaign={buildWarmReconnectCampaignDraft(summary)} />);
    expect(buttonContaining(html, "Prepare exact five-person review")).not.toContain('disabled=""');

    activation.control.canCreateInitialPilot = false;
    activation.control.blockedReason = "Reconcile the campaign before preparing another batch.";
    hookState.index = 0;
    html = renderToStaticMarkup(<WarmReconnectActivation campaign={buildWarmReconnectCampaignDraft(summary)} />);
    expect(html).toContain(activation.control.blockedReason);
    expect(buttonContaining(html, "Prepare exact five-person review")).toContain('disabled=""');
  });

  it("pages history with GET requests while keeping the exact active batch visible", async () => {
    const first = activationFixture(true, true);
    const history = { ...first.pilots[0], pilotId: "history-01", status: "stopped" };
    first.pilots.unshift(history);
    first.history.pilotIds = [history.pilotId];
    first.history.nextCursor = history.pilotId;
    const next = structuredClone(first);
    next.pilots[0].pilotId = "history-02";
    next.history = { pageSize: 20, after: history.pilotId, nextCursor: null, pilotIds: ["history-02"] };
    authState.user = { uid: "synthetic-owner" };
    hookState.values = [first, authState.user.uid, false, null];
    hookState.interactive = true;
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json(next)).mockResolvedValueOnce(Response.json(first));
    vi.stubGlobal("fetch", fetchMock);

    treeButton(renderInteractive(), "Next history page")!.props.onClick();
    await vi.waitFor(() => expect(hookState.values?.[2]).toBe(false));
    let tree = renderInteractive();
    expect(treeText(tree)).toContain("Current batch: fixture-pilot");
    expect(treeText(tree)).toContain("history-02");
    expect(treeButton(tree, "Next history page")!.props.disabled).toBe(true);
    expect(treeButton(tree, "First history page")!.props.disabled).toBe(false);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/crm/warm-reconnect/activation?historyAfter=history-01");

    treeButton(tree, "First history page")!.props.onClick();
    await vi.waitFor(() => expect(hookState.values?.[2]).toBe(false));
    tree = renderInteractive();
    expect(treeText(tree)).toContain("Current batch: fixture-pilot");
    expect(treeButton(tree, "First history page")!.props.disabled).toBe(true);
    expect(fetchMock.mock.calls[1][0]).toBe("/api/crm/warm-reconnect/activation");
    expect(fetchMock.mock.calls.every(([, options]) => options.method === "GET")).toBe(true);
  });

  it("retains the verified head after a failed page load and pauses launch until refresh succeeds", async () => {
    const activation = completedInitialFixture();
    activation.control.activePilotId = "completed-initial";
    activation.control.followOnParentPilotId = null;
    activation.pilots[0].availableActions.canLaunch = true;
    activation.pilots[0].approval = { approvalId: "synthetic-approval", expiresAt: "2030-01-01T00:00:00.000Z" };
    activation.history.nextCursor = "history-20";
    authState.user = { uid: "synthetic-owner" };
    hookState.values = [activation, authState.user.uid, false, null];
    hookState.interactive = true;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ error: "History page unavailable" }, { status: 503 }))
      .mockResolvedValueOnce(Response.json(activation));
    vi.stubGlobal("fetch", fetchMock);

    treeButton(renderInteractive(), "Next history page")!.props.onClick();
    await vi.waitFor(() => expect(hookState.values?.[3]).toBe("History page unavailable"));
    let tree = renderInteractive();
    expect(treeText(tree)).toContain("Current batch: completed-initial");
    const launch = treeButton(tree, "Authorize exact five-email launch")!;
    expect(launch.props.disabled).toBe(true);
    launch.props.onClick();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Connecting clears the display error but cannot refresh campaign authority.
    treeButton(tree, "Reconnect Gallery")!.props.onClick();
    await vi.waitFor(() => expect(hookState.values?.[11]).toBe("Synthetic connection did not finish"));
    expect(hookState.values?.[3]).toBeNull();
    tree = renderInteractive();
    expect(treeButton(tree, "Authorize exact five-email launch")!.props.disabled).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    treeButton(tree, "Refresh controls")!.props.onClick();
    await vi.waitFor(() => expect(hookState.values?.[2]).toBe(false));
    tree = renderInteractive();
    expect(hookState.values?.[3]).toBeNull();
    expect(treeButton(tree, "Authorize exact five-email launch")!.props.disabled).toBe(false);
    expect(fetchMock.mock.calls.every(([, options]) => options.method === "GET")).toBe(true);

    // An ambiguous mutation also requires a fresh read, even if another flow
    // clears the shared display error afterward.
    fetchMock.mockResolvedValueOnce(Response.json({ error: "Launch outcome unavailable" }, { status: 503 }));
    treeButton(tree, "Authorize exact five-email launch")!.props.onClick();
    await vi.waitFor(() => expect(hookState.values?.[3]).toBe("Launch outcome unavailable"));
    expect(fetchMock.mock.calls[2][1].method).toBe("POST");
    tree = renderInteractive();
    treeButton(tree, "Reconnect Gallery")!.props.onClick();
    await vi.waitFor(() => expect(hookState.values?.[11]).toBe("Synthetic connection did not finish"));
    tree = renderInteractive();
    expect(hookState.values?.[3]).toBeNull();
    expect(treeButton(tree, "Authorize exact five-email launch")!.props.disabled).toBe(true);
    treeButton(tree, "Authorize exact five-email launch")!.props.onClick();
    expect(fetchMock).toHaveBeenCalledTimes(3);
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
