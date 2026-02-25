export type BusinessUnitId = "ai_cofoundry" | "rosser_nft_gallery" | "rt_solutions";
export type BusinessWorkspaceKey = "aicf" | "rng" | "rts" | "rt";

export const BUSINESS_UNIT_OPTIONS: ReadonlyArray<{
  id: BusinessUnitId;
  label: string;
}> = [
  { id: "ai_cofoundry", label: "AI CoFoundry" },
  { id: "rosser_nft_gallery", label: "Rosser NFT Gallery" },
  { id: "rt_solutions", label: "RT Solutions" },
];

export type CrmPipelineStage =
  | "lead_capture"
  | "qualification"
  | "outreach"
  | "booking"
  | "proposal"
  | "deposit_received"
  | "won"
  | "lost";

export const CRM_PIPELINE_STAGE_ORDER: ReadonlyArray<CrmPipelineStage> = [
  "lead_capture",
  "qualification",
  "outreach",
  "booking",
  "proposal",
  "deposit_received",
  "won",
  "lost",
];

const CRM_PIPELINE_STAGE_LABELS: Record<CrmPipelineStage, string> = {
  lead_capture: "Lead Capture",
  qualification: "Qualified",
  outreach: "Outreach",
  booking: "Booking",
  proposal: "Proposal",
  deposit_received: "Deposit",
  won: "Won",
  lost: "Lost",
};

export interface OfferDefinition {
  code: string;
  businessUnit: BusinessUnitId;
  name: string;
  cta: string;
  depositRule: string;
}

export const OFFER_DEFINITIONS: ReadonlyArray<OfferDefinition> = [
  {
    code: "RNG-MINI-REPLICA",
    businessUnit: "rosser_nft_gallery",
    name: "Mini Replica",
    cta: "Buy now / reserve from catalog",
    depositRule: "full_payment",
  },
  {
    code: "RNG-COMMISSION-SCULPTURE",
    businessUnit: "rosser_nft_gallery",
    name: "Custom Sculpture Commission",
    cta: "Request quote + pay deposit",
    depositRule: "50_percent_deposit",
  },
  {
    code: "RNG-HISTORICAL-PRESERVATION",
    businessUnit: "rosser_nft_gallery",
    name: "Historical Preservation + Replica",
    cta: "Book preservation consult",
    depositRule: "40_percent_deposit",
  },
  {
    code: "RNG-PRIVATE-EVENT-RENTAL",
    businessUnit: "rosser_nft_gallery",
    name: "Private Event Rental",
    cta: "Request event date hold",
    depositRule: "30_percent_date_hold",
  },
  {
    code: "RTS-QUICK-WEBSITE-SPRINT",
    businessUnit: "rt_solutions",
    name: "Quick Website Launch Sprint",
    cta: "Book sprint intake + pay deposit",
    depositRule: "50_percent_deposit",
  },
  {
    code: "RTS-AI-LUNCH-LEARN",
    businessUnit: "rt_solutions",
    name: "AI Lunch-and-Learn",
    cta: "Book workshop call",
    depositRule: "40_percent_deposit",
  },
  {
    code: "RTS-AI-TEAM-TRAINING",
    businessUnit: "rt_solutions",
    name: "AI Team Training Workshop",
    cta: "Request training proposal",
    depositRule: "40_percent_deposit",
  },
  {
    code: "RTS-CUSTOM-BUILD-DISCOVERY",
    businessUnit: "rt_solutions",
    name: "Custom Software + AI Build Discovery",
    cta: "Book discovery",
    depositRule: "paid_discovery_required",
  },
  {
    code: "AICF-DISCOVERY",
    businessUnit: "ai_cofoundry",
    name: "AI CoFoundry Discovery",
    cta: "Book discovery",
    depositRule: "paid_discovery_required",
  },
];

export const DEFAULT_OFFER_CODE_BY_BUSINESS: Record<BusinessUnitId, string> = {
  ai_cofoundry: "AICF-DISCOVERY",
  rosser_nft_gallery: "RNG-MINI-REPLICA",
  rt_solutions: "RTS-QUICK-WEBSITE-SPRINT",
};

export function formatCrmPipelineStageLabel(stage: CrmPipelineStage): string {
  return CRM_PIPELINE_STAGE_LABELS[stage];
}

