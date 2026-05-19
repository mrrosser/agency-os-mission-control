import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ApiError } from "@/lib/api/handler";
import { getAdminDb } from "@/lib/firebase-admin";
import type { Logger } from "@/lib/logging";

const truthyValues = new Set(["1", "true", "yes", "y", "on", "enabled"]);

export const clientAutofixTriggerSchema = z.enum([
  "client_email",
  "client_issue",
  "github_check",
  "cloud_run_smoke",
  "playwright",
  "manual",
]);

export const clientAutofixStatusSchema = z.enum([
  "queued",
  "running",
  "verifying",
  "verified",
  "deploying",
  "deployed",
  "completed",
  "failed",
  "blocked_kill_switch",
  "blocked_not_client_project",
  "blocked_missing_evidence",
  "push_blocked_missing_remote",
]);

export const commandResultSchema = z.object({
  name: z.string().trim().min(1).max(120),
  command: z.string().trim().min(1).max(500),
  status: z.enum(["passed", "failed", "skipped"]),
  summary: z.string().trim().max(1000).optional(),
  artifact_path: z.string().trim().max(500).optional(),
});

export const routeCheckSchema = z.object({
  name: z.string().trim().min(1).max(120),
  url: z.string().trim().min(1).max(1000),
  status_code: z.number().int().min(100).max(599),
  ok: z.boolean(),
  screenshot_path: z.string().trim().max(500).optional(),
  trace_path: z.string().trim().max(500).optional(),
});

export const evidenceBundleSchema = z.object({
  test_results: z.array(commandResultSchema).default([]),
  route_checks: z.array(routeCheckSchema).default([]),
  playwright_screenshots: z.array(z.string().trim().min(1).max(500)).default([]),
  playwright_traces: z.array(z.string().trim().min(1).max(500)).default([]),
  cloud_run_revision: z.string().trim().max(300).optional(),
  cloud_run_log_url: z.string().trim().max(1000).optional(),
  pr_url: z.string().trim().max(1000).optional(),
  commit_sha: z.string().trim().max(80).optional(),
  deployed_url: z.string().trim().max(1000).optional(),
  final_client_visible_url: z.string().trim().max(1000).optional(),
});

export const clientAutofixRunRequestSchema = z.object({
  action: z.literal("client_autofix.run").optional(),
  client_id: z.string().trim().min(1).max(120),
  project_id: z.string().trim().min(1).max(120),
  repo_id: z.string().trim().min(1).max(120).optional(),
  trigger_source: clientAutofixTriggerSchema.default("manual"),
  issue_summary: z.string().trim().min(1).max(1200),
  autonomy_mode: z
    .enum(["full_autopilot_client_projects", "pr_only", "safe_auto_merge"])
    .default("full_autopilot_client_projects"),
  deploy_target: z.enum(["staging", "production"]).default("staging"),
  evidence_bundle: evidenceBundleSchema.optional(),
  idempotency_key: z.string().trim().min(1).max(200).optional(),
});

export type ClientAutofixTrigger = z.infer<typeof clientAutofixTriggerSchema>;
export type ClientAutofixStatus = z.infer<typeof clientAutofixStatusSchema>;
export type EvidenceBundle = z.infer<typeof evidenceBundleSchema>;
export type ClientAutofixRunRequest = z.infer<typeof clientAutofixRunRequestSchema>;

export interface ClientProjectRegistryEntry {
  project_id: string;
  repo_id: string;
  client_ids: string[];
  name: string;
  local_repo_path: string;
  github_repo_url: string | null;
  default_branch: string;
  allowed_file_roots: string[];
  verifier_commands: Array<{ name: string; command: string; workdir: string }>;
  playwright_specs: Array<{ name: string; command: string; workdir: string }>;
  deploy_command: { staging: string | null; production: string | null };
  urls: { staging: string | null; production: string | null };
  client_followup_channel: "gmail" | "manual";
  kill_switch: "active" | "read_only" | "disabled";
}

