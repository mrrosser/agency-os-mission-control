import "server-only";

import type { DocumentData, Firestore, Query } from "firebase-admin/firestore";
import { ApiError } from "@/lib/api/handler";
import { getAdminDb } from "@/lib/firebase-admin";
import type { Logger } from "@/lib/logging";
import {
  PORTFOLIO_CRM_BRANDS,
  PORTFOLIO_CRM_PERMISSION_STATES,
  PORTFOLIO_CRM_SCHEMA_VERSION,
  PORTFOLIO_CRM_SOURCE_SYSTEMS,
  type PortfolioCrmBrand,
  type PortfolioCrmPermissionState,
  type PortfolioCrmRegistrySummary,
  type PortfolioCrmSourceSystem,
} from "@/lib/crm/portfolio-registry-types";

const COLLECTIONS = {
  workspaces: "workspaces",
  workspaceMembers: "workspace_members",
  people: "crm_people",
  contactPoints: "crm_contact_points",
  sourceRecords: "crm_source_records",
  importConflicts: "crm_import_conflicts",
  permissionEvents: "crm_permission_events",
  suppressions: "crm_suppressions",
} as const;

// Two access reads plus this fixed aggregate/freshness plan. The route accepts
// no caller-supplied filters or pagination, so its Firestore cost is bounded.
export const PORTFOLIO_CRM_MAX_READ_OPERATIONS = 26;

type RegistryAccess = {
  workspaceId: string;
  role: "owner" | "admin";
};

export interface PortfolioCrmAggregateInput {
  access: RegistryAccess;
  totals: {
    people: number;
    contactPoints: number;
    emailContactPoints: number;
    phoneContactPoints: number;
    sourceRecords: number;
    openConflicts: number;
  };
  brandCounts: Record<PortfolioCrmBrand, number>;
  brandedPeople: number;
  sourceCounts: Record<PortfolioCrmSourceSystem, number>;
  permissionStateCounts: Record<PortfolioCrmPermissionState, number>;
  sourceRecordsWithNoPermissionBasis: number;
  permissionEvents: number;
  suppressions: number;
  freshness: {
    peopleUpdatedAt: string | null;
    contactPointsUpdatedAt: string | null;
    sourceRecordsUpdatedAt: string | null;
  };
  observedAt?: string;
}

function boundedCount(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : 0;
}

function latestIso(values: Array<string | null>): string | null {
  let latest: string | null = null;
  let latestMs = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    if (!value) continue;
    const parsed = Date.parse(value);
    if (!Number.isFinite(parsed) || parsed <= latestMs) continue;
    latest = new Date(parsed).toISOString();
    latestMs = parsed;
  }
  return latest;
}

export function portfolioRegistryWorkspaceIdForUid(uid: string): string {
  const normalized = String(uid || "").trim();
  if (!normalized || normalized.length > 128 || normalized.includes("/")) {
    throw new ApiError(403, "Portfolio CRM registry access is not available for this account.");
  }
  return `workspace_default_${normalized}`;
}

