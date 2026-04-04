import "server-only";

import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type { ZodType } from "zod";
import {
  RepoImprovementMetricsPayloadSchema,
  RepoImprovementMorningReviewSchemaSchema,
  RepoImprovementReviewResponseSchema,
  type RepoImprovementPaths,
  type RepoImprovementReviewRequest,
  type RepoImprovementReviewResponse,
  type RepoImprovementSnapshot,
} from "@/lib/repo-improvement-contract";

const execFileAsync = promisify(execFile);

export const DEFAULT_REPO_IMPROVEMENT_REPORT_ROOT =
  "C:\\CTO Projects\\CodexSkills\\docs\\reports";
export const DEFAULT_REPO_IMPROVEMENT_SCRIPT_ROOT =
  "C:\\CTO Projects\\CodexSkills\\.codex\\skills\\automation-control-plane\\scripts";

function readEnvPath(
  env: NodeJS.ProcessEnv,
  key: string,
  fallback: string
): string {
  const candidate = env[key]?.trim();
  return candidate && candidate.length > 0 ? candidate : fallback;
}

export function getRepoImprovementPaths(
  env: NodeJS.ProcessEnv = process.env
): RepoImprovementPaths {
  const reportRoot = readEnvPath(
    env,
    "REPO_IMPROVEMENT_REPORT_ROOT",
    DEFAULT_REPO_IMPROVEMENT_REPORT_ROOT
  );
  const scriptRoot = readEnvPath(
    env,
    "REPO_IMPROVEMENT_SCRIPT_ROOT",
    DEFAULT_REPO_IMPROVEMENT_SCRIPT_ROOT
  );

  return {
    reportRoot,
    scriptRoot,
    reviewLedgerPath: path.join(reportRoot, "repo-improvement-review-ledger.json"),
    morningReviewSchemaPath: path.join(
      reportRoot,
      "repo-improvement-morning-review-schema-latest.json"
    ),
    metricsJsonPath: path.join(reportRoot, "repo-improvement-metrics-latest.json"),
    trainingDatasetPath: path.join(
      reportRoot,
      "repo-improvement-training-dataset-latest.json"
    ),
    reviewScriptPath: path.join(scriptRoot, "record_repo_improvement_review.ps1"),
  };
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function readValidatedJson<T>(
  targetPath: string,
  schema: ZodType<T>
): Promise<{ status: "present" | "missing" | "invalid"; value: T | null; error: string | null }> {
  if (!(await pathExists(targetPath))) {
    return { status: "missing", value: null, error: null };
  }

  try {
    const raw = await fs.readFile(targetPath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return {
      status: "present",
      value: schema.parse(parsed),
      error: null,
    };
  } catch (error) {
    return {
      status: "invalid",
      value: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function buildSnapshotDetail(args: {
  schemaStatus: "present" | "missing" | "invalid";
  metricsStatus: "present" | "missing" | "invalid";
  reviewScriptAvailable: boolean;
  schemaError: string | null;
  metricsError: string | null;
  paths: RepoImprovementPaths;
}): { status: RepoImprovementSnapshot["status"]; detail: string } {
  const issues: string[] = [];

  if (args.schemaStatus === "missing") {
    issues.push("Morning review schema has not been generated yet.");
  } else if (args.schemaStatus === "invalid") {
    issues.push(
      `Morning review schema is invalid: ${args.schemaError || "parse failed"}.`
    );
  }

  if (args.metricsStatus === "missing") {
    issues.push("Metrics artifact has not been generated yet.");
  } else if (args.metricsStatus === "invalid") {
    issues.push(`Metrics artifact is invalid: ${args.metricsError || "parse failed"}.`);
  }

  if (!args.reviewScriptAvailable) {
    issues.push(
      `Review recorder script is missing at ${args.paths.reviewScriptPath}.`
    );
  }

  if (issues.length === 0) {
    return {
      status: "available",
      detail: "Repo-improvement inbox and review recorder are available.",
    };
  }

  const allMissing =
    args.schemaStatus === "missing" &&
    args.metricsStatus === "missing" &&
    !args.reviewScriptAvailable;

  return {
    status: allMissing ? "unavailable" : "degraded",
    detail: issues.join(" "),
  };
}

function parseReviewScriptOutput(stdout: string): RepoImprovementReviewResponse {
  const trimmed = stdout.trim();
  const candidates = trimmed.length === 0 ? [] : [trimmed];
  const lines = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length > 0) {
    candidates.unshift(lines[lines.length - 1] as string);
  }

  for (const candidate of candidates) {
    try {
      return RepoImprovementReviewResponseSchema.parse(
        JSON.parse(candidate) as unknown
      );
    } catch {
      continue;
    }
  }

  throw new Error("Repo-improvement review recorder returned non-JSON output.");
}

function getReviewShell(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.REPO_IMPROVEMENT_REVIEW_SHELL?.trim();
  if (configured) return configured;
  return process.platform === "win32" ? "powershell.exe" : "pwsh";
}

export async function getRepoImprovementSnapshot(
  env: NodeJS.ProcessEnv = process.env
): Promise<RepoImprovementSnapshot> {
  const paths = getRepoImprovementPaths(env);
  const [reviewSchemaResult, metricsResult, reviewScriptAvailable] =
    await Promise.all([
      readValidatedJson(
        paths.morningReviewSchemaPath,
        RepoImprovementMorningReviewSchemaSchema
      ),
      readValidatedJson(paths.metricsJsonPath, RepoImprovementMetricsPayloadSchema),
      pathExists(paths.reviewScriptPath),
    ]);

  const availability = buildSnapshotDetail({
    schemaStatus: reviewSchemaResult.status,
    metricsStatus: metricsResult.status,
    reviewScriptAvailable,
    schemaError: reviewSchemaResult.error,
    metricsError: metricsResult.error,
    paths,
  });

  const generatedAt =
    reviewSchemaResult.value?.summary.generated_at ||
    metricsResult.value?.summary.generated_at ||
    new Date().toISOString();

  return {
    generatedAt,
    status: availability.status,
    detail: availability.detail,
    paths,
    reviewScriptAvailable,
    reviewSchema: reviewSchemaResult.value,
    metrics: metricsResult.value,
  };
}

export async function recordRepoImprovementReview(
  input: RepoImprovementReviewRequest,
  options: {
    reviewer: string;
    correlationId?: string;
    env?: NodeJS.ProcessEnv;
  }
): Promise<RepoImprovementReviewResponse> {
  const env = options.env || process.env;
  const paths = getRepoImprovementPaths(env);
  if (!(await pathExists(paths.reviewScriptPath))) {
    throw new Error(
      `Repo-improvement review recorder script not found at ${paths.reviewScriptPath}.`
    );
  }

  const shell = getReviewShell(env);
  const args = [
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    paths.reviewScriptPath,
    "-ReviewId",
    input.reviewId,
    "-Decision",
    input.decision,
    "-ReasonCode",
    input.reasonCode,
    "-Reviewer",
    options.reviewer,
  ];

  if (input.notes) {
    args.push("-Notes", input.notes);
  }
  if (input.outcomeAfter7d) {
    args.push("-OutcomeAfter7d", input.outcomeAfter7d);
  }
  if (input.outcomeNotes) {
    args.push("-OutcomeNotes", input.outcomeNotes);
  }

  try {
    const { stdout } = await execFileAsync(shell, args, {
      env,
      windowsHide: true,
      timeout: 60_000,
      maxBuffer: 1024 * 1024,
    });
    return parseReviewScriptOutput(stdout);
  } catch (error) {
    const details =
      typeof error === "object" && error !== null
        ? [
            "stdout" in error ? String(error.stdout || "").trim() : "",
            "stderr" in error ? String(error.stderr || "").trim() : "",
            "message" in error ? String(error.message || "").trim() : "",
          ]
            .filter((value) => value.length > 0)
            .join(" | ")
        : String(error);

    throw new Error(
      `Repo-improvement review recorder failed: ${details || "unknown error"}.`
    );
  }
}
