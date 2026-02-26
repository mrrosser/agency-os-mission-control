#!/usr/bin/env node

import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

function parseIntOrFallback(value, fallback) {
  const parsed = Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
}

function safeNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toIsoDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.valueOf()) ? null : parsed.toISOString();
  }
  if (typeof value.toDate === "function") {
    try {
      return value.toDate().toISOString();
    } catch {
      return null;
    }
  }
  return null;
}

function variantFromTemplateId(templateId) {
  const match = String(templateId || "").match(/-exp-([a-z0-9]+)$/i);
  if (!match) return "A";
  return String(match[1] || "B").toUpperCase();
}

function baseTemplateFromTemplateId(templateId) {
  return String(templateId || "").replace(/-exp-[a-z0-9]+$/i, "");
}

function pct(numerator, denominator) {
  if (!denominator) return 0;
  return Math.round((numerator / denominator) * 10000) / 100;
}

function markdownRow(columns) {
  return `| ${columns.join(" | ")} |`;
}

function compareNullableIsoDesc(left, right) {
  const leftMs = left ? Date.parse(left) : Number.NaN;
  const rightMs = right ? Date.parse(right) : Number.NaN;
  if (Number.isFinite(leftMs) && Number.isFinite(rightMs)) return rightMs - leftMs;
  if (Number.isFinite(leftMs)) return -1;
  if (Number.isFinite(rightMs)) return 1;
  return 0;
}

function summarizeDecisionCounts(decisions) {
  return decisions.reduce(
    (acc, decision) => {
      acc[decision.action] += 1;
      return acc;
    },
    { keep: 0, fix: 0, kill: 0, watch: 0 }
  );
}

function toRateMetrics(entry) {
  return {
    qualificationPct: pct(entry.scoredTotal, entry.candidateTotal),
    meetingPct: pct(entry.meetingsScheduled, entry.processedLeads),
    failurePct: pct(entry.failedLeads, entry.processedLeads),
    emailCoveragePct: pct(entry.emailsDrafted, entry.processedLeads),
  };
}

function controlByBaseTemplate(aggregated) {
  const grouped = new Map();
  for (const entry of aggregated) {
    const rows = grouped.get(entry.baseTemplateId) || [];
    rows.push(entry);
    grouped.set(entry.baseTemplateId, rows);
  }

  const controls = new Map();
  for (const [baseTemplateId, rows] of grouped.entries()) {
    const withControlVariant = rows.filter((row) => row.variant === "A");
    const candidates = withControlVariant.length > 0 ? withControlVariant : rows;
    candidates.sort((a, b) => {
      if (b.runs !== a.runs) return b.runs - a.runs;
      if (b.processedLeads !== a.processedLeads) return b.processedLeads - a.processedLeads;
      return compareNullableIsoDesc(a.lastRunAt, b.lastRunAt);
    });
    controls.set(baseTemplateId, candidates[0] || null);
  }

  return controls;
}

function normalizeThresholds(input) {
  return {
    minRuns: Math.max(1, safeNumber(input.minRuns)),
    minProcessedLeads: Math.max(1, safeNumber(input.minProcessedLeads)),
    keepMeetingLiftPct: Math.max(0, safeNumber(input.keepMeetingLiftPct)),
    keepQualificationDropPct: Math.max(0, safeNumber(input.keepQualificationDropPct)),
    keepFailureRisePct: Math.max(0, safeNumber(input.keepFailureRisePct)),
    killMeetingDropPct: Math.max(0, safeNumber(input.killMeetingDropPct)),
    killQualificationDropPct: Math.max(0, safeNumber(input.killQualificationDropPct)),
    killFailureRisePct: Math.max(0, safeNumber(input.killFailureRisePct)),
  };
}