export function normalizeCrmPipelineStage(input: unknown): CrmPipelineStage {
  const value = String(input || "").trim().toLowerCase();
  if (value === "new" || value === "lead_capture" || value === "inquiry" || value === "inbound")
    return "lead_capture";
  if (
    value === "qualification" ||
    value === "qualified" ||
    value === "contacted" ||
    value === "discovery_call" ||
    value === "consultation"
  ) {
    return "qualification";
  }
  if (value === "outreach" || value === "needs_summary" || value === "proposal_sow") return "outreach";
  if (value === "booking" || value === "meeting" || value === "meeting_booked") return "booking";
  if (value === "proposal" || value === "quote_or_package" || value === "capability_plan") return "proposal";
  if (
    value === "deposit" ||
    value === "close_deposit" ||
    value === "deposit_received" ||
    value === "pilot_agreement"
  ) {
    return "deposit_received";
  }
  if (value === "won" || value === "closed" || value === "closed_won" || value === "deploy") return "won";
  if (value === "lost" || value === "closed_lost") return "lost";
  return "lead_capture";
}

export function legacyStatusFromPipelineStage(stage: CrmPipelineStage): "new" | "contacted" | "meeting" | "closed" | "lost" {
  if (stage === "won") return "closed";
  if (stage === "lost") return "lost";
  if (stage === "booking") return "meeting";
  if (stage === "lead_capture") return "new";
  return "contacted";
}

export function isWonStage(stage: unknown): boolean {
  const normalized = normalizeCrmPipelineStage(stage);
  return normalized === "won" || normalized === "deposit_received";
}

export function isMeetingStage(stage: unknown): boolean {
  return normalizeCrmPipelineStage(stage) === "booking";
}

export function isDepositStage(stage: unknown): boolean {
  return normalizeCrmPipelineStage(stage) === "deposit_received";
}

export function normalizeBusinessUnit(input: unknown): BusinessUnitId {
  const value = String(input || "").trim().toLowerCase();
  if (value === "rng" || value === "rosser_nft_gallery") return "rosser_nft_gallery";
  if (value === "rt" || value === "rts" || value === "rt_solutions") return "rt_solutions";
  return "ai_cofoundry";
}

export function businessUnitFromWorkspaceKey(key: BusinessWorkspaceKey): BusinessUnitId {
  if (key === "rng") return "rosser_nft_gallery";
  if (key === "rts" || key === "rt") return "rt_solutions";
  return "ai_cofoundry";
}

export function workspaceKeyFromBusinessUnit(unit: BusinessUnitId): "aicf" | "rng" | "rts" {
  if (unit === "rosser_nft_gallery") return "rng";
  if (unit === "rt_solutions") return "rts";
  return "aicf";
}

export function normalizeOfferCode(input: unknown): string {
  return String(input || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, "")
    .slice(0, 64);
}

export function isOfferCodeForBusinessUnit(unit: BusinessUnitId, input: unknown): boolean {
  const code = normalizeOfferCode(input);
  if (!code) return false;
  return OFFER_DEFINITIONS.some((offer) => offer.businessUnit === unit && offer.code === code);
}

export function resolveOfferCodeForBusinessUnit(
  unit: BusinessUnitId,
  input: unknown
): { offerCode: string; adjusted: boolean; requestedCode: string | null } {
  const requestedCode = normalizeOfferCode(input);
  if (requestedCode && isOfferCodeForBusinessUnit(unit, requestedCode)) {
    return { offerCode: requestedCode, adjusted: false, requestedCode };
  }

  return {
    offerCode: DEFAULT_OFFER_CODE_BY_BUSINESS[unit],
    adjusted: Boolean(requestedCode),
    requestedCode: requestedCode || null,
  };
}

export function findOfferByCode(input: unknown): OfferDefinition | null {
  const code = normalizeOfferCode(input);
  if (!code) return null;
  return OFFER_DEFINITIONS.find((offer) => offer.code === code) || null;
}

export function getOffersForBusinessUnit(unit: BusinessUnitId): OfferDefinition[] {
  return OFFER_DEFINITIONS.filter((offer) => offer.businessUnit === unit);
}

export function getOffersForWorkspaceKey(key: BusinessWorkspaceKey): OfferDefinition[] {
  return getOffersForBusinessUnit(businessUnitFromWorkspaceKey(key));
}
