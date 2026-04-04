import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const TARGETS = {
  day1: "agency revenue day1",
  day2: "agency revenue day2",
  day30: "agency revenue day30",
  kpi: "agency weekly kpi rollup",
  cadence: "agency revenue cadence audit",
  dispatch: "agency social dispatch",
};

function safeString(value) {
  if (typeof value !== "string") return "";
  return value.trim();
}

function firstLine(value) {
  const text = safeString(value);
  if (!text) return "";
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) || "";
}

function normalizeStatus(value) {
  const status = safeString(value).toLowerCase();
  if (!status) return "unknown";
  return status;
}

function summarizeResult(row, fallbackTarget) {
  const target = safeString(row?.target) || fallbackTarget;
  return {
    target,
    status: normalizeStatus(row?.status),
    exitCode: Number.isFinite(Number(row?.exit_code)) ? Number(row.exit_code) : null,
    notes: firstLine(row?.notes),
    preflight: normalizeStatus(row?.preflight_status),
    execution: normalizeStatus(row?.execution_status),
    executionSummary: firstLine(row?.execution_summary),
    idempotency: safeString(row?.idempotency_reason),
    riskTier: safeString(row?.risk_tier),
    scope: safeString(row?.scope),
    trustLevel: safeString(row?.trust_level),
    agentId: safeString(row?.agent_id),
  };
}

function isLikelyEnvVar(token) {
  return token.includes("_") && /^[A-Z][A-Z0-9_]{4,}$/.test(token);
}

export function extractMissingEnvVars(results) {
  const values = new Set();
  for (const result of results) {
    if (normalizeStatus(result?.status) !== "fail") continue;
    const notes = safeString(result?.notes);
    if (!notes || !/missing/i.test(notes)) continue;
    for (const match of notes.matchAll(/\b[A-Z][A-Z0-9_]{4,}\b/g)) {
      const token = String(match[0] || "");
      if (isLikelyEnvVar(token)) values.add(token);
    }
  }
  return [...values].sort();
}

function getLeadgenRows(payload) {
  const lanes = Array.isArray(payload?.lanes) ? payload.lanes : [];
  const lane = lanes.find((item) => safeString(item?.lane) === "leadgen");
  if (!lane || !Array.isArray(lane.results)) return [];
  return lane.results;
}

function indexByTarget(rows) {
  const map = new Map();
  for (const row of rows) {
    const target = safeString(row?.target);
    if (target) map.set(target, row);
  }
  return map;
}

function statusFromSummary(statusCounts) {
  const entries = Object.entries(statusCounts || {});
  return entries
    .map(([key, value]) => `${key}=${value}`)
    .sort()
    .join(", ");
}

function topActionsFromState({
  missingEnvVars,
  cadenceStatus,
  dispatchStatus,
  kpiStatus,
  sourceErrors,
}) {
  const actions = [];

  if (missingEnvVars.length > 0) {
    actions.push({
      priority: "urgent",
      title: "Restore missing runtime env vars",
      detail: `Set: ${missingEnvVars.join(", ")}`,
    });
  }

  if (cadenceStatus === "fail") {
    actions.push({
      priority: "today",
      title: "Fix scheduler cadence audit mismatches",
      detail: "Validate scheduler jobs/time zone/base URL and rerun revenue cadence audit.",
    });
  }

  if (dispatchStatus === "fail" && missingEnvVars.length === 0) {
    actions.push({
      priority: "today",
      title: "Repair social dispatch execution path",
      detail: "Review social dispatch worker auth, base URL, and approval-gated dispatch route.",
    });
  }

  if (kpiStatus === "fail" && missingEnvVars.length === 0) {
    actions.push({
      priority: "today",
      title: "Repair weekly KPI worker inputs",
      detail: "Confirm KPI worker token/UID and weekly KPI endpoint configuration.",
    });
  }

  if (sourceErrors.length > 0) {
    actions.push({
      priority: "urgent",
      title: "Repair leadgen digest source report",
      detail: sourceErrors.join("; "),
    });
  }

  if (actions.length === 0) {
    actions.push({
      priority: "watch",
      title: "No urgent leadgen blockers",
      detail: "Lane looks healthy; continue normal monitoring cadence.",
    });
  }

  return actions.slice(0, 5);
}

export function buildLeadgenDigest(payload, options = {}) {
  const generatedAt = safeString(options.generatedAt) || new Date().toISOString();
  const sourceReportPath = safeString(options.sourceReportPath);
  const summary = payload?.summary || {};
  const rows = getLeadgenRows(payload);
  const byTarget = indexByTarget(rows);

  const sourceErrors = [];
  if (rows.length === 0) {
    sourceErrors.push("Leadgen lane results were not found in source report.");
  }

  const day1 = summarizeResult(byTarget.get(TARGETS.day1), TARGETS.day1);
  const day2 = summarizeResult(byTarget.get(TARGETS.day2), TARGETS.day2);
  const day30 = summarizeResult(byTarget.get(TARGETS.day30), TARGETS.day30);
  const kpi = summarizeResult(byTarget.get(TARGETS.kpi), TARGETS.kpi);
  const cadence = summarizeResult(byTarget.get(TARGETS.cadence), TARGETS.cadence);
  const dispatch = summarizeResult(byTarget.get(TARGETS.dispatch), TARGETS.dispatch);

  const approvals = rows
    .filter((row) => normalizeStatus(row?.execution_status) === "passed")
    .map((row) => ({
      target: safeString(row?.target),
      scope: safeString(row?.scope),
      trustLevel: safeString(row?.trust_level),
      agentId: safeString(row?.agent_id),
      summary: firstLine(row?.execution_summary),
    }));

  const missingEnvVars = extractMissingEnvVars(rows);
  const actions = topActionsFromState({
    missingEnvVars,
    cadenceStatus: cadence.status,
    dispatchStatus: dispatch.status,
    kpiStatus: kpi.status,
    sourceErrors,
  });

  return {
    meta: {
      generatedAt,
      sourceReportPath,
      sourceRunId: safeString(summary?.run_id),
      sourceLane: safeString(summary?.lane),
      sourceOverallPass: Boolean(summary?.passed),
      sourceStatusCounts: summary?.status_counts || {},
      sourceStatusSummary: statusFromSummary(summary?.status_counts),
      sourceErrors,
    },
    sourcingRuns: [day1, day2, day30],
    kpi,
    schedulerCadence: cadence,
    dispatch,
    approvals: {
      count: approvals.length,
      items: approvals,
    },
    actions,
  };
}

