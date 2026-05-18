export type ControlPlaneHealth = "operational" | "degraded" | "offline";
export type AutonomyClass =
  | "read_only"
  | "internal_write"
  | "spend_bearing"
  | "public_facing"
  | "financial_or_credentialed";
export type BudgetGovernorMode = "observe" | "hard-stop";
export type BudgetProviderState = "ok" | "warning" | "blocked" | "unconfigured";
export type CustomerMemorySource = "paperclip" | "firestore_projected" | "mission_control";

export interface PaperclipControlSnapshot {
  state: ControlPlaneHealth;
  configured: boolean;
  reachable: boolean;
  canProxyActions: boolean;
  baseUrl: string | null;
  sourceOfTruth: "paperclip" | "visibility_only" | "mission_control";
  companyCount: number | null;
  agentCount: number | null;
  activeRunCount: number | null;
  detail: string;
  capabilities: {
    lifecycleActions: boolean;
    heartbeats: boolean;
    budgets: boolean;
    audit: boolean;
    mobile: boolean;
  };
}

export interface GovernanceInput {
  globalKillSwitchEnabled: boolean;
  providerKillSwitches: string[];
  businessKillSwitches: string[];
  approvalRequiredClasses: AutonomyClass[];
}

export interface GovernanceSnapshot {
  state: ControlPlaneHealth;
  operatorMode: "mission_control_proxy";
  failClosed: boolean;
  defaultAutonomyClass: AutonomyClass;
  approvalRequiredClasses: AutonomyClass[];
  trustEnvelopeFields: string[];
  globalKillSwitchEnabled: boolean;
  providerKillSwitches: string[];
  businessKillSwitches: string[];
  detail: string;
}

export interface BudgetProviderInput {
  providerId: string;
  label: string;
  actualUsd: number | null;
  estimatedUsd: number | null;
  unreconciledUsd?: number | null;
  hardLimitUsd: number | null;
  writeEnabled: boolean;
  killSwitchEnabled?: boolean;
}

export interface BudgetProviderSnapshot {
  providerId: string;
  label: string;
  state: BudgetProviderState;
  actualUsd: number | null;
  estimatedUsd: number;
  unreconciledUsd: number;
  totalUsd: number;
  hardLimitUsd: number | null;
  writeEnabled: boolean;
  killSwitchEnabled: boolean;
  detail: string;
}

export interface BudgetGovernorInput {
  mode: BudgetGovernorMode;
  monthBudgetUsd: number | null;
  projectedMonthEndUsd: number | null;
  providers: BudgetProviderInput[];
  globalKillSwitchEnabled: boolean;
}

export interface BudgetGovernorSnapshot {
  state: ControlPlaneHealth;
  mode: BudgetGovernorMode;
  monthBudgetUsd: number | null;
  monthToDateActualUsd: number;
  monthToDateEstimatedUsd: number;
  monthToDateUnreconciledUsd: number;
  monthToDateTotalUsd: number;
  projectedMonthEndUsd: number | null;
  blockedProviders: string[];
  hardStopActive: boolean;
  providers: BudgetProviderSnapshot[];
  detail: string;
}

export interface CustomerMemoryInput {
  sourceOfTruth: CustomerMemorySource;
  knownContacts: number;
  recentTimelineEvents: number;
  lastTimelineAt: string | null;
  emailReady: boolean;
  smsReady: boolean;
  voiceReady: boolean;
  calendarReady: boolean;
  socialReady: boolean;
  posReady: boolean;
  paidAdsReady: boolean;
  duplicateProtection: boolean;
  dncProtection: boolean;
}

export interface CustomerMemorySnapshot {
  state: ControlPlaneHealth;
  sourceOfTruth: CustomerMemorySource;
  knownContacts: number;
  recentTimelineEvents: number;
  lastTimelineAt: string | null;
  channels: Array<{
    id: string;
    label: string;
    enabled: boolean;
  }>;
  duplicateProtection: boolean;
  dncProtection: boolean;
  detail: string;
}

export interface ProductCatalogInput {
  catalogSource: string;
  businessUnitCount: number;
  activeOfferCount: number;
  approvalGated: boolean;
}

