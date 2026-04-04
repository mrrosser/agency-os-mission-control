import "server-only";

export const REVENUE_AUTOMATION_TEMPLATE_IDS = {
  aicf: "aicf-south-day1",
  rng: "rng-south-day1",
  rts: "rts-south-day1",
} as const;

export type RevenueAutomationBusinessKey = keyof typeof REVENUE_AUTOMATION_TEMPLATE_IDS;
export type RevenueAutomationStage = "day1" | "day2" | "day30";

const REVENUE_AUTOMATION_STAGE_ORDER: RevenueAutomationStage[] = ["day1", "day2", "day30"];

export function normalizeRevenueAutomationStages(
  input: readonly string[] | readonly RevenueAutomationStage[] | undefined | null
): RevenueAutomationStage[] {
  const stages: RevenueAutomationStage[] = [];
  const seen = new Set<RevenueAutomationStage>();

  for (const raw of input || []) {
    const normalized = String(raw || "").trim().toLowerCase();
    if (normalized !== "day1" && normalized !== "day2" && normalized !== "day30") {
      continue;
    }
    const stage = normalized as RevenueAutomationStage;
    if (seen.has(stage)) continue;
    seen.add(stage);
    stages.push(stage);
  }

  return stages;
}

export function resolveRevenueAutomationStage(
  requested: readonly RevenueAutomationStage[] | undefined | null
): RevenueAutomationStage {
  const normalized = normalizeRevenueAutomationStages(requested);
  if (normalized.includes("day30")) return "day30";
  if (normalized.includes("day2")) return "day2";
  return "day1";
}

export function templateIdForRevenueBusiness(
  businessKey: RevenueAutomationBusinessKey
): string {
  return REVENUE_AUTOMATION_TEMPLATE_IDS[businessKey];
}

export function orderedRevenueAutomationStages(): RevenueAutomationStage[] {
  return [...REVENUE_AUTOMATION_STAGE_ORDER];
}
