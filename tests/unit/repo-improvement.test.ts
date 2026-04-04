import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  getRepoImprovementPaths,
  getRepoImprovementSnapshot,
} from "@/lib/repo-improvement";

async function makeTempRoots() {
  const root = await mkdtemp(path.join(os.tmpdir(), "repo-improvement-"));
  const reportRoot = path.join(root, "reports");
  const scriptRoot = path.join(root, "scripts");
  await mkdir(reportRoot, { recursive: true });
  await mkdir(scriptRoot, { recursive: true });
  return { root, reportRoot, scriptRoot };
}

describe("repo-improvement helper", () => {
  const cleanupPaths: string[] = [];

  afterEach(async () => {
    await Promise.all(
      cleanupPaths.splice(0).map(async (target) => {
        await rm(target, { recursive: true, force: true });
      })
    );
  });

  it("builds repo-improvement paths from environment overrides", async () => {
    const { root, reportRoot, scriptRoot } = await makeTempRoots();
    cleanupPaths.push(root);

    const paths = getRepoImprovementPaths({
      ...process.env,
      REPO_IMPROVEMENT_REPORT_ROOT: reportRoot,
      REPO_IMPROVEMENT_SCRIPT_ROOT: scriptRoot,
    });

    expect(paths.reportRoot).toBe(reportRoot);
    expect(paths.scriptRoot).toBe(scriptRoot);
    expect(paths.morningReviewSchemaPath).toBe(
      path.join(reportRoot, "repo-improvement-morning-review-schema-latest.json")
    );
    expect(paths.reviewScriptPath).toBe(
      path.join(scriptRoot, "record_repo_improvement_review.ps1")
    );
  });

  it("returns unavailable when artifacts have not been generated yet", async () => {
    const { root, reportRoot, scriptRoot } = await makeTempRoots();
    cleanupPaths.push(root);

    const snapshot = await getRepoImprovementSnapshot({
      ...process.env,
      REPO_IMPROVEMENT_REPORT_ROOT: reportRoot,
      REPO_IMPROVEMENT_SCRIPT_ROOT: scriptRoot,
    });

    expect(snapshot.status).toBe("unavailable");
    expect(snapshot.reviewSchema).toBeNull();
    expect(snapshot.metrics).toBeNull();
    expect(snapshot.detail).toContain("Morning review schema has not been generated yet.");
    expect(snapshot.detail).toContain("Review recorder script is missing");
  });

  it("returns available when review schema, metrics, and review script are present", async () => {
    const { root, reportRoot, scriptRoot } = await makeTempRoots();
    cleanupPaths.push(root);

    await writeFile(
      path.join(scriptRoot, "record_repo_improvement_review.ps1"),
      "Write-Output '{}'",
      "utf8"
    );
    await writeFile(
      path.join(reportRoot, "repo-improvement-morning-review-schema-latest.json"),
      JSON.stringify(
        {
          summary: {
            generated_at: "2026-04-03T12:00:00.000Z",
            pending_review_count: 1,
            metrics_json_report_path: path.join(
              reportRoot,
              "repo-improvement-metrics-latest.json"
            ),
            training_dataset_path: path.join(
              reportRoot,
              "repo-improvement-training-dataset-latest.json"
            ),
          },
          schema: {
            schema_version: "2026-04-02",
            decision_labels: [
              {
                id: "approve",
                description: "Approve",
                counts_as_accept: true,
                requires_reason_code: true,
              },
            ],
            reason_codes: [
              {
                id: "critical-runtime-fix",
                decisions: ["approve"],
                description: "Keeps the app running.",
              },
            ],
            outcome_labels: [
              { id: "pending", description: "Pending" },
              { id: "stable", description: "Stable" },
              { id: "reverted", description: "Reverted" },
              { id: "superseded", description: "Superseded" },
            ],
            required_fields: [
              "review_id",
              "repo",
              "run_id",
              "decision",
              "reason_code",
              "reviewer",
              "decision_recorded_at",
            ],
          },
          inbox_items: [
            {
              review_id: "run-1::agency-os-mission-control",
              repo: "agency-os-mission-control",
              run_id: "run-1",
              generated_at: "2026-04-03T12:00:00.000Z",
              overnight_decision: "keep",
              score: "98",
              proposal_ready: true,
              proposal_patch_class: "gcloud-runtime-hardening",
              proposal_summary: "Bounded runtime hardening proposal.",
              proposal_path: "C:\\reports\\proposal.json",
              failure_signature: "lint:timeout",
              fix_classes: ["gcloud-runtime-hardening"],
              files_touched: ["scripts\\revenue-cadence-audit.mjs"],
              verifier_passed_count: 3,
              verifier_total_count: 4,
              evidence_refs: ["C:\\reports\\run-1.md"],
            },
          ],
        },
        null,
        2
      ),
      "utf8"
    );
    await writeFile(
      path.join(reportRoot, "repo-improvement-metrics-latest.json"),
      JSON.stringify(
        {
          summary: {
            generated_at: "2026-04-03T12:00:00.000Z",
            review_entry_count: 4,
            pending_review_count: 1,
            reviewed_count: 3,
          },
          rates: {
            proposal_rate: 1,
            keep_rate: 0.5,
            morning_approval_rate: 0.75,
            revert_rate: 0,
            verifier_pass_rate: 0.9,
            repeat_failure_rate: 0.25,
            time_to_accept_hours: 1.5,
          },
          promotion_policy: {
            window_days: 30,
            min_approved_runs: 5,
          },
          promotion_candidates: [
            {
              fix_class: "gcloud-runtime-hardening",
              reviewed_runs: 3,
              approved_runs: 3,
              approval_rate: 1,
              verifier_pass_rate: 1,
              revert_count: 0,
              promotion_ready: false,
              promotion_reason: "needs 5 approvals",
            },
          ],
          per_repo: [
            {
              repo: "agency-os-mission-control",
              run_count: 4,
              pending_review_count: 1,
              overnight_keep_count: 2,
              morning_approve_count: 3,
              verifier_pass_rate: 0.9,
            },
          ],
        },
        null,
        2
      ),
      "utf8"
    );

    const snapshot = await getRepoImprovementSnapshot({
      ...process.env,
      REPO_IMPROVEMENT_REPORT_ROOT: reportRoot,
      REPO_IMPROVEMENT_SCRIPT_ROOT: scriptRoot,
    });

    expect(snapshot.status).toBe("available");
    expect(snapshot.reviewScriptAvailable).toBe(true);
    expect(snapshot.reviewSchema?.summary.pending_review_count).toBe(1);
    expect(snapshot.metrics?.rates.morning_approval_rate).toBe(0.75);
    expect(snapshot.reviewSchema?.inbox_items[0]?.proposal_patch_class).toBe(
      "gcloud-runtime-hardening"
    );
  });
});