export function buildPortfolioCrmSummary(
  input: PortfolioCrmAggregateInput
): PortfolioCrmRegistrySummary {
  const people = boundedCount(input.totals.people);
  const contactPoints = boundedCount(input.totals.contactPoints);
  const sourceRecords = boundedCount(input.totals.sourceRecords);
  const brandedPeople = Math.min(people, boundedCount(input.brandedPeople));
  const knownSources = PORTFOLIO_CRM_SOURCE_SYSTEMS.reduce(
    (total, source) => total + boundedCount(input.sourceCounts[source]),
    0
  );
  const knownPermissionStates = PORTFOLIO_CRM_PERMISSION_STATES.reduce(
    (total, state) => total + boundedCount(input.permissionStateCounts[state]),
    0
  );
  const permissionEvents = boundedCount(input.permissionEvents);
  const suppressions = boundedCount(input.suppressions);
  const unknownPoints = boundedCount(input.permissionStateCounts.unknown);
  const noPermissionBasis = boundedCount(input.sourceRecordsWithNoPermissionBasis);

  const reasons = [
    "This aggregate-only registry never authorizes outreach or provider actions.",
  ];
  if (permissionEvents === 0) {
    reasons.push("No canonical permission events are recorded.");
  }
  if (suppressions === 0) {
    reasons.push("No canonical suppression evidence is recorded.");
  }
  if (contactPoints > 0 && unknownPoints === contactPoints) {
    reasons.push("Every canonical contact point has unknown permission.");
  }
  if (sourceRecords > 0 && noPermissionBasis === sourceRecords) {
    reasons.push("Every source record has permission basis none.");
  }

  const peopleUpdatedAt = input.freshness.peopleUpdatedAt;
  const contactPointsUpdatedAt = input.freshness.contactPointsUpdatedAt;
  const sourceRecordsUpdatedAt = input.freshness.sourceRecordsUpdatedAt;

  return {
    schemaVersion: PORTFOLIO_CRM_SCHEMA_VERSION,
    sourceOfTruth: "firestore_portfolio_registry",
    dataClassification: "aggregate_only",
    readOnly: true,
    registry: {
      accessRole: input.access.role,
    },
    totals: {
      people,
      contactPoints,
      emailContactPoints: boundedCount(input.totals.emailContactPoints),
      phoneContactPoints: boundedCount(input.totals.phoneContactPoints),
      sourceRecords,
      openConflicts: boundedCount(input.totals.openConflicts),
    },
    brands: {
      rosser_gallery: boundedCount(input.brandCounts.rosser_gallery),
      rt_solutions: boundedCount(input.brandCounts.rt_solutions),
      kgclassy: boundedCount(input.brandCounts.kgclassy),
      unassigned: Math.max(0, people - brandedPeople),
    },
    sources: {
      google_people: boundedCount(input.sourceCounts.google_people),
      google_sheets: boundedCount(input.sourceCounts.google_sheets),
      blinq_csv: boundedCount(input.sourceCounts.blinq_csv),
      other: Math.max(0, sourceRecords - knownSources),
    },
    permissions: {
      contactPointStates: {
        unknown: boundedCount(input.permissionStateCounts.unknown),
        opted_in: boundedCount(input.permissionStateCounts.opted_in),
        opted_out: boundedCount(input.permissionStateCounts.opted_out),
        reconfirm_required: boundedCount(input.permissionStateCounts.reconfirm_required),
        transactional_only: boundedCount(input.permissionStateCounts.transactional_only),
        other: Math.max(0, contactPoints - knownPermissionStates),
      },
      sourceRecordsWithNoPermissionBasis: noPermissionBasis,
      permissionEvents,
      suppressions,
    },
    outreach: {
      status: "blocked",
      eligibleContacts: 0,
      reasons,
    },
    freshness: {
      peopleUpdatedAt,
      contactPointsUpdatedAt,
      sourceRecordsUpdatedAt,
      latestUpdatedAt: latestIso([
        peopleUpdatedAt,
        contactPointsUpdatedAt,
        sourceRecordsUpdatedAt,
      ]),
      observedAt: input.observedAt || new Date().toISOString(),
    },
  };
}

function timestampToIso(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
  }
  if (typeof value === "object" && value !== null) {
    const candidate = value as { toDate?: () => Date };
    if (typeof candidate.toDate === "function") {
      try {
        return candidate.toDate().toISOString();
      } catch {
        return null;
      }
    }
  }
  return null;
}

async function countQuery(query: Query<DocumentData>): Promise<number> {
  const result = await query.count().get();
  return boundedCount(result.data().count);
}

async function latestUpdatedAt(query: Query<DocumentData>): Promise<string | null> {
  const snapshot = await query.select("updatedAt").orderBy("updatedAt", "desc").limit(1).get();
  return timestampToIso(snapshot.docs[0]?.data()?.updatedAt);
}

export async function assertPortfolioRegistryAccess(
  uid: string,
  db: Firestore = getAdminDb()
): Promise<RegistryAccess> {
  const workspaceId = portfolioRegistryWorkspaceIdForUid(uid);
  const [workspaceSnapshot, memberSnapshot] = await Promise.all([
    db.collection(COLLECTIONS.workspaces).doc(workspaceId).get(),
    db
      .collection(COLLECTIONS.workspaceMembers)
      .where("workspaceId", "==", workspaceId)
      .where("uid", "==", uid)
      .limit(2)
      .get(),
  ]);

  if (!workspaceSnapshot.exists) {
    throw new ApiError(403, "Portfolio CRM registry access is not available for this account.");
  }
  const workspace = workspaceSnapshot.data() || {};
  if (workspace.status !== "active" || workspace.ownerUid !== uid) {
    throw new ApiError(403, "Portfolio CRM registry access is not available for this account.");
  }
  if (memberSnapshot.docs.length !== 1) {
    throw new ApiError(409, "Portfolio CRM registry membership could not be reconciled.");
  }
  const member = memberSnapshot.docs[0]?.data() || {};
  const role = member.role === "owner" || member.role === "admin" ? member.role : null;
  if (member.status !== "active" || !role) {
    throw new ApiError(403, "Portfolio CRM registry access is not available for this account.");
  }

  return {
    workspaceId,
    role,
  };
}