export interface ProductCatalogSnapshot {
  state: ControlPlaneHealth;
  catalogSource: string;
  businessUnitCount: number;
  activeOfferCount: number;
  approvalGated: boolean;
  detail: string;
}

export interface AdOpsInput {
  metaAdsConfigured: boolean;
  googleAdsConfigured: boolean;
  metaAdsWriteEnabled: boolean;
  googleAdsWriteEnabled: boolean;
  approvalGated: boolean;
}

export interface AdOpsSnapshot {
  state: ControlPlaneHealth;
  approvalGated: boolean;
  providers: Array<{
    providerId: "meta_ads" | "google_ads";
    configured: boolean;
    writeEnabled: boolean;
  }>;
  detail: string;
}

export interface ProfitAttributionInput {
  pipelineValueUsd: number;
  leadsSourced: number;
  depositsCollected: number;
  dealsWon: number;
  monthToDateSpendUsd: number;
}

export interface ProfitAttributionSnapshot {
  state: ControlPlaneHealth;
  attributionMode: "weighted_multi_touch";
  monthToDateSpendUsd: number;
  pipelineValueUsd: number;
  leadsSourced: number;
  depositsCollected: number;
  dealsWon: number;
  costPerLeadUsd: number | null;
  costPerDepositUsd: number | null;
  blendedRoas: number | null;
  detail: string;
}

export interface MobileOpsInput {
  deepLinkBaseUrl: string | null;
  googleSpaceReady: boolean;
  lifecycleActionsEnabled: boolean;
}

export interface MobileOpsSnapshot {
  state: ControlPlaneHealth;
  operatorMode: "web_google_space";
  deepLinkBaseUrl: string | null;
  googleSpaceReady: boolean;
  supportsApprovals: boolean;
  supportsBudgetAlerts: boolean;
  supportsIncidentAcks: boolean;
  supportsLifecycleActions: boolean;
  detail: string;
}

export interface ReliabilityInput {
  targetSloPct: number;
  primaryRegion: string | null;
  failoverRegion: string | null;
  healthEndpointEnabled: boolean;
  queueHealth: ControlPlaneHealth;
  paperclipState: ControlPlaneHealth;
}

export interface ReliabilitySnapshot {
  state: ControlPlaneHealth;
  targetSloPct: number;
  primaryRegion: string | null;
  failoverRegion: string | null;
  healthEndpointEnabled: boolean;
  warmFailoverReady: boolean;
  detail: string;
}

export interface AutonomousBusinessSnapshot {
  paperclip: PaperclipControlSnapshot;
  governance: GovernanceSnapshot;
  budgetGovernor: BudgetGovernorSnapshot;
  customerMemory: CustomerMemorySnapshot;
  productCatalog: ProductCatalogSnapshot;
  adOps: AdOpsSnapshot;
  profitAttribution: ProfitAttributionSnapshot;
  mobileOps: MobileOpsSnapshot;
  reliability: ReliabilitySnapshot;
}

function roundUsd(value: number): number {
  return Math.round(value * 100) / 100;
}

function asUsd(value: number | null | undefined): number {
  if (!Number.isFinite(value ?? NaN)) return 0;
  return Math.max(0, roundUsd(value as number));
}

export function buildGovernanceSnapshot(input: GovernanceInput): GovernanceSnapshot {
  const providerKillSwitches = input.providerKillSwitches.filter(Boolean);
  const businessKillSwitches = input.businessKillSwitches.filter(Boolean);
  const state: ControlPlaneHealth =
    input.globalKillSwitchEnabled || providerKillSwitches.length > 0 || businessKillSwitches.length > 0
      ? "degraded"
      : "operational";

  const detail = input.globalKillSwitchEnabled
    ? "Global kill switch is enabled. Consequential actions fail closed until an operator clears it."
    : providerKillSwitches.length > 0 || businessKillSwitches.length > 0
      ? `Scoped kill switches active for ${providerKillSwitches.length} provider(s) and ${businessKillSwitches.length} business unit(s).`
      : "Mission Control is the operator proxy. Consequential actions require scoped trust-envelope metadata and approval-class checks.";

  return {
    state,
    operatorMode: "mission_control_proxy",
    failClosed: true,
    defaultAutonomyClass: "internal_write",
    approvalRequiredClasses: input.approvalRequiredClasses,
    trustEnvelopeFields: [
      "agent_id",
      "scope",
      "trust_level",
      "evidence_ref",
      "run_id",
      "correlation_id",
    ],
    globalKillSwitchEnabled: input.globalKillSwitchEnabled,
    providerKillSwitches,
    businessKillSwitches,
    detail,
  };
}

