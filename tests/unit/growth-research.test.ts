import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  getGrowthResearchPaths,
  getGrowthResearchSnapshot,
} from "@/lib/growth-research";

async function makeTempRoots() {
  const root = await mkdtemp(path.join(os.tmpdir(), "growth-research-"));
  const reportRoot = path.join(root, "reports");
  const scriptRoot = path.join(root, "scripts");
  await mkdir(reportRoot, { recursive: true });
  await mkdir(scriptRoot, { recursive: true });
  return { root, reportRoot, scriptRoot };
}

describe("growth-research helper", () => {
  const cleanupPaths: string[] = [];

  afterEach(async () => {
    await Promise.all(
      cleanupPaths.splice(0).map(async (target) => {
        await rm(target, { recursive: true, force: true });
      })
    );
  });

  it("builds growth-research paths from environment overrides", async () => {
    const { root, reportRoot, scriptRoot } = await makeTempRoots();
    cleanupPaths.push(root);

    const paths = getGrowthResearchPaths({
      ...process.env,
      GROWTH_RESEARCH_REPORT_ROOT: reportRoot,
      GROWTH_RESEARCH_SCRIPT_ROOT: scriptRoot,
    });

    expect(paths.reportRoot).toBe(reportRoot);
    expect(paths.scriptRoot).toBe(scriptRoot);
    expect(paths.weeklyReviewSchemaPath).toBe(
      path.join(reportRoot, "growth-research-weekly-review-schema-latest.json")
    );
    expect(paths.reviewScriptPath).toBe(
      path.join(scriptRoot, "record_growth_research_review.ps1")
    );
  });

  it("returns unavailable when artifacts have not been generated yet", async () => {
    const { root, reportRoot, scriptRoot } = await makeTempRoots();
    cleanupPaths.push(root);

    const snapshot = await getGrowthResearchSnapshot({
      ...process.env,
      GROWTH_RESEARCH_REPORT_ROOT: reportRoot,
      GROWTH_RESEARCH_SCRIPT_ROOT: scriptRoot,
    });

    expect(snapshot.status).toBe("unavailable");
    expect(snapshot.reviewSchema).toBeNull();
    expect(snapshot.metrics).toBeNull();
    expect(snapshot.detail).toContain("Weekly review schema has not been generated yet.");
    expect(snapshot.detail).toContain("Review recorder script is missing");
  });

  it("returns available when review schema, metrics, and review script are present", async () => {
    const { root, reportRoot, scriptRoot } = await makeTempRoots();
    cleanupPaths.push(root);

    await writeFile(
      path.join(scriptRoot, "record_growth_research_review.ps1"),
      "Write-Output '{}'",
      "utf8"
    );
    await writeFile(
      path.join(reportRoot, "growth-research-weekly-review-schema-latest.json"),
      JSON.stringify(
        {
          summary: {
            generated_at: "2026-04-06T12:00:00.000Z",
            pending_review_count: 1,
            metrics_json_report_path: path.join(
              reportRoot,
              "growth-research-metrics-latest.json"
            ),
            training_dataset_path: path.join(
              reportRoot,
              "growth-research-training-dataset-latest.json"
            ),
            promotion_candidate_count: 1,
            promotion_ready_count: 0,
          },
          governance: {
            mode: "read-only",
            attested: true,
            product_repo_writes_allowed: false,
            business_actions_allowed: false,
            shared_scaffold_only: true,
            review_required: true,
            scaffold_root: path.join(reportRoot, "growth-research-scaffolds"),
            notes: [
              "Growth-research does not edit product repos.",
              "Only shared CodexSkills scaffolds and repo-wrapper drafts may be generated automatically.",
            ],
          },
          schema: {
            schema_version: "2026-04-06",
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
                id: "strong-signal-win",
                decisions: ["approve"],
                description: "Objective signal supports approval.",
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
              "repo_or_domain",
              "run_id",
              "decision",
              "reason_code",
              "reviewer",
              "decision_recorded_at",
            ],
          },
          inbox_items: [
            {
              review_id: "run-1::redblue",
              repo_or_domain: "RT Solutions - RedBlueTeamKit",
              target_id: "redblue",
              run_id: "run-1",
              generated_at: "2026-04-06T12:00:00.000Z",
              evaluator_class: "security_assurance",
              score_status: "objective-ready",
              objective_score: 88.5,
              priority_score: 90.1,
              confidence: 0.9,
              signal_class_summary: "objective=5 proxy=2 operational=0 gaps=0",
              recommended_experiment: "Promote the best security evaluator.",
              recommended_experiment_class: "security-assurance-hardening",
              promotion_candidate: {
                recommendation_class: "security-assurance-hardening",
                reviewed_runs: 3,
                approved_runs: 3,
                approval_rate: 1,
                average_confidence: 0.9,
                revert_count: 0,
                promotion_ready: false,
                promotion_reason: "needs 5 approvals",
              },
              proposed_scaffold: {
                markdown_path: "C:\\reports\\redblue-draft.md",
              },
              evidence_refs: ["C:\\reports\\security-cycle.latest.json"],
            },
          ],
        },
        null,
        2
      ),
      "utf8"
    );
    await writeFile(
      path.join(reportRoot, "growth-research-metrics-latest.json"),
      JSON.stringify(
        {
          summary: {
            generated_at: "2026-04-06T12:00:00.000Z",
            review_entry_count: 4,
            pending_review_count: 1,
            reviewed_count: 3,
          },
          rates: {
            approval_rate: 0.67,
            defer_rate: 0.33,
            needs_human_rate: 0,
            stable_rate: 1,
            high_confidence_rate: 0.75,
            average_objective_score: 79.5,
            average_priority_score: 84.25,
            time_to_accept_hours: 5.5,
          },
          governance: {
            mode: "read-only",
            attested: true,
            product_repo_writes_allowed: false,
            business_actions_allowed: false,
            shared_scaffold_only: true,
            review_required: true,
            scaffold_root: path.join(reportRoot, "growth-research-scaffolds"),
            notes: [
              "Growth-research does not edit product repos.",
              "Only shared CodexSkills scaffolds and repo-wrapper drafts may be generated automatically.",
            ],
          },
          promotion_policy: {
            window_days: 30,
            min_approved_runs: 5,
          },
          promotion_candidates: [
            {
              recommendation_class: "security-assurance-hardening",
              reviewed_runs: 3,
              approved_runs: 3,
              approval_rate: 1,
              average_confidence: 0.9,
              revert_count: 0,
              promotion_ready: false,
              promotion_reason: "needs 5 approvals",
            },
          ],
          per_target: [
            {
              repo_or_domain: "RT Solutions - RedBlueTeamKit",
              run_count: 2,
              pending_review_count: 1,
              approved_count: 1,
              average_objective_score: 88.5,
              average_priority_score: 90.1,
            },
          ],
        },
        null,
        2
      ),
      "utf8"
    );

    const snapshot = await getGrowthResearchSnapshot({
      ...process.env,
      GROWTH_RESEARCH_REPORT_ROOT: reportRoot,
      GROWTH_RESEARCH_SCRIPT_ROOT: scriptRoot,
    });

    expect(snapshot.status).toBe("available");
    expect(snapshot.reviewScriptAvailable).toBe(true);
    expect(snapshot.reviewSchema?.summary.pending_review_count).toBe(1);
    expect(snapshot.reviewSchema?.governance?.product_repo_writes_allowed).toBe(
      false
    );
    expect(snapshot.metrics?.rates.average_priority_score).toBe(84.25);
    expect(snapshot.reviewSchema?.inbox_items[0]?.evaluator_class).toBe(
      "security_assurance"
    );
    expect(
      snapshot.reviewSchema?.inbox_items[0]?.promotion_candidate?.promotion_reason
    ).toBe("needs 5 approvals");
  });
});