export function parseDecisionThresholdsFromEnv(env = process.env) {
  return normalizeThresholds({
    minRuns: parseIntOrFallback(env.REVENUE_VARIANT_DECISION_MIN_RUNS, 3),
    minProcessedLeads: parseIntOrFallback(env.REVENUE_VARIANT_DECISION_MIN_PROCESSED, 12),
    keepMeetingLiftPct: safeNumber(env.REVENUE_VARIANT_DECISION_KEEP_MEETING_LIFT_PCT || 2),
    keepQualificationDropPct: safeNumber(env.REVENUE_VARIANT_DECISION_KEEP_QUAL_DROP_PCT || 3),
    keepFailureRisePct: safeNumber(env.REVENUE_VARIANT_DECISION_KEEP_FAILURE_RISE_PCT || 4),
    killMeetingDropPct: safeNumber(env.REVENUE_VARIANT_DECISION_KILL_MEETING_DROP_PCT || 5),
    killQualificationDropPct: safeNumber(env.REVENUE_VARIANT_DECISION_KILL_QUAL_DROP_PCT || 8),
    killFailureRisePct: safeNumber(env.REVENUE_VARIANT_DECISION_KILL_FAILURE_RISE_PCT || 10),
  });
}

function classifySingleVariantDecision({ entry, control, thresholds }) {
  const metrics = toRateMetrics(entry);
  const baseDecision = {
    templateId: entry.templateId,
    baseTemplateId: entry.baseTemplateId,
    variant: entry.variant,
    action: "watch",
    reason: "Insufficient sample volume to classify this variant yet.",
    metrics: {
      runs: entry.runs,
      candidateTotal: entry.candidateTotal,
      scoredTotal: entry.scoredTotal,
      processedLeads: entry.processedLeads,
      meetingsScheduled: entry.meetingsScheduled,
      emailsDrafted: entry.emailsDrafted,
      noEmail: entry.noEmail,
      failedLeads: entry.failedLeads,
      qualificationPct: metrics.qualificationPct,
      meetingPct: metrics.meetingPct,
      failurePct: metrics.failurePct,
      emailCoveragePct: metrics.emailCoveragePct,
    },
    comparator: null,
  };

  const underSampled =
    entry.runs < thresholds.minRuns || entry.processedLeads < thresholds.minProcessedLeads;
  if (underSampled) {
    return {
      ...baseDecision,
      reason: `Needs >=${thresholds.minRuns} runs and >=${thresholds.minProcessedLeads} processed leads (current ${entry.runs}/${entry.processedLeads}).`,
    };
  }

  if (!control) {
    return {
      ...baseDecision,
      action: "keep",
      reason: "No control variant found; keep as temporary baseline.",
    };
  }

  if (entry.templateId === control.templateId) {
    return {
      ...baseDecision,
      action: "keep",
      reason: "Control baseline variant remains active.",
    };
  }

  const controlMetrics = toRateMetrics(control);
  const meetingDeltaPct = Math.round((metrics.meetingPct - controlMetrics.meetingPct) * 100) / 100;
  const qualificationDeltaPct =
    Math.round((metrics.qualificationPct - controlMetrics.qualificationPct) * 100) / 100;
  const failureDeltaPct = Math.round((metrics.failurePct - controlMetrics.failurePct) * 100) / 100;

  const comparator = {
    controlTemplateId: control.templateId,
    controlVariant: control.variant,
    meetingDeltaPct,
    qualificationDeltaPct,
    failureDeltaPct,
  };

  const keepCandidate =
    meetingDeltaPct >= thresholds.keepMeetingLiftPct &&
    qualificationDeltaPct >= -thresholds.keepQualificationDropPct &&
    failureDeltaPct <= thresholds.keepFailureRisePct;

  if (keepCandidate) {
    return {
      ...baseDecision,
      action: "keep",
      reason: `Outperforming control (meeting +${meetingDeltaPct}pp, qualification ${qualificationDeltaPct >= 0 ? "+" : ""}${qualificationDeltaPct}pp, failure ${failureDeltaPct >= 0 ? "+" : ""}${failureDeltaPct}pp).`,
      comparator,
    };
  }

  const killCandidate =
    meetingDeltaPct <= -thresholds.killMeetingDropPct ||
    qualificationDeltaPct <= -thresholds.killQualificationDropPct ||
    failureDeltaPct >= thresholds.killFailureRisePct;

  if (killCandidate) {
    return {
      ...baseDecision,
      action: "kill",
      reason: `Underperforming control past kill threshold (meeting ${meetingDeltaPct >= 0 ? "+" : ""}${meetingDeltaPct}pp, qualification ${qualificationDeltaPct >= 0 ? "+" : ""}${qualificationDeltaPct}pp, failure ${failureDeltaPct >= 0 ? "+" : ""}${failureDeltaPct}pp).`,
      comparator,
    };
  }

  return {
    ...baseDecision,
    action: "fix",
    reason: `Mixed performance vs control; run a targeted fix test before scaling (meeting ${meetingDeltaPct >= 0 ? "+" : ""}${meetingDeltaPct}pp, qualification ${qualificationDeltaPct >= 0 ? "+" : ""}${qualificationDeltaPct}pp, failure ${failureDeltaPct >= 0 ? "+" : ""}${failureDeltaPct}pp).`,
    comparator,
  };
}