export interface ClientAutofixRun {
  run_id: string;
  client_id: string;
  project_id: string;
  repo_id: string;
  trigger_source: ClientAutofixTrigger;
  issue_summary: string;
  autonomy_mode: "full_autopilot_client_projects" | "pr_only" | "safe_auto_merge";
  status: ClientAutofixStatus;
  branch: string | null;
  pr_url: string | null;
  deploy_target: "staging" | "production";
  evidence_bundle: EvidenceBundle;
  client_followup_status:
    | "blocked_pending_evidence"
    | "held_until_verified"
    | "ready_to_send"
    | "sent"
    | "manual_required";
  sub_agent_plan: Array<{ role: string; status: "queued" | "blocked"; task: string }>;
  blockers: string[];
  created_at: string;
  updated_at: string;
  correlation_id: string;
  requested_by_uid: string;
}

export function isTruthyEnv(value: string | undefined): boolean {
  return truthyValues.has((value || "").trim().toLowerCase());
}

export function getDefaultClientProjectRegistry(env: NodeJS.ProcessEnv = process.env): ClientProjectRegistryEntry[] {
  const socialopsProductionUrl =
    env.SOCIALOPS_CLIENT_PRODUCTION_URL ||
    "https://socialops-client-928920390190.us-central1.run.app";
  const socialopsStagingUrl =
    env.SOCIALOPS_CLIENT_STAGING_URL ||
    "https://socialops-client-staging-hau2jvawpa-uc.a.run.app";
  const socialopsGithubRepoUrl = (env.SOCIALOPS_GITHUB_REPO_URL || "").trim() || null;

  return [
    {
      project_id: "socialops",
      repo_id: "smauto",
      client_ids: ["*"],
      name: "SocialOps client approvals",
      local_repo_path: "C:\\CTO Projects\\SMAuto",
      github_repo_url: socialopsGithubRepoUrl,
      default_branch: "master",
      allowed_file_roots: [
        "socialops-client",
        "SocialOps Orchestrator",
        "scripts",
        "tests",
        "docs",
      ],
      verifier_commands: [
        { name: "python", command: "python -m pytest -q", workdir: "C:\\CTO Projects\\SMAuto" },
        {
          name: "orchestrator-social",
          command:
            "python -m pytest \"SocialOps Orchestrator\\socialops_orchestrator\\tests\\test_sub_agents.py\" \"SocialOps Orchestrator\\socialops_orchestrator\\tests\\test_scheduled_preview.py\" \"SocialOps Orchestrator\\socialops_orchestrator\\tests\\test_planned_post_publish.py\" -q",
          workdir: "C:\\CTO Projects\\SMAuto",
        },
        { name: "client-lint", command: "npm run lint", workdir: "C:\\CTO Projects\\SMAuto\\socialops-client" },
        { name: "client-test", command: "npm test", workdir: "C:\\CTO Projects\\SMAuto\\socialops-client" },
        { name: "client-build", command: "npm run build", workdir: "C:\\CTO Projects\\SMAuto\\socialops-client" },
        {
          name: "orchestrator-smoke",
          command: "powershell -ExecutionPolicy Bypass -File scripts\\smoke_orchestrator_clients.ps1",
          workdir: "C:\\CTO Projects\\SMAuto",
        },
      ],
      playwright_specs: [
        {
          name: "socialops-client-approval-routes",
          command:
            "powershell -NoProfile -Command \"$env:BASE_URL=$env:SOCIALOPS_CLIENT_URL; $env:STORAGE_STATE='storage/socialops-client.json'; $env:FORCE_TRACE='1'; npx playwright test tests/socialops-client.smoke.spec.ts --reporter=list\"",
          workdir: "C:\\CTO Projects\\ui-tests",
        },
      ],
      deploy_command: {
        staging:
          "powershell -ExecutionPolicy Bypass -File socialops-client\\deploy.ps1 -Service socialops-client-staging",
        production:
          "powershell -ExecutionPolicy Bypass -File socialops-client\\deploy.ps1 -Service socialops-client",
      },
      urls: {
        staging: socialopsStagingUrl,
        production: socialopsProductionUrl,
      },
      client_followup_channel: "gmail",
      kill_switch: isTruthyEnv(env.CLIENT_AUTOFIX_SOCIALOPS_DISABLED)
        ? "disabled"
        : isTruthyEnv(env.CLIENT_AUTOFIX_SOCIALOPS_READ_ONLY)
          ? "read_only"
          : "active",
    },
  ];
}