export function buildBudgetGovernorSnapshot(input: BudgetGovernorInput): BudgetGovernorSnapshot {
  const providers = input.providers.map((provider) => {
    const actualUsd = provider.actualUsd === null ? null : asUsd(provider.actualUsd);
    const estimatedUsd = asUsd(provider.estimatedUsd);
    const unreconciledUsd = asUsd(provider.unreconciledUsd);
    const totalUsd = roundUsd((actualUsd || 0) + estimatedUsd + unreconciledUsd);
    const overLimit = provider.hardLimitUsd !== null && totalUsd > provider.hardLimitUsd;
    const state: BudgetProviderState = provider.killSwitchEnabled
      ? "blocked"
      : provider.hardLimitUsd === null
        ? "unconfigured"
        : overLimit
          ? "blocked"
          : totalUsd >= provider.hardLimitUsd * 0.85
            ? "warning"
            : "ok";

    let detail = provider.writeEnabled
      ? "Provider writes are enabled."
      : "Provider writes are not enabled.";
    if (provider.killSwitchEnabled) {
      detail = "Provider kill switch is enabled.";
    } else if (provider.hardLimitUsd !== null) {
      detail = `${detail} Limit $${provider.hardLimitUsd.toFixed(2)}.`;
    } else {
      detail = `${detail} No hard budget configured yet.`;
    }

    return {
      providerId: provider.providerId,
      label: provider.label,
      state,
      actualUsd,
      estimatedUsd,
      unreconciledUsd,
      totalUsd,
      hardLimitUsd: provider.hardLimitUsd,
      writeEnabled: provider.writeEnabled,
      killSwitchEnabled: Boolean(provider.killSwitchEnabled),
      detail,
    } satisfies BudgetProviderSnapshot;
  });

  const monthToDateActualUsd = roundUsd(
    providers.reduce((sum, provider) => sum + (provider.actualUsd || 0), 0)
  );
  const monthToDateEstimatedUsd = roundUsd(
    providers.reduce((sum, provider) => sum + provider.estimatedUsd, 0)
  );
  const monthToDateUnreconciledUsd = roundUsd(
    providers.reduce((sum, provider) => sum + provider.unreconciledUsd, 0)
  );
  const monthToDateTotalUsd = roundUsd(
    monthToDateActualUsd + monthToDateEstimatedUsd + monthToDateUnreconciledUsd
  );
  const blockedProviders = providers
    .filter((provider) => provider.state === "blocked")
    .map((provider) => provider.providerId);
  const overBudget =
    input.monthBudgetUsd !== null && monthToDateTotalUsd > input.monthBudgetUsd;
  const hardStopActive =
    input.mode === "hard-stop" &&
    (input.globalKillSwitchEnabled || blockedProviders.length > 0 || overBudget);

  const state: ControlPlaneHealth = hardStopActive
    ? "offline"
    : blockedProviders.length > 0 || overBudget || providers.some((provider) => provider.state === "warning")
      ? "degraded"
      : "operational";

  const detail = input.globalKillSwitchEnabled
    ? "Budget governor is blocked by the global kill switch."
    : hardStopActive
      ? "Hard-stop budget governor is actively blocking spend-bearing actions."
      : overBudget
        ? "Month-to-date spend exceeds the configured global budget."
        : "Budget governor is evaluating provider, business, and workflow spend in hard-stop mode.";

  return {
    state,
    mode: input.mode,
    monthBudgetUsd: input.monthBudgetUsd,
    monthToDateActualUsd,
    monthToDateEstimatedUsd,
    monthToDateUnreconciledUsd,
    monthToDateTotalUsd,
    projectedMonthEndUsd:
      input.projectedMonthEndUsd === null ? null : roundUsd(input.projectedMonthEndUsd),
    blockedProviders,
    hardStopActive,
    providers,
    detail,
  };
}