export function classifyVariantDecisions(args) {
  const aggregated = Array.isArray(args.aggregated) ? args.aggregated : [];
  const thresholds = normalizeThresholds(args.thresholds || {});
  const controlByBase = controlByBaseTemplate(aggregated);

  const ordered = [...aggregated].sort((a, b) => {
    if (a.baseTemplateId !== b.baseTemplateId) return a.baseTemplateId.localeCompare(b.baseTemplateId);
    if (a.variant !== b.variant) return a.variant.localeCompare(b.variant);
    return a.templateId.localeCompare(b.templateId);
  });

  const decisions = ordered.map((entry) =>
    classifySingleVariantDecision({
      entry,
      control: controlByBase.get(entry.baseTemplateId) || null,
      thresholds,
    })
  );

  return {
    decisions,
    decisionSummary: summarizeDecisionCounts(decisions),
    thresholds,
  };
}

function buildMarkdownReport(args) {
  const {
    generatedAt,
    uid,
    days,
    runCount,
    aggregated,
    cutoffIso,
    warnings,
    decisions,
    decisionSummary,
  } = args;

  const lines = [
    `# Variant Split Report (${generatedAt.slice(0, 10)})`,
    "",
    `- UID: \`${uid}\``,
    `- Window: last ${days} day(s)`,
    `- Cutoff UTC: ${cutoffIso}`,
    `- Runs scanned: ${runCount}`,
    `- Decision summary: keep=${decisionSummary.keep}, fix=${decisionSummary.fix}, kill=${decisionSummary.kill}, watch=${decisionSummary.watch}`,
    "",
  ];

  if (warnings.length) {
    lines.push("## Warnings");
    for (const warning of warnings) {
      lines.push(`- ${warning}`);
    }
    lines.push("");
  }

  lines.push("## Template Performance");
  lines.push("");
  lines.push(
    markdownRow([
      "Template",
      "Variant",
      "Runs",
      "Candidates",
      "Scored",
      "Qualification %",
      "Processed",
      "Meetings",
      "Meeting %",
      "Emails Drafted",
      "No Email",
      "Failed Leads",
    ])
  );
  lines.push(markdownRow(["---", "---", "---", "---", "---", "---", "---", "---", "---", "---", "---", "---"]));

  for (const entry of aggregated) {
    lines.push(
      markdownRow([
        `\`${entry.templateId}\``,
        entry.variant,
        String(entry.runs),
        String(entry.candidateTotal),
        String(entry.scoredTotal),
        `${pct(entry.scoredTotal, entry.candidateTotal)}%`,
        String(entry.processedLeads),
        String(entry.meetingsScheduled),
        `${pct(entry.meetingsScheduled, entry.processedLeads)}%`,
        String(entry.emailsDrafted),
        String(entry.noEmail),
        String(entry.failedLeads),
      ])
    );
  }

  lines.push("");
  lines.push("## Deterministic Variant Decisions");
  lines.push("");
  lines.push(
    markdownRow([
      "Template",
      "Variant",
      "Action",
      "Meeting %",
      "Qualification %",
      "Failure %",
      "vs Control Meeting (pp)",
      "vs Control Qual (pp)",
      "vs Control Fail (pp)",
      "Reason",
    ])
  );
  lines.push(markdownRow(["---", "---", "---", "---", "---", "---", "---", "---", "---", "---"]));

  for (const decision of decisions) {
    lines.push(
      markdownRow([
        `\`${decision.templateId}\``,
        decision.variant,
        decision.action.toUpperCase(),
        `${decision.metrics.meetingPct}%`,
        `${decision.metrics.qualificationPct}%`,
        `${decision.metrics.failurePct}%`,
        decision.comparator ? String(decision.comparator.meetingDeltaPct) : "-",
        decision.comparator ? String(decision.comparator.qualificationDeltaPct) : "-",
        decision.comparator ? String(decision.comparator.failureDeltaPct) : "-",
        decision.reason,
      ])
    );
  }

  lines.push("");
  lines.push("## Action Hints");
  lines.push("");
  lines.push("- KEEP: maintain in scheduler payload and monitor for 7 more days.");
  lines.push("- FIX: run one focused creative/pricing/message patch test before next weekly rollup.");
  lines.push("- KILL: retire from scheduler payload and replace with a new hypothesis variant.");
  lines.push("- WATCH: wait for enough sample volume before taking side-effect actions.");

  return `${lines.join("\n")}\n`;
}

