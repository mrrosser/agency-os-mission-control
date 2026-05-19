import "server-only";

import { ApiError } from "@/lib/api/handler";
import { pullProviderBilling } from "@/lib/billing/provider-costs";
import type { Logger } from "@/lib/logging";

export type BudgetedProviderId =
  | "openai"
  | "google"
  | "twilio"
  | "elevenlabs"
  | "heygen"
  | "apify"
  | "firecrawl"
  | "meta_ads"
  | "google_ads"
  | "square";

interface BudgetDecision {
  providerId: BudgetedProviderId;
  providerTotalUsd: number;
  monthToDateTotalUsd: number;
  providerBudgetUsd: number | null;
  monthBudgetUsd: number | null;
}

function roundUsd(value: number): number {
  return Math.round(value * 100) / 100;
}

function asNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function asString(value: string | undefined | null): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readBooleanEnv(name: string, fallback: boolean = false): boolean {
  const raw = process.env[name];
  if (typeof raw !== "string") return fallback;
  const normalized = raw.trim().toLowerCase();
  if (!normalized) return fallback;
  return ["1", "true", "yes", "on"].includes(normalized);
}

function readNumberEnv(name: string): number | null {
  const raw = process.env[name];
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function readCsvEnv(name: string): string[] {
  const raw = process.env[name];
  if (typeof raw !== "string") return [];
  return raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function readNumberRecordEnv(name: string): Record<string, number> {
  const raw = process.env[name];
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed).flatMap(([key, value]) => {
        const numeric = Number(value);
        return Number.isFinite(numeric) ? [[key, numeric]] : [];
      })
    );
  } catch {
    return {};
  }
}

async function resolveBudgetDecision(args: {
  uid: string;
  providerId: BudgetedProviderId;
  log: Logger;
}): Promise<BudgetDecision | null> {
  const mode = (asString(process.env.MISSION_CONTROL_BUDGET_MODE) || "hard-stop").toLowerCase();
  const globalKillSwitchEnabled = readBooleanEnv("MISSION_CONTROL_GLOBAL_KILL_SWITCH");
  const providerKillSwitches = new Set(readCsvEnv("MISSION_CONTROL_PROVIDER_KILL_SWITCHES"));
  const providerBudgets = readNumberRecordEnv("MISSION_CONTROL_PROVIDER_BUDGETS_JSON");
  const providerEstimates = readNumberRecordEnv("MISSION_CONTROL_PROVIDER_ESTIMATES_JSON");
  const providerUnreconciled = readNumberRecordEnv("MISSION_CONTROL_PROVIDER_UNRECONCILED_JSON");
  const monthBudgetUsd = readNumberEnv("MISSION_CONTROL_MONTHLY_BUDGET_USD");

  const hasGuardRails =
    globalKillSwitchEnabled ||
    providerKillSwitches.size > 0 ||
    monthBudgetUsd !== null ||
    Object.keys(providerBudgets).length > 0;

  if (mode === "observe" || !hasGuardRails) {
    return null;
  }

  if (globalKillSwitchEnabled) {
    throw new ApiError(423, "Budget governor blocked by global kill switch.");
  }

  if (providerKillSwitches.has(args.providerId)) {
    throw new ApiError(423, `Budget governor blocked ${args.providerId} by provider kill switch.`);
  }

  const billing = await pullProviderBilling({ uid: args.uid, log: args.log });
  const liveCosts = new Map<string, number>(
    (billing.providers || []).map((provider) => [provider.providerId, asNumber(provider.monthlyCostUsd)])
  );

  const providerTotalUsd = roundUsd(
    asNumber(liveCosts.get(args.providerId)) +
      asNumber(providerEstimates[args.providerId]) +
      asNumber(providerUnreconciled[args.providerId])
  );
  const allProviderIds = new Set<string>([
    ...Object.keys(providerBudgets),
    ...Object.keys(providerEstimates),
    ...Object.keys(providerUnreconciled),
    ...Array.from(liveCosts.keys()),
  ]);
  allProviderIds.add(args.providerId);

  const monthToDateTotalUsd = roundUsd(
    Array.from(allProviderIds).reduce((sum, providerId) => {
      return (
        sum +
        asNumber(liveCosts.get(providerId)) +
        asNumber(providerEstimates[providerId]) +
        asNumber(providerUnreconciled[providerId])
      );
    }, 0)
  );

  return {
    providerId: args.providerId,
    providerTotalUsd,
    monthToDateTotalUsd,
    providerBudgetUsd:
      typeof providerBudgets[args.providerId] === "number" ? providerBudgets[args.providerId] : null,
    monthBudgetUsd,
  };
}

export async function assertProviderSpendAllowed(args: {
  uid: string;
  providerId: BudgetedProviderId;
  log: Logger;
  route: string;
}): Promise<void> {
  const decision = await resolveBudgetDecision(args);
  if (!decision) return;

  if (
    decision.providerBudgetUsd !== null &&
    decision.providerTotalUsd >= decision.providerBudgetUsd
  ) {
    throw new ApiError(
      423,
      `Budget governor blocked ${decision.providerId} after reaching the provider hard limit.`,
      {
        providerId: decision.providerId,
        providerTotalUsd: decision.providerTotalUsd,
        providerBudgetUsd: decision.providerBudgetUsd,
      }
    );
  }

  if (
    decision.monthBudgetUsd !== null &&
    decision.monthToDateTotalUsd >= decision.monthBudgetUsd
  ) {
    throw new ApiError(423, "Budget governor blocked spend after reaching the monthly hard limit.", {
      providerId: decision.providerId,
      monthToDateTotalUsd: decision.monthToDateTotalUsd,
      monthBudgetUsd: decision.monthBudgetUsd,
    });
  }

  args.log.info("budget.governor.allow", {
    route: args.route,
    providerId: decision.providerId,
    providerTotalUsd: decision.providerTotalUsd,
    providerBudgetUsd: decision.providerBudgetUsd,
    monthToDateTotalUsd: decision.monthToDateTotalUsd,
    monthBudgetUsd: decision.monthBudgetUsd,
  });
}