export function findClientProject(
  request: Pick<ClientAutofixRunRequest, "client_id" | "project_id" | "repo_id">,
  registry: ClientProjectRegistryEntry[] = getDefaultClientProjectRegistry()
): ClientProjectRegistryEntry | null {
  const projectId = request.project_id.trim().toLowerCase();
  const repoId = request.repo_id?.trim().toLowerCase();
  const clientId = request.client_id.trim().toLowerCase();

  return (
    registry.find((entry) => {
      const projectMatches = entry.project_id.toLowerCase() === projectId;
      const repoMatches = !repoId || entry.repo_id.toLowerCase() === repoId;
      const clientMatches =
        entry.client_ids.includes("*") ||
        entry.client_ids.some((candidate) => candidate.toLowerCase() === clientId);
      return projectMatches && repoMatches && clientMatches;
    }) || null
  );
}

export function classifyAutofixTrigger(input: string | undefined): ClientAutofixTrigger {
  const normalized = (input || "").trim().toLowerCase();
  if (["email", "gmail", "client_email"].includes(normalized)) return "client_email";
  if (["issue", "client_issue", "ticket"].includes(normalized)) return "client_issue";
  if (["github", "github_check", "ci"].includes(normalized)) return "github_check";
  if (["cloudrun", "cloud_run", "cloud_run_smoke", "smoke"].includes(normalized)) {
    return "cloud_run_smoke";
  }
  if (["playwright", "browser", "chrome"].includes(normalized)) return "playwright";
  return "manual";
}

export function evidenceIsGreen(bundle: EvidenceBundle | undefined): boolean {
  if (!bundle) return false;
  const hasTests = bundle.test_results.length > 0;
  const testsPassed = bundle.test_results.every((result) => result.status === "passed");
  const hasRouteChecks = bundle.route_checks.length > 0;
  const routesPassed = bundle.route_checks.every(
    (check) => check.ok && check.status_code !== 404 && check.status_code < 500
  );
  const hasVisualEvidence =
    bundle.playwright_screenshots.length > 0 ||
    bundle.route_checks.some((check) => Boolean(check.screenshot_path || check.trace_path));
  const hasTraceEvidence =
    bundle.playwright_traces.length > 0 || bundle.route_checks.some((check) => Boolean(check.trace_path));
  const hasClientVisibleUrl = Boolean(bundle.final_client_visible_url || bundle.deployed_url);
  return (
    hasTests &&
    testsPassed &&
    hasRouteChecks &&
    routesPassed &&
    hasVisualEvidence &&
    hasTraceEvidence &&
    hasClientVisibleUrl
  );
}

