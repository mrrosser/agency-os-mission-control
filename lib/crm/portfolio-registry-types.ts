export const PORTFOLIO_CRM_SCHEMA_VERSION = 1 as const;

export const PORTFOLIO_CRM_BRANDS = [
  "rosser_gallery",
  "rt_solutions",
  "kgclassy",
] as const;

export const PORTFOLIO_CRM_SOURCE_SYSTEMS = [
  "google_people",
  "google_sheets",
  "blinq_csv",
] as const;

export const PORTFOLIO_CRM_PERMISSION_STATES = [
  "unknown",
  "opted_in",
  "opted_out",
  "reconfirm_required",
  "transactional_only",
] as const;

export type PortfolioCrmBrand = (typeof PORTFOLIO_CRM_BRANDS)[number];
export type PortfolioCrmSourceSystem = (typeof PORTFOLIO_CRM_SOURCE_SYSTEMS)[number];
export type PortfolioCrmPermissionState = (typeof PORTFOLIO_CRM_PERMISSION_STATES)[number];

export interface PortfolioCrmRegistrySummary {
  schemaVersion: typeof PORTFOLIO_CRM_SCHEMA_VERSION;
  sourceOfTruth: "firestore_portfolio_registry";
  dataClassification: "aggregate_only";
  readOnly: true;
  registry: {
    accessRole: "owner" | "admin";
  };
  totals: {
    people: number;
    contactPoints: number;
    emailContactPoints: number;
    phoneContactPoints: number;
    sourceRecords: number;
    openConflicts: number;
  };
  brands: Record<PortfolioCrmBrand, number> & {
    unassigned: number;
  };
  sources: Record<PortfolioCrmSourceSystem, number> & {
    other: number;
  };
  permissions: {
    contactPointStates: Record<PortfolioCrmPermissionState, number> & {
      other: number;
    };
    sourceRecordsWithNoPermissionBasis: number;
    permissionEvents: number;
    suppressions: number;
  };
  outreach: {
    status: "blocked";
    eligibleContacts: 0;
    reasons: string[];
  };
  freshness: {
    peopleUpdatedAt: string | null;
    contactPointsUpdatedAt: string | null;
    sourceRecordsUpdatedAt: string | null;
    latestUpdatedAt: string | null;
    observedAt: string;
  };
}