export function buildCustomerMemorySnapshot(input: CustomerMemoryInput): CustomerMemorySnapshot {
  const channels = [
    { id: "email", label: "Email", enabled: input.emailReady },
    { id: "sms", label: "SMS", enabled: input.smsReady },
    { id: "voice", label: "Voice", enabled: input.voiceReady },
    { id: "calendar", label: "Calendar", enabled: input.calendarReady },
    { id: "social", label: "Social", enabled: input.socialReady },
    { id: "pos", label: "POS", enabled: input.posReady },
    { id: "paid_ads", label: "Paid Ads", enabled: input.paidAdsReady },
  ];
  const enabledChannels = channels.filter((channel) => channel.enabled).length;
  const state: ControlPlaneHealth =
    input.duplicateProtection && input.dncProtection && enabledChannels >= 4
      ? "operational"
      : enabledChannels >= 2
        ? "degraded"
        : "offline";

  const sourceLabel =
    input.sourceOfTruth === "paperclip"
      ? "Paperclip"
      : input.sourceOfTruth === "firestore_projected"
        ? "Firestore projection"
        : "Mission Control";

  return {
    state,
    sourceOfTruth: input.sourceOfTruth,
    knownContacts: input.knownContacts,
    recentTimelineEvents: input.recentTimelineEvents,
    lastTimelineAt: input.lastTimelineAt,
    channels,
    duplicateProtection: input.duplicateProtection,
    dncProtection: input.dncProtection,
    detail: `${sourceLabel} customer memory with ${enabledChannels}/${channels.length} active channels and ${input.knownContacts} known contact(s).`,
  };
}

export function buildProductCatalogSnapshot(input: ProductCatalogInput): ProductCatalogSnapshot {
  return {
    state: input.activeOfferCount > 0 ? "operational" : "degraded",
    catalogSource: input.catalogSource,
    businessUnitCount: input.businessUnitCount,
    activeOfferCount: input.activeOfferCount,
    approvalGated: input.approvalGated,
    detail: `${input.activeOfferCount} offer(s) across ${input.businessUnitCount} business unit(s), approval-gated before consequential external writes.`,
  };
}

export function buildAdOpsSnapshot(input: AdOpsInput): AdOpsSnapshot {
  const providers = [
    {
      providerId: "meta_ads" as const,
      configured: input.metaAdsConfigured,
      writeEnabled: input.metaAdsWriteEnabled,
    },
    {
      providerId: "google_ads" as const,
      configured: input.googleAdsConfigured,
      writeEnabled: input.googleAdsWriteEnabled,
    },
  ];
  const configuredCount = providers.filter((provider) => provider.configured).length;
  const writeEnabledCount = providers.filter((provider) => provider.writeEnabled).length;
  const state: ControlPlaneHealth =
    configuredCount === providers.length && writeEnabledCount > 0
      ? "operational"
      : configuredCount > 0
        ? "degraded"
        : "offline";

  return {
    state,
    approvalGated: input.approvalGated,
    providers,
    detail:
      configuredCount === 0
        ? "Meta Ads and Google Ads control paths are not configured yet."
        : `${configuredCount}/2 ad providers configured, ${writeEnabledCount}/2 write-enabled, approval-gated through Mission Control.`,
  };
}

export function buildProfitAttributionSnapshot(
  input: ProfitAttributionInput
): ProfitAttributionSnapshot {
  const spend = asUsd(input.monthToDateSpendUsd);
  const costPerLeadUsd =
    input.leadsSourced > 0 && spend > 0 ? roundUsd(spend / input.leadsSourced) : null;
  const costPerDepositUsd =
    input.depositsCollected > 0 && spend > 0
      ? roundUsd(spend / input.depositsCollected)
      : null;
  const blendedRoas =
    spend > 0 && input.pipelineValueUsd > 0
      ? roundUsd(input.pipelineValueUsd / spend)
      : null;

  const state: ControlPlaneHealth =
    blendedRoas !== null && blendedRoas >= 3
      ? "operational"
      : spend > 0 || input.pipelineValueUsd > 0
        ? "degraded"
        : "offline";

  return {
    state,
    attributionMode: "weighted_multi_touch",
    monthToDateSpendUsd: spend,
    pipelineValueUsd: roundUsd(Math.max(0, input.pipelineValueUsd || 0)),
    leadsSourced: Math.max(0, Math.round(input.leadsSourced || 0)),
    depositsCollected: Math.max(0, Math.round(input.depositsCollected || 0)),
    dealsWon: Math.max(0, Math.round(input.dealsWon || 0)),
    costPerLeadUsd,
    costPerDepositUsd,
    blendedRoas,
    detail:
      blendedRoas === null
        ? "Profit attribution is collecting spend and pipeline data, but ROAS is not yet fully measurable."
        : `Weighted multi-touch attribution is live with blended ROAS ${blendedRoas.toFixed(2)}x.`,
  };
}