async function writeDecisionArtifacts(args) {
  const {
    outputPath,
    decisionJsonPath,
    markdown,
    decisionPayload,
  } = args;

  const absoluteOutputPath = path.resolve(outputPath);
  await fs.mkdir(path.dirname(absoluteOutputPath), { recursive: true });
  await fs.writeFile(absoluteOutputPath, markdown, "utf8");

  const absoluteDecisionPath = path.resolve(decisionJsonPath);
  await fs.mkdir(path.dirname(absoluteDecisionPath), { recursive: true });
  await fs.writeFile(absoluteDecisionPath, JSON.stringify(decisionPayload, null, 2) + "\n", "utf8");

  return {
    absoluteOutputPath,
    absoluteDecisionPath,
  };
}

async function maybePersistToFirestore(args) {
  const { db, uid, days, generatedAt, cutoffIso, runCount, decisions, decisionSummary } = args;
  if (!db) return false;

  const reportId = `${generatedAt.slice(0, 10)}-d${days}`;
  const payload = {
    uid,
    days,
    runCount,
    cutoffIso,
    generatedAt,
    decisionSummary,
    decisions,
    source: "revenue_variant_split_v2",
  };

  const root = db.collection("identities").doc(uid).collection("revenue_variant_decisions");
  await root.doc(reportId).set(payload, { merge: true });
  await root.doc("latest").set(payload, { merge: true });
  return true;
}

