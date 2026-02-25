#!/usr/bin/env node

import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import fs from "node:fs/promises";
import path from "node:path";

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

function buildMarkdownReport(args) {
  const {
    generatedAt,
    uid,
    days,
    runCount,
    aggregated,
    cutoffIso,
    warnings,
  } = args;

  const lines = [
    `# Variant Split Report (${generatedAt.slice(0, 10)})`,
    "",
    `- UID: \`${uid}\``,
    `- Window: last ${days} day(s)`,
    `- Cutoff UTC: ${cutoffIso}`,
    `- Runs scanned: ${runCount}`,
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
  lines.push("## Action Hints");
  lines.push("");
  lines.push("- Keep top meeting-rate variants active for another 7-day window before scale decisions.");
  lines.push("- If a variant has lower qualification + meeting rate than control, mark it for fix/retire.");
  lines.push("- Re-run this report daily and compare trend deltas, not single-run spikes.");

  return `${lines.join("\n")}\n`;
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
  const outputPath =
    process.env.REVENUE_VARIANT_REPORT_PATH ||
    path.join("docs", "reports", `${new Date().toISOString().slice(0, 10)}-variant-split-7d.md`);

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
    const automation = (data.automation || {});
    const templateId = String(automation.templateId || "").trim();
    if (!templateId) {
      warnings.push(`Run ${doc.id} missing automation.templateId; skipped.`);
      continue;
    }

    const jobDoc = await doc.ref.collection("jobs").doc("default").get();
    const jobData = jobDoc.exists ? (jobDoc.data() || {}) : {};
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

  const generatedAt = new Date().toISOString();
  const markdown = buildMarkdownReport({
    generatedAt,
    uid,
    days,
    runCount: runSnap.size,
    aggregated,
    cutoffIso: cutoff.toISOString(),
    warnings,
  });

  const absoluteOutputPath = path.resolve(outputPath);
  await fs.mkdir(path.dirname(absoluteOutputPath), { recursive: true });
  await fs.writeFile(absoluteOutputPath, markdown, "utf8");

  process.stdout.write(
    JSON.stringify(
      {
        ok: true,
        uid,
        days,
        runsScanned: runSnap.size,
        templateCount: aggregated.length,
        outputPath: absoluteOutputPath,
        generatedAt,
      },
      null,
      2
    ) + "\n"
  );
}

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
