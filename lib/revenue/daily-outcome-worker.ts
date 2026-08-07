import "server-only";

import { createHash } from "crypto";
import { ApiError } from "@/lib/api/handler";
import { getAdminDb } from "@/lib/firebase-admin";
import type { Logger } from "@/lib/logging";
import {
  DAILY_OUTCOME_ORGANIZATIONS,
  DAILY_OUTCOME_TIME_ZONE,
  getDailyOutcomeDashboard,
  type DailyOutcomeBusinessUnit,
} from "@/lib/revenue/daily-outcome";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function requireCanonicalActiveMemberships(args: {
  uid: string;
  correlationId: string;
  log: Logger;
}): Promise<void> {
  const db = getAdminDb();
  const checks = await Promise.all(
    DAILY_OUTCOME_ORGANIZATIONS.map(async (organization) => {
      const snapshot = await db
        .collection("workspace_members")
        .doc(`${organization.workspaceId}__${args.uid}`)
        .get();
      const data = snapshot.exists ? asRecord(snapshot.data()) : {};
      return {
        businessUnit: organization.businessUnit,
        active: asString(data.status).toLowerCase() === "active",
      };
    })
  );

  const missingBusinessUnits = checks
    .filter((check) => !check.active)
    .map((check) => check.businessUnit);
  if (missingBusinessUnits.length > 0) {
    args.log.error("revenue.daily_outcome.worker_membership_missing", {
      correlationId: args.correlationId,
      workerUidHash: sha256(args.uid).slice(0, 12),
      missingBusinessUnits,
    });
    throw new ApiError(
      503,
      "Revenue automation worker must have active membership in both canonical outcome workspaces.",
      { missingBusinessUnits }
    );
  }
}

export async function evaluateDailyOutcomesForRevenueWorker(args: {
  uid: string;
  correlationId: string;
  log: Logger;
  asOf?: Date;
}): Promise<Awaited<ReturnType<typeof getDailyOutcomeDashboard>>> {
  const uid = args.uid.trim();
  if (!uid) throw new ApiError(503, "REVENUE_AUTOMATION_UID is not configured.");

  await requireCanonicalActiveMemberships({
    uid,
    correlationId: args.correlationId,
    log: args.log,
  });

  const dashboard = await getDailyOutcomeDashboard({
    uid,
    asOf: args.asOf || new Date(),
    timeZone: DAILY_OUTCOME_TIME_ZONE,
    correlationId: args.correlationId,
    log: args.log,
    failOnUnavailableSources: true,
  });

  const observed = new Set<DailyOutcomeBusinessUnit>(
    dashboard.outcomes.map((outcome) => outcome.businessUnit)
  );
  const missingBusinessUnits = DAILY_OUTCOME_ORGANIZATIONS
    .map((organization) => organization.businessUnit)
    .filter((businessUnit) => !observed.has(businessUnit));
  if (dashboard.outcomes.length !== DAILY_OUTCOME_ORGANIZATIONS.length || missingBusinessUnits.length > 0) {
    args.log.error("revenue.daily_outcome.worker_incomplete", {
      correlationId: args.correlationId,
      workerUidHash: sha256(uid).slice(0, 12),
      expectedOrganizations: DAILY_OUTCOME_ORGANIZATIONS.length,
      observedOrganizations: dashboard.outcomes.length,
      missingBusinessUnits,
    });
    throw new ApiError(503, "Daily outcome evaluation did not cover both canonical organizations.", {
      missingBusinessUnits,
    });
  }

  args.log.info("revenue.daily_outcome.worker_completed", {
    correlationId: args.correlationId,
    workerUidHash: sha256(uid).slice(0, 12),
    asOf: dashboard.asOf,
    timeZone: dashboard.timeZone,
    outcomes: dashboard.outcomes.map((outcome) => ({
      businessUnit: outcome.businessUnit,
      status: outcome.status,
      outcomeId: outcome.outcomeId,
    })),
  });
  return dashboard;
}
