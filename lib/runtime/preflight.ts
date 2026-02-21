import "server-only";

export type RuntimeCheckLevel = "required" | "recommended";
export type RuntimeCheckState = "ok" | "missing" | "warning";

export interface RuntimeConfigCheck {
  id: string;
  label: string;
  level: RuntimeCheckLevel;
  state: RuntimeCheckState;
  detail: string;
}

export interface RuntimePreflightReport {
  status: "ok" | "warn" | "fail";
  checks: RuntimeConfigCheck[];
  generatedAt: string;
}

function hasEnv(name: string): boolean {
  const value = process.env[name];
  return typeof value === "string" && value.trim().length > 0;
}

function parsePositiveNumber(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

export function buildRuntimePreflightReport(): RuntimePreflightReport {
  const hasGooglePlaces = hasEnv("GOOGLE_PLACES_API_KEY");
  const hasApify = hasEnv("APIFY_TOKEN");
  const hasApifyActor = hasEnv("APIFY_GOOGLE_MAPS_ACTOR_ID");

  const hasLeadQueue = hasEnv("LEAD_RUNS_TASK_QUEUE") && hasEnv("LEAD_RUNS_TASK_LOCATION");
  const hasLeadQueueServiceAccount = hasEnv("LEAD_RUNS_TASK_SERVICE_ACCOUNT");
  const hasFollowupsQueue =
    (hasEnv("FOLLOWUPS_TASK_QUEUE") && hasEnv("FOLLOWUPS_TASK_LOCATION")) || hasLeadQueue;
  const hasCompetitorQueue =
    (hasEnv("COMPETITOR_MONITOR_TASK_QUEUE") && hasEnv("COMPETITOR_MONITOR_TASK_LOCATION")) ||
    hasLeadQueue;

  const budgetCost = parsePositiveNumber(process.env.LEAD_SOURCE_BUDGET_MAX_COST_USD);
  const budgetPages = parsePositiveNumber(process.env.LEAD_SOURCE_BUDGET_MAX_PAGES);
  const budgetRuntime = parsePositiveNumber(process.env.LEAD_SOURCE_BUDGET_MAX_RUNTIME_SEC);

  const checks: RuntimeConfigCheck[] = [
    {
      id: "lead-source-provider",
      label: "Lead source provider credentials",
      level: "required",
      state: hasGooglePlaces || hasApify ? "ok" : "missing",
      detail:
        hasGooglePlaces || hasApify
          ? hasGooglePlaces
            ? "Google Places API key detected."
            : "Apify token detected (Google Places fallback path)."
          : "Set GOOGLE_PLACES_API_KEY or APIFY_TOKEN.",
    },
    {
      id: "apify-actor-id",
      label: "Apify actor id",
      level: "recommended",
      state: hasApify && !hasApifyActor ? "warning" : "ok",
      detail:
        hasApify && !hasApifyActor
          ? "APIFY_TOKEN is set but APIFY_GOOGLE_MAPS_ACTOR_ID is missing; default actor will be used."
          : "Apify actor id configuration is valid.",
    },
    {
      id: "lead-source-budget-defaults",
      label: "Lead source budget defaults",
      level: "required",
      state: budgetCost && budgetPages && budgetRuntime ? "ok" : "missing",
      detail:
        budgetCost && budgetPages && budgetRuntime
          ? `Cost=$${budgetCost}, Pages=${budgetPages}, Runtime=${budgetRuntime}s.`
          : "Set LEAD_SOURCE_BUDGET_MAX_COST_USD, LEAD_SOURCE_BUDGET_MAX_PAGES, and LEAD_SOURCE_BUDGET_MAX_RUNTIME_SEC.",
    },
    {
      id: "lead-run-queue",
      label: "Lead run queue dispatch",
      level: "required",
      state: hasLeadQueue ? "ok" : "missing",
      detail: hasLeadQueue
        ? "Queue + location configured."
        : "Set LEAD_RUNS_TASK_QUEUE and LEAD_RUNS_TASK_LOCATION.",
    },
    {
      id: "lead-run-queue-oidc",
      label: "Lead run queue OIDC service account",
      level: "recommended",
      state: hasLeadQueue && !hasLeadQueueServiceAccount ? "warning" : "ok",
      detail:
        hasLeadQueue && !hasLeadQueueServiceAccount
          ? "LEAD_RUNS_TASK_SERVICE_ACCOUNT missing; task calls may fail in private Cloud Run setups."
          : "Lead run queue service account configuration is valid.",
    },
    {
      id: "followups-queue",
      label: "Follow-ups queue dispatch",
      level: "recommended",
      state: hasFollowupsQueue ? "ok" : "warning",
      detail: hasFollowupsQueue
        ? "Follow-up queue dispatch resolved."
        : "Set FOLLOWUPS_TASK_QUEUE + FOLLOWUPS_TASK_LOCATION (or rely on LEAD_RUNS_TASK_* fallback).",
    },
    {
      id: "competitor-monitor-queue",
      label: "Competitor monitor queue dispatch",
      level: "recommended",
      state: hasCompetitorQueue ? "ok" : "warning",
      detail: hasCompetitorQueue
        ? "Competitor monitor queue dispatch resolved."
        : "Set COMPETITOR_MONITOR_TASK_QUEUE + COMPETITOR_MONITOR_TASK_LOCATION (or rely on LEAD_RUNS_TASK_* fallback).",
    },
  ];

  const hasRequiredFailure = checks.some(
    (check) => check.level === "required" && check.state === "missing"
  );
  const hasWarnings = checks.some((check) => check.state === "warning");

  return {
    status: hasRequiredFailure ? "fail" : hasWarnings ? "warn" : "ok",
    checks,
    generatedAt: new Date().toISOString(),
  };
}