function markdownStatusLine(label, row) {
  const notes = row.notes ? ` - ${row.notes}` : "";
  return `- ${label}: **${row.status}** (exit ${row.exitCode ?? "n/a"})${notes}`;
}

export function renderLeadgenDigestMarkdown(digest) {
  const lines = [];
  lines.push("# Leadgen Digest");
  lines.push("");
  lines.push(`- Generated: ${digest.meta.generatedAt}`);
  lines.push(`- Source run ID: ${digest.meta.sourceRunId || "unknown"}`);
  lines.push(`- Source lane: ${digest.meta.sourceLane || "unknown"}`);
  lines.push(`- Source overall pass: ${String(digest.meta.sourceOverallPass)}`);
  lines.push(`- Source status counts: ${digest.meta.sourceStatusSummary || "unknown"}`);
  lines.push("");
  lines.push("## Day1 / Day2 / Day30 / KPI / Cadence / Dispatch");
  lines.push(markdownStatusLine("Day1", digest.sourcingRuns[0]));
  lines.push(markdownStatusLine("Day2", digest.sourcingRuns[1]));
  lines.push(markdownStatusLine("Day30", digest.sourcingRuns[2]));
  lines.push(markdownStatusLine("KPI", digest.kpi));
  lines.push(markdownStatusLine("Cadence", digest.schedulerCadence));
  lines.push(markdownStatusLine("Dispatch", digest.dispatch));
  lines.push("");
  lines.push("## Sourcing Runs");
  lines.push(...digest.sourcingRuns.map((row) => markdownStatusLine(row.target, row)));
  lines.push("");
  lines.push("## Scheduler Cadence");
  lines.push(markdownStatusLine("Cadence audit", digest.schedulerCadence));
  lines.push("");
  lines.push("## Approvals");
  lines.push(`- Approved execution envelopes: ${digest.approvals.count}`);
  for (const item of digest.approvals.items) {
    lines.push(
      `- ${item.target}: ${item.summary || "authorized"} (scope=${item.scope || "n/a"}, trust=${item.trustLevel || "n/a"})`
    );
  }
  lines.push("");
  lines.push("## KPI");
  lines.push(markdownStatusLine("Weekly KPI rollup", digest.kpi));
  lines.push("");
  lines.push("## Top Urgent/Today Actions");
  digest.actions.slice(0, 5).forEach((action, index) => {
    lines.push(`${index + 1}. [${action.priority.toUpperCase()}] ${action.title} - ${action.detail}`);
  });
  if (digest.meta.sourceErrors.length > 0) {
    lines.push("");
    lines.push("## Source Errors");
    digest.meta.sourceErrors.forEach((error) => {
      lines.push(`- ${error}`);
    });
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

async function loadControlPlaneReport(sourcePath) {
  const raw = await fs.readFile(sourcePath, "utf8");
  return JSON.parse(raw);
}

async function writeDigestFiles(outputDir, digest) {
  await fs.mkdir(outputDir, { recursive: true });
  const jsonPath = path.join(outputDir, "leadgen-digest-latest.json");
  const mdPath = path.join(outputDir, "leadgen-digest-latest.md");
  await fs.writeFile(jsonPath, `${JSON.stringify(digest, null, 2)}\n`, "utf8");
  await fs.writeFile(mdPath, renderLeadgenDigestMarkdown(digest), "utf8");
  return { jsonPath, mdPath };
}

async function main() {
  const runId = randomUUID();
  const sourcePath = safeString(process.env.LEADGEN_CONTROL_PLANE_JSON_PATH)
    || path.join(process.cwd(), "docs", "reports", "control-plane-latest.json");
  const outputDir = path.join(process.cwd(), "docs", "reports");

  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      level: "info",
      event: "leadgen.digest.start",
      run_id: runId,
      source_path: sourcePath,
      output_dir: outputDir,
    })
  );

  const payload = await loadControlPlaneReport(sourcePath);
  const digest = buildLeadgenDigest(payload, {
    sourceReportPath: sourcePath,
    generatedAt: new Date().toISOString(),
  });
  const files = await writeDigestFiles(outputDir, digest);

  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      level: "info",
      event: "leadgen.digest.complete",
      run_id: runId,
      json_path: files.jsonPath,
      report_path: files.mdPath,
      action_summary: digest.actions.slice(0, 2).map((item) => `${item.priority}:${item.title}`).join("; "),
      source_error_count: digest.meta.sourceErrors.length,
    })
  );
}

const entrypointUrl = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === entrypointUrl) {
  main().catch((error) => {
    console.error(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: "error",
        event: "leadgen.digest.fail",
        error: error instanceof Error ? error.message : String(error),
      })
    );
    process.exit(1);
  });
}