export function buildMobileOpsSnapshot(input: MobileOpsInput): MobileOpsSnapshot {
  const state: ControlPlaneHealth =
    input.deepLinkBaseUrl && input.googleSpaceReady
      ? "operational"
      : input.deepLinkBaseUrl || input.googleSpaceReady
        ? "degraded"
        : "offline";

  return {
    state,
    operatorMode: "web_google_space",
    deepLinkBaseUrl: input.deepLinkBaseUrl,
    googleSpaceReady: input.googleSpaceReady,
    supportsApprovals: true,
    supportsBudgetAlerts: true,
    supportsIncidentAcks: true,
    supportsLifecycleActions: input.lifecycleActionsEnabled,
    detail:
      state === "operational"
        ? "Mobile operator path is ready through Mission Control web plus Google Space alerts."
        : "Mobile operator path is partial. Configure deep links and Google Space webhooks for phone-first operations.",
  };
}

export function buildReliabilitySnapshot(input: ReliabilityInput): ReliabilitySnapshot {
  const warmFailoverReady = Boolean(input.primaryRegion && input.failoverRegion);
  const state: ControlPlaneHealth =
    input.queueHealth === "operational" &&
    input.paperclipState !== "offline" &&
    input.healthEndpointEnabled &&
    warmFailoverReady
      ? "operational"
      : input.healthEndpointEnabled
        ? "degraded"
        : "offline";

  return {
    state,
    targetSloPct: roundUsd(input.targetSloPct),
    primaryRegion: input.primaryRegion,
    failoverRegion: input.failoverRegion,
    healthEndpointEnabled: input.healthEndpointEnabled,
    warmFailoverReady,
    detail:
      state === "operational"
        ? `Reliability target ${input.targetSloPct.toFixed(1)}% with primary/failover regions configured.`
        : `Reliability target ${input.targetSloPct.toFixed(1)}% is declared, but regional failover and/or queue health still needs hardening.`,
  };
}

export function buildAutonomousBusinessSnapshot(input: {
  paperclip: PaperclipControlSnapshot;
  governance: GovernanceInput;
  budgetGovernor: BudgetGovernorInput;
  customerMemory: CustomerMemoryInput;
  productCatalog: ProductCatalogInput;
  adOps: AdOpsInput;
  profitAttribution: ProfitAttributionInput;
  mobileOps: MobileOpsInput;
  reliability: Omit<ReliabilityInput, "paperclipState">;
}): AutonomousBusinessSnapshot {
  const governance = buildGovernanceSnapshot(input.governance);
  const budgetGovernor = buildBudgetGovernorSnapshot(input.budgetGovernor);
  const customerMemory = buildCustomerMemorySnapshot(input.customerMemory);
  const productCatalog = buildProductCatalogSnapshot(input.productCatalog);
  const adOps = buildAdOpsSnapshot(input.adOps);
  const profitAttribution = buildProfitAttributionSnapshot(input.profitAttribution);
  const mobileOps = buildMobileOpsSnapshot(input.mobileOps);
  const reliability = buildReliabilitySnapshot({
    ...input.reliability,
    paperclipState: input.paperclip.state,
  });

  return {
    paperclip: input.paperclip,
    governance,
    budgetGovernor,
    customerMemory,
    productCatalog,
    adOps,
    profitAttribution,
    mobileOps,
    reliability,
  };
}