async function main() {
  const projectId =
    process.env.FIREBASE_PROJECT_ID ||
    process.env.GCP_PROJECT_ID ||
    process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const uid =
    process.env.REVENUE_VARIANT_UID ||
    process.env.REVENUE_AUTOMATION_UID ||
    process.env.REVENUE_DAY30_UID ||
    process.env.REVENUE_DAY2_UID ||
    process.env.REVENUE_DAY1_UID;
  const days = Math.max(1, Math.min(30, parseIntOrFallback(process.env.REVENUE_VARIANT_DAYS, 7)));
  const datePrefix = new Date().toISOString().slice(0, 10);
  const outputPath =
    process.env.REVENUE_VARIANT_REPORT_PATH ||
    path.join("docs", "reports", `${datePrefix}-variant-split-7d.md`);
  const decisionJsonPath =
    process.env.REVENUE_VARIANT_DECISION_PATH ||
    path.join("docs", "reports", `${datePrefix}-variant-decisions-7d.json`);
  const writeFirestore = String(process.env.REVENUE_VARIANT_WRITE_FIRESTORE || "")
    .trim()
    .toLowerCase() === "true";

  if (!uid) {
    throw new Error(
      "Missing REVENUE_VARIANT_UID (or REVENUE_AUTOMATION_UID/REVENUE_DAY30_UID/REVENUE_DAY2_UID/REVENUE_DAY1_UID)"
    );
  }

  if (!getApps().length) {
    initializeApp({
      credential: applicationDefault(),
      projectId: projectId || undefined,
    });
  }

  const db = getFirestore();
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const runSnap = await db
    .collection("lead_runs")
    .where("userId", "==", uid)
    .limit(2000)
    .get();

  const warnings = [];
  const templateStats = new Map();

  for (const doc of runSnap.docs) {
    const data = doc.data() || {};
    const createdAt = toIsoDate(data.createdAt);
    if (createdAt) {
      const createdMs = Date.parse(createdAt);
      if (Number.isFinite(createdMs) && createdMs < cutoff.getTime()) {
        continue;
      }
    }
    const automation = data.automation || {};
    const templateId = String(automation.templateId || "").trim();
    if (!templateId) {
      warnings.push(`Run ${doc.id} missing automation.templateId; skipped.`);
      continue;
    }

    const jobDoc = await doc.ref.collection("jobs").doc("default").get();
    const jobData = jobDoc.exists ? jobDoc.data() || {} : {};
    const diagnostics = jobData.diagnostics || {};

    const current = templateStats.get(templateId) || {
      templateId,
      baseTemplateId: baseTemplateFromTemplateId(templateId),
      variant: variantFromTemplateId(templateId),
      runs: 0,
      candidateTotal: 0,
      scoredTotal: 0,
      filteredOut: 0,
      processedLeads: 0,
      meetingsScheduled: 0,
      emailsDrafted: 0,
      noEmail: 0,
      failedLeads: 0,
      lastRunAt: null,
    };

    current.runs += 1;
    current.candidateTotal += safeNumber(data.candidateTotal);
    current.scoredTotal += safeNumber(data.total);
    current.filteredOut += safeNumber(data.filteredOut);
    current.processedLeads += safeNumber(diagnostics.processedLeads);
    current.meetingsScheduled += safeNumber(diagnostics.meetingsScheduled);
    current.emailsDrafted += safeNumber(diagnostics.emailsDrafted);
    current.noEmail += safeNumber(diagnostics.noEmail);
    current.failedLeads += safeNumber(diagnostics.failedLeads);

    const runCreatedAt = toIsoDate(data.createdAt);
    if (!current.lastRunAt || (runCreatedAt && runCreatedAt > current.lastRunAt)) {
      current.lastRunAt = runCreatedAt;
    }

    templateStats.set(templateId, current);
  }

  const aggregated = Array.from(templateStats.values()).sort((a, b) => {
    const meetingRateDiff = pct(b.meetingsScheduled, b.processedLeads) - pct(a.meetingsScheduled, a.processedLeads);
    if (meetingRateDiff !== 0) return meetingRateDiff;
    const qualificationDiff = pct(b.scoredTotal, b.candidateTotal) - pct(a.scoredTotal, a.candidateTotal);
    if (qualificationDiff !== 0) return qualificationDiff;
    return b.runs - a.runs;
  });

  const thresholds = parseDecisionThresholdsFromEnv(process.env);
  const { decisions, decisionSummary } = classifyVariantDecisions({
    aggregated,
    thresholds,
  });

  const generatedAt = new Date().toISOString();
  const markdown = buildMarkdownReport({
    generatedAt,
    uid,
    days,
    runCount: runSnap.size,
    aggregated,
    cutoffIso: cutoff.toISOString(),
    warnings,
    decisions,
    decisionSummary,
  });

  const decisionPayload = {
    uid,
    generatedAt,
    days,
    runCount: runSnap.size,
    cutoffIso: cutoff.toISOString(),
    thresholds,
    decisionSummary,
    decisions,
    warnings,
  };

  const { absoluteOutputPath, absoluteDecisionPath } = await writeDecisionArtifacts({
    outputPath,
    decisionJsonPath,
    markdown,
    decisionPayload,
  });

  const firestoreWritten = writeFirestore
    ? await maybePersistToFirestore({
        db,
        uid,
        days,
        generatedAt,
        cutoffIso: cutoff.toISOString(),
        runCount: runSnap.size,
        decisions,
        decisionSummary,
      })
    : false;

  process.stdout.write(
    JSON.stringify(
      {
        ok: true,
        uid,
        days,
        runsScanned: runSnap.size,
        templateCount: aggregated.length,
        decisionSummary,
        thresholds,
        outputPath: absoluteOutputPath,
        decisionPath: absoluteDecisionPath,
        firestoreWritten,
        generatedAt,
      },
      null,
      2
    ) + "\n"
  );
}

const isDirectRun =
  Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  main().catch((error) => {
    process.stderr.write(
      JSON.stringify(
        {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        },
        null,
        2
      ) + "\n"
    );
    process.exit(1);
  });
}