export async function loadPortfolioCrmSummaryForUid(
  uid: string,
  log: Logger,
  db: Firestore = getAdminDb()
): Promise<PortfolioCrmRegistrySummary> {
  const access = await assertPortfolioRegistryAccess(uid, db);
  const scoped = (collection: string) =>
    db.collection(collection).where("workspaceId", "==", access.workspaceId);
  const people = scoped(COLLECTIONS.people);
  const contactPoints = scoped(COLLECTIONS.contactPoints);
  const sourceRecords = scoped(COLLECTIONS.sourceRecords);

  const plannedReadOperations =
    2 +
    9 +
    PORTFOLIO_CRM_BRANDS.length +
    PORTFOLIO_CRM_SOURCE_SYSTEMS.length +
    PORTFOLIO_CRM_PERMISSION_STATES.length +
    1 +
    3;
  if (plannedReadOperations > PORTFOLIO_CRM_MAX_READ_OPERATIONS) {
    throw new ApiError(500, "Portfolio CRM registry query plan exceeds its read cap.");
  }

  const queryPlan = [
    countQuery(people),
    countQuery(contactPoints),
    countQuery(contactPoints.where("type", "==", "email")),
    countQuery(contactPoints.where("type", "==", "phone")),
    countQuery(sourceRecords),
    countQuery(scoped(COLLECTIONS.importConflicts).where("status", "==", "open")),
    countQuery(scoped(COLLECTIONS.permissionEvents)),
    countQuery(scoped(COLLECTIONS.suppressions)),
    countQuery(
      people.where("relationshipBrandIds", "array-contains-any", [...PORTFOLIO_CRM_BRANDS])
    ),
    ...PORTFOLIO_CRM_BRANDS.map((brand) =>
      countQuery(people.where("relationshipBrandIds", "array-contains", brand))
    ),
    ...PORTFOLIO_CRM_SOURCE_SYSTEMS.map((source) =>
      countQuery(sourceRecords.where("sourceSystem", "==", source))
    ),
    ...PORTFOLIO_CRM_PERMISSION_STATES.map((state) =>
      countQuery(contactPoints.where("defaultPermissionState", "==", state))
    ),
    countQuery(sourceRecords.where("permissionBasis", "==", "none")),
    latestUpdatedAt(people),
    latestUpdatedAt(contactPoints),
    latestUpdatedAt(sourceRecords),
  ] as const;

  const [
    peopleCount,
    contactPointCount,
    emailContactPoints,
    phoneContactPoints,
    sourceRecordCount,
    openConflicts,
    permissionEvents,
    suppressions,
    brandedPeople,
    ...remaining
  ] = await Promise.all(queryPlan);

  let offset = 0;
  const brandCounts = Object.fromEntries(
    PORTFOLIO_CRM_BRANDS.map((brand) => [brand, remaining[offset++]])
  ) as Record<PortfolioCrmBrand, number>;
  const sourceCounts = Object.fromEntries(
    PORTFOLIO_CRM_SOURCE_SYSTEMS.map((source) => [source, remaining[offset++]])
  ) as Record<PortfolioCrmSourceSystem, number>;
  const permissionStateCounts = Object.fromEntries(
    PORTFOLIO_CRM_PERMISSION_STATES.map((state) => [state, remaining[offset++]])
  ) as Record<PortfolioCrmPermissionState, number>;
  const sourceRecordsWithNoPermissionBasis = remaining[offset++] as number;
  const peopleUpdatedAt = remaining[offset++] as string | null;
  const contactPointsUpdatedAt = remaining[offset++] as string | null;
  const sourceRecordsUpdatedAt = remaining[offset++] as string | null;

  const summary = buildPortfolioCrmSummary({
    access,
    totals: {
      people: peopleCount,
      contactPoints: contactPointCount,
      emailContactPoints,
      phoneContactPoints,
      sourceRecords: sourceRecordCount,
      openConflicts,
    },
    brandCounts,
    brandedPeople,
    sourceCounts,
    permissionStateCounts,
    sourceRecordsWithNoPermissionBasis,
    permissionEvents,
    suppressions,
    freshness: {
      peopleUpdatedAt,
      contactPointsUpdatedAt,
      sourceRecordsUpdatedAt,
    },
  });

  log.info("crm.portfolio_registry.summary_loaded", {
    sourceScope: "authenticated_default_workspace",
    people: summary.totals.people,
    contactPoints: summary.totals.contactPoints,
    sourceRecords: summary.totals.sourceRecords,
    permissionEvents: summary.permissions.permissionEvents,
    suppressions: summary.permissions.suppressions,
    outreachStatus: summary.outreach.status,
  });
  return summary;
}
