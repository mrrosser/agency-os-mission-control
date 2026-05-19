import { beforeAll, describe, expect, it } from "vitest";

let buildLeadgenDigest: (payload: Record<string, unknown>, options?: Record<string, unknown>) => Record<string, unknown>;
let extractMissingEnvVars: (results: Array<Record<string, unknown>>) => string[];
let renderLeadgenDigestMarkdown: (digest: Record<string, unknown>) => string;

beforeAll(async () => {
  const mod = (await import("../../scripts/leadgen-digest-run.mjs")) as {
    buildLeadgenDigest: typeof buildLeadgenDigest;
    extractMissingEnvVars: typeof extractMissingEnvVars;
    renderLeadgenDigestMarkdown: typeof renderLeadgenDigestMarkdown;
  };
  buildLeadgenDigest = mod.buildLeadgenDigest;
  extractMissingEnvVars = mod.extractMissingEnvVars;
  renderLeadgenDigestMarkdown = mod.renderLeadgenDigestMarkdown;
});

function row(overrides: Partial<Record<string, unknown>>) {
  return {
    lane: "leadgen",
    target: "agency revenue day1",
    status: "fail",
    exit_code: 1,
    notes: "Missing REVENUE_DAY1_WORKER_TOKEN",
    preflight_status: "passed",
    execution_status: "passed",
    execution_summary: "authorized",
    scope: "revenue.followup.day1",
    trust_level: "medium",
    agent_id: "automation-control-plane/leadgen",
    ...overrides,
  };
}

describe("leadgen digest runner", () => {
  it("extracts unique missing env vars from failure notes", () => {
    const vars = extractMissingEnvVars([
      row({ notes: "Missing REVENUE_DAY1_WORKER_TOKEN" }),
      row({ notes: "Missing REVENUE_DAY2_WORKER_TOKEN (or REVENUE_DAY1_WORKER_TOKEN fallback)" }),
      row({ notes: "Missing GCP_PROJECT_ID (or GOOGLE_CLOUD_PROJECT)." }),
    ]);

    expect(vars).toEqual([
      "GCP_PROJECT_ID",
      "GOOGLE_CLOUD_PROJECT",
      "REVENUE_DAY1_WORKER_TOKEN",
      "REVENUE_DAY2_WORKER_TOKEN",
    ]);
  });

  it("builds digest sections and urgent actions for leadgen lane", () => {
    const payload = {
      summary: {
        run_id: "run-123",
        lane: "leadgen",
        passed: false,
        status_counts: { fail: 7, pass: 5 },
      },
      lanes: [
        {
          lane: "leadgen",
          results: [
            row({
              target: "agency revenue day1",
              notes: "Missing REVENUE_DAY1_WORKER_TOKEN",
            }),
            row({
              target: "agency revenue day2",
              notes: "Missing REVENUE_DAY2_WORKER_TOKEN",
            }),
            row({
              target: "agency revenue day30",
              notes: "Missing REVENUE_DAY30_WORKER_TOKEN",
            }),
            row({
              target: "agency weekly kpi rollup",
              notes: "Missing REVENUE_WEEKLY_KPI_WORKER_TOKEN",
            }),
            row({
              target: "agency revenue cadence audit",
              notes: "Missing GCP_PROJECT_ID (or GOOGLE_CLOUD_PROJECT).",
            }),
            row({
              target: "agency social dispatch",
              notes: "Missing SOCIAL_DRAFT_WORKER_TOKEN",
            }),
          ],
        },
      ],
    };

    const digest = buildLeadgenDigest(payload, {
      sourceReportPath: "C:\\reports\\control-plane-leadgen-live.json",
      generatedAt: "2026-03-20T17:00:00.000Z",
    }) as {
      meta: { sourceRunId: string; sourceLane: string };
      sourcingRuns: Array<{ target: string; status: string }>;
      schedulerCadence: { status: string };
      dispatch: { status: string };
      actions: Array<{ priority: string; title: string }>;
    };

    expect(digest.meta.sourceRunId).toBe("run-123");
    expect(digest.meta.sourceLane).toBe("leadgen");
    expect(digest.sourcingRuns.map((item) => item.target)).toEqual([
      "agency revenue day1",
      "agency revenue day2",
      "agency revenue day30",
    ]);
    expect(digest.sourcingRuns.every((item) => item.status === "fail")).toBe(true);
    expect(digest.schedulerCadence.status).toBe("fail");
    expect(digest.dispatch.status).toBe("fail");
    expect(digest.actions[0]?.priority).toBe("urgent");
    expect(digest.actions[0]?.title.toLowerCase()).toContain("runtime env vars");

    const markdown = renderLeadgenDigestMarkdown(digest as unknown as Record<string, unknown>);
    expect(markdown).toContain("# Leadgen Digest");
    expect(markdown).toContain("## Top Urgent/Today Actions");
    expect(markdown).toContain("Day1");
  });
});