function slugifyBranchPart(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

export function buildSubAgentPlan(entry: ClientProjectRegistryEntry): ClientAutofixRun["sub_agent_plan"] {
  const blocked = entry.kill_switch !== "active";
  const status = blocked ? "blocked" : "queued";
  return [
    {
      role: "intake-triage",
      status,
      task: "Classify the client-visible failure and bind it to the client project adapter.",
    },
    {
      role: "repo-implementation",
      status,
      task: "Create a bounded patch inside approved file roots and keep external actions idempotent.",
    },
    {
      role: "verifier-browser",
      status,
      task: "Run repo verifiers plus Playwright/Chrome route checks and attach screenshots/traces.",
    },
    {
      role: "client-comms",
      status,
      task: "Hold the client reply until evidence is green, then generate a concise Marcus-style update.",
    },
  ];
}

export function createClientAutofixRunRecord(params: {
  request: ClientAutofixRunRequest;
  entry: ClientProjectRegistryEntry | null;
  correlationId: string;
  requestedByUid: string;
  env?: NodeJS.ProcessEnv;
}): ClientAutofixRun {
  const nowIso = new Date().toISOString();
  const bundle = evidenceBundleSchema.parse(params.request.evidence_bundle || {});
  const blockers: string[] = [];
  let status: ClientAutofixStatus = "queued";

  if (!params.entry) {
    status = "blocked_not_client_project";
    blockers.push("No active client-project adapter matched project_id/client_id/repo_id.");
  } else if (isTruthyEnv(params.env?.MISSION_CONTROL_CLIENT_AUTOFIX_DISABLED)) {
    status = "blocked_kill_switch";
    blockers.push("Mission Control client autofix kill switch is enabled.");
  } else if (params.entry.kill_switch !== "active") {
    status = "blocked_kill_switch";
    blockers.push(`Client project ${params.entry.project_id} kill switch is ${params.entry.kill_switch}.`);
  } else if (!params.entry.github_repo_url) {
    status = "push_blocked_missing_remote";
    blockers.push("GitHub remote is not configured; local patch/test may run but push/PR is blocked.");
  } else if (bundle.test_results.length > 0 || bundle.route_checks.length > 0) {
    status = evidenceIsGreen(bundle) ? "verified" : "blocked_missing_evidence";
    if (status === "blocked_missing_evidence") {
      blockers.push("Evidence bundle is incomplete or failing; client follow-up and deploy completion are blocked.");
    }
  }

  const entry = params.entry;
  const branch = entry
    ? `codex/client-autofix-${entry.project_id}-${slugifyBranchPart(params.request.client_id)}`
    : null;
  const clientFollowupStatus = evidenceIsGreen(bundle)
    ? "ready_to_send"
    : entry?.client_followup_channel === "manual"
      ? "manual_required"
      : "held_until_verified";

  return {
    run_id: randomUUID(),
    client_id: params.request.client_id,
    project_id: params.request.project_id,
    repo_id: entry?.repo_id || params.request.repo_id || "unknown",
    trigger_source: params.request.trigger_source,
    issue_summary: params.request.issue_summary,
    autonomy_mode: params.request.autonomy_mode,
    status,
    branch,
    pr_url: bundle.pr_url || null,
    deploy_target: params.request.deploy_target,
    evidence_bundle: bundle,
    client_followup_status: clientFollowupStatus,
    sub_agent_plan: entry ? buildSubAgentPlan(entry) : [],
    blockers,
    created_at: nowIso,
    updated_at: nowIso,
    correlation_id: params.correlationId,
    requested_by_uid: params.requestedByUid,
  };
}

export function buildVerifiedClientReply(clientName: string = "Beth"): string {
  return [
    `Hi ${clientName},`,
    "",
    "Thanks for confirming. You were clicking the right link - the approval view just was not pulling the May posts through on your side.",
    "",
    "I fixed that and checked it in Chrome before sending this back. You should now be able to open the approval link, review the posts, and leave any edits right there.",
    "",
    "If anything still looks off, just reply with the post/date and I'll clean it up.",
    "",
    "Marcus",
  ].join("\n");
}

export async function queueClientAutofixRun(params: {
  payload: unknown;
  correlationId: string;
  requestedByUid: string;
  log?: Logger;
  registry?: ClientProjectRegistryEntry[];
  env?: NodeJS.ProcessEnv;
}): Promise<ClientAutofixRun> {
  const parsed = clientAutofixRunRequestSchema.safeParse({
    ...(typeof params.payload === "object" && params.payload !== null ? params.payload : {}),
    trigger_source: classifyAutofixTrigger(
      typeof params.payload === "object" && params.payload !== null
        ? String((params.payload as Record<string, unknown>).trigger_source || "")
        : undefined
    ),
  });
  if (!parsed.success) {
    throw new ApiError(400, "Invalid client autofix payload", { issues: parsed.error.issues });
  }

  const entry = findClientProject(parsed.data, params.registry);
  const run = createClientAutofixRunRecord({
    request: parsed.data,
    entry,
    correlationId: params.correlationId,
    requestedByUid: params.requestedByUid,
    env: params.env || process.env,
  });

  await getAdminDb().collection("clientAutofixRuns").doc(run.run_id).set(run);
  params.log?.info("client_autofix.run_queued", {
    runId: run.run_id,
    clientId: run.client_id,
    projectId: run.project_id,
    repoId: run.repo_id,
    status: run.status,
    blockerCount: run.blockers.length,
  });
  return run;
}

export async function listClientAutofixRuns(limit: number = 25): Promise<ClientAutofixRun[]> {
  const snapshot = await getAdminDb()
    .collection("clientAutofixRuns")
    .orderBy("created_at", "desc")
    .limit(Math.max(1, Math.min(limit, 100)))
    .get();
  return snapshot.docs.map((doc) => doc.data() as ClientAutofixRun);
}

export async function getClientAutofixRun(runId: string): Promise<ClientAutofixRun | null> {
  const doc = await getAdminDb().collection("clientAutofixRuns").doc(runId).get();
  if (!doc.exists) return null;
  return doc.data() as ClientAutofixRun;
}
