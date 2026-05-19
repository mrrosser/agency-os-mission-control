import { describe, expect, it } from "vitest";
import {
  buildVerifiedClientReply,
  classifyAutofixTrigger,
  createClientAutofixRunRecord,
  evidenceIsGreen,
  findClientProject,
  getDefaultClientProjectRegistry,
  type EvidenceBundle,
} from "@/lib/client-autofix";

const greenEvidence: EvidenceBundle = {
  test_results: [
    {
      name: "client-build",
      command: "npm run build",
      status: "passed",
    },
  ],
  route_checks: [
    {
      name: "approvals",
      url: "https://socialops.example/approvals?client_id=fortifyy_roofs",
      status_code: 200,
      ok: true,
      screenshot_path: "artifacts/socialops/approvals.png",
    },
  ],
  playwright_screenshots: ["artifacts/socialops/approvals.png"],
  playwright_traces: ["artifacts/socialops/trace.zip"],
  final_client_visible_url: "https://socialops.example/approvals?client_id=fortifyy_roofs",
};

describe("client autofix supervisor", () => {
  it("classifies trigger aliases", () => {
    expect(classifyAutofixTrigger("gmail")).toBe("client_email");
    expect(classifyAutofixTrigger("ci")).toBe("github_check");
    expect(classifyAutofixTrigger("chrome")).toBe("playwright");
    expect(classifyAutofixTrigger("unknown")).toBe("manual");
  });

  it("finds SocialOps as an allowlisted client project", () => {
    const registry = getDefaultClientProjectRegistry({
      ...process.env,
      SOCIALOPS_GITHUB_REPO_URL: "https://github.com/example/smauto.git",
    });
    const entry = findClientProject(
      { project_id: "socialops", repo_id: "smauto", client_id: "fortifyy_roofs" },
      registry
    );

    expect(entry?.repo_id).toBe("smauto");
    expect(entry?.allowed_file_roots).toContain("socialops-client");
    expect(entry?.playwright_specs[0]?.name).toBe("socialops-client-approval-routes");
  });

  it("blocks non-client-project requests", () => {
    const run = createClientAutofixRunRecord({
      request: {
        client_id: "fortifyy_roofs",
        project_id: "unknown-project",
        trigger_source: "client_email",
        issue_summary: "Approval link is broken.",
        autonomy_mode: "full_autopilot_client_projects",
        deploy_target: "staging",
      },
      entry: null,
      correlationId: "corr-1",
      requestedByUid: "user-1",
    });

    expect(run.status).toBe("blocked_not_client_project");
    expect(run.client_followup_status).toBe("held_until_verified");
  });

  it("reports missing GitHub remote while preserving local fix intent", () => {
    const entry = getDefaultClientProjectRegistry({ ...process.env, SOCIALOPS_GITHUB_REPO_URL: "" })[0]!;
    const run = createClientAutofixRunRecord({
      request: {
        client_id: "fortifyy_roofs",
        project_id: "socialops",
        repo_id: "smauto",
        trigger_source: "client_email",
        issue_summary: "Approval link is broken.",
        autonomy_mode: "full_autopilot_client_projects",
        deploy_target: "production",
      },
      entry,
      correlationId: "corr-1",
      requestedByUid: "user-1",
    });

    expect(run.status).toBe("push_blocked_missing_remote");
    expect(run.branch).toContain("codex/client-autofix-socialops-fortifyy-roofs");
    expect(run.blockers).toContain(
      "GitHub remote is not configured; local patch/test may run but push/PR is blocked."
    );
  });

  it("blocks client projects when the project kill switch is read-only", () => {
    const entry = getDefaultClientProjectRegistry({
      ...process.env,
      SOCIALOPS_GITHUB_REPO_URL: "https://github.com/example/smauto.git",
      CLIENT_AUTOFIX_SOCIALOPS_READ_ONLY: "1",
    })[0]!;
    const run = createClientAutofixRunRecord({
      request: {
        action: "client_autofix.run",
        client_id: "fortifyy_roofs",
        project_id: "socialops",
        repo_id: "smauto",
        trigger_source: "client_email",
        issue_summary: "Approval link is broken.",
        autonomy_mode: "full_autopilot_client_projects",
        deploy_target: "production",
      },
      entry,
      correlationId: "corr-1",
      requestedByUid: "user-1",
    });

    expect(run.status).toBe("blocked_kill_switch");
    expect(run.blockers).toContain("Client project socialops kill switch is read_only.");
    expect(run.sub_agent_plan.every((step) => step.status === "blocked")).toBe(true);
  });

  it("requires tests, passing route checks, visual evidence, trace evidence, and client URL before follow-up", () => {
    expect(evidenceIsGreen(greenEvidence)).toBe(true);
    expect(
      evidenceIsGreen({
        ...greenEvidence,
        playwright_screenshots: [],
        route_checks: [{ ...greenEvidence.route_checks[0]!, screenshot_path: undefined }],
      })
    ).toBe(false);
    expect(
      evidenceIsGreen({
        ...greenEvidence,
        route_checks: [{ ...greenEvidence.route_checks[0]!, status_code: 404, ok: false }],
      })
    ).toBe(false);
    expect(evidenceIsGreen({ ...greenEvidence, playwright_traces: [] })).toBe(false);
    expect(evidenceIsGreen({ ...greenEvidence, final_client_visible_url: undefined })).toBe(false);
  });

  it("marks runs verified and client follow-up ready only with green evidence", () => {
    const entry = getDefaultClientProjectRegistry({
      ...process.env,
      SOCIALOPS_GITHUB_REPO_URL: "https://github.com/example/smauto.git",
    })[0]!;
    const run = createClientAutofixRunRecord({
      request: {
        client_id: "fortifyy_roofs",
        project_id: "socialops",
        repo_id: "smauto",
        trigger_source: "client_email",
        issue_summary: "Approval link is broken.",
        autonomy_mode: "full_autopilot_client_projects",
        deploy_target: "production",
        evidence_bundle: greenEvidence,
      },
      entry,
      correlationId: "corr-1",
      requestedByUid: "user-1",
    });

    expect(run.status).toBe("verified");
    expect(run.client_followup_status).toBe("ready_to_send");
  });

  it("generates a concise Marcus-style verified reply", () => {
    const reply = buildVerifiedClientReply("Beth");

    expect(reply).toContain("Hi Beth,");
    expect(reply).toContain("I fixed that and checked it in Chrome");
    expect(reply).toContain("Marcus");
    expect(reply.split("\n").length).toBeLessThan(12);
  });
});
