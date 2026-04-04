import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

function asString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function asNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseBoolean(value, fallback = false) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) return fallback;
  return !["false", "0", "no", "off"].includes(normalized);
}

function toIso(value) {
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

function round2(value) {
  return Math.round(value * 100) / 100;
}

function markdownRow(columns) {
  return `| ${columns.join(" | ")} |`;
}

function statusFromFloorThresholds(value, passMin, warnMin) {
  if (value >= passMin) return "pass";
  if (value >= warnMin) return "warn";
  return "fail";
}

function normalizeOutcomeGates(raw) {
  if (!raw || typeof raw !== "object") return null;
  const row = raw;
  if (!Array.isArray(row.gates) || !row.summary || typeof row.summary !== "object") return null;

  const gates = row.gates
    .map((gate) => {
      if (!gate || typeof gate !== "object") return null;
      const id = asString(gate.id);
      const label = asString(gate.label);
      const threshold = asString(gate.threshold);
      const actual = asString(gate.actual);
      const status = asString(gate.status);
      if (!id || !label || !threshold || !actual) return null;
      if (!["pass", "warn", "fail"].includes(status)) return null;
      return { id, label, threshold, actual, status };
    })
    .filter(Boolean);

  if (gates.length !== 5) return null;

  const summary = row.summary || {};
  const criticalGateFailures = Array.isArray(row.criticalGateFailures)
    ? row.criticalGateFailures
        .map((value) => asString(value))
        .filter((value) => value === "throughput" || value === "revenue")
    : [];

  return {
    gates,
    summary: {
      passCount: asNumber(summary.passCount),
      warnCount: asNumber(summary.warnCount),
      failCount: asNumber(summary.failCount),
      passOrWarnCount: asNumber(summary.passOrWarnCount),
    },
    criticalGateFailures,
  };
}

function evaluateCanonicalOutcomeGates(kpi) {
  if (kpi.outcomeGates) return kpi.outcomeGates;

  const qualificationRatePct =
    kpi.leadsSourced > 0 ? round2((kpi.qualifiedLeads / kpi.leadsSourced) * 100) : 0;
  const meetingRatePct =
    kpi.leadsSourced > 0 ? round2((kpi.meetingsBooked / kpi.leadsSourced) * 100) : 0;

  const gates = [
    {
      id: "throughput",
      label: "Lead Throughput",
      threshold: "pass >= 10, warn 5-9, fail < 5 sourced leads/week",
      actual: `${kpi.leadsSourced} sourced lead(s)`,
      status: statusFromFloorThresholds(kpi.leadsSourced, 10, 5),
    },
    {
      id: "qualification",
      label: "Qualification",
      threshold: "pass >= 20%, warn 10-19.9%, fail < 10% (qualified/sourced)",
      actual: `${kpi.qualifiedLeads}/${kpi.leadsSourced} (${qualificationRatePct}%)`,
      status: statusFromFloorThresholds(qualificationRatePct, 20, 10),
    },
    {
      id: "meeting",
      label: "Meeting Rate",
      threshold: "pass >= 15%, warn 8-14.9%, fail < 8% (booked/sourced)",
      actual: `${kpi.meetingsBooked}/${kpi.leadsSourced} (${meetingRatePct}%)`,
      status: statusFromFloorThresholds(meetingRatePct, 15, 8),
    },
    {
      id: "revenue",
      label: "Revenue",
      threshold: "pass >= 1 deposit; warn 0 deposits with >= 2 meetings; fail otherwise",
      actual: `${kpi.depositsCollected} deposit(s), ${kpi.meetingsBooked} meeting(s)`,
      status:
        kpi.depositsCollected >= 1 ? "pass" : kpi.meetingsBooked >= 2 ? "warn" : "fail",
    },
    {
      id: "pipeline",
      label: "Pipeline Value",
      threshold: "pass >= $5000, warn $2000-$4999, fail < $2000 active pipeline",
      actual: `$${round2(kpi.pipelineValueUsd)}`,
      status: statusFromFloorThresholds(kpi.pipelineValueUsd, 5000, 2000),
    },
  ];

  const passCount = gates.filter((gate) => gate.status === "pass").length;
  const warnCount = gates.filter((gate) => gate.status === "warn").length;
  const failCount = gates.filter((gate) => gate.status === "fail").length;
  const criticalGateFailures = gates
    .filter(
      (gate) => (gate.id === "throughput" || gate.id === "revenue") && gate.status === "fail"
    )
    .map((gate) => gate.id);

  return {
    gates,
    summary: {
      passCount,
      warnCount,
      failCount,
      passOrWarnCount: passCount + warnCount,
    },
    criticalGateFailures,
  };
}

function normalizeReadiness(raw, outcomeGates) {
  if (raw && typeof raw === "object") {
    return {
      minimumPassOrWarnGates: Math.max(1, asNumber(raw.minimumPassOrWarnGates) || 3),
      targetConsecutiveWeeks: Math.max(1, asNumber(raw.targetConsecutiveWeeks) || 2),
      consecutiveReadyWeeks: Math.max(0, asNumber(raw.consecutiveReadyWeeks)),
      meetsTarget: Boolean(raw.meetsTarget),
      evaluatedWeeks: Math.max(0, asNumber(raw.evaluatedWeeks)),
      weeks: Array.isArray(raw.weeks)
        ? raw.weeks.map((week) => ({
            weekStartDate: asString(week.weekStartDate),
            passOrWarnCount: asNumber(week.passOrWarnCount),
            ready: Boolean(week.ready),
          }))
        : [],
    };
  }

  const minimumPassOrWarnGates = 3;
  const ready = outcomeGates.summary.passOrWarnCount >= minimumPassOrWarnGates;
  return {
    minimumPassOrWarnGates,
    targetConsecutiveWeeks: 2,
    consecutiveReadyWeeks: ready ? 1 : 0,
    meetsTarget: false,
    evaluatedWeeks: 1,
    weeks: [
      {
        weekStartDate: null,
        passOrWarnCount: outcomeGates.summary.passOrWarnCount,
        ready,
      },
    ],
  };
}

function normalizeKpiPayload(raw) {
  const row = raw || {};
  const summary = row.summary || {};
  const outcomeGates = evaluateCanonicalOutcomeGates({
    weekStartDate: asString(row.weekStartDate) || null,
    weekEndDate: asString(row.weekEndDate) || null,
    generatedAt: toIso(row.generatedAt),
    leadsSourced: asNumber(summary.leadsSourced),
    qualifiedLeads: asNumber(summary.qualifiedLeads),
    outreachReady: asNumber(summary.outreachReady),
    meetingsBooked: asNumber(summary.meetingsBooked),
    depositsCollected: asNumber(summary.depositsCollected),
    dealsWon: asNumber(summary.dealsWon),
    closeRatePct: asNumber(summary.closeRatePct),
    pipelineValueUsd: asNumber(summary.pipelineValueUsd),
    decisionSummary: {
      scale: asNumber(row.decisionSummary?.scale),
      fix: asNumber(row.decisionSummary?.fix),
      kill: asNumber(row.decisionSummary?.kill),
      watch: asNumber(row.decisionSummary?.watch),
    },
    outcomeGates: normalizeOutcomeGates(row.outcomeGates),
  });

  return {
    weekStartDate: asString(row.weekStartDate) || null,
    weekEndDate: asString(row.weekEndDate) || null,
    generatedAt: toIso(row.generatedAt),
    leadsSourced: asNumber(summary.leadsSourced),
    qualifiedLeads: asNumber(summary.qualifiedLeads),
    outreachReady: asNumber(summary.outreachReady),
    meetingsBooked: asNumber(summary.meetingsBooked),
    depositsCollected: asNumber(summary.depositsCollected),
    dealsWon: asNumber(summary.dealsWon),
    closeRatePct: asNumber(summary.closeRatePct),
    pipelineValueUsd: asNumber(summary.pipelineValueUsd),
    decisionSummary: {
      scale: asNumber(row.decisionSummary?.scale),
      fix: asNumber(row.decisionSummary?.fix),
      kill: asNumber(row.decisionSummary?.kill),
      watch: asNumber(row.decisionSummary?.watch),
    },
    outcomeGates,
    outcomeGateReadiness: normalizeReadiness(row.outcomeGateReadiness, outcomeGates),
  };
}

function normalizeVariantPayload(raw) {
  const row = raw || {};
  const decisionSummary = row.decisionSummary || {};
  return {
    generatedAt: asString(row.generatedAt) || null,
    days: asNumber(row.days),
    runsScanned: asNumber(row.runCount),
    decisionSummary: {
      keep: asNumber(decisionSummary.keep),
      fix: asNumber(decisionSummary.fix),
      kill: asNumber(decisionSummary.kill),
      watch: asNumber(decisionSummary.watch),
    },
  };
}

function evaluateOverallHealth(outcomeGates) {
  const score = outcomeGates.gates.reduce((acc, gate) => {
    if (gate.status === "pass") return acc + 1;
    if (gate.status === "warn") return acc + 0.5;
    return acc;
  }, 0);
  const overall =
    score >= 4.5 ? "healthy" : score >= 3 ? "watch" : score >= 2 ? "at_risk" : "critical";
  return {
    score: round2(score),
    maxScore: outcomeGates.gates.length,
    overall,
  };
}

function buildRecommendations(kpi, variant, gateEvaluation) {
  const byId = new Map(kpi.outcomeGates.gates.map((gate) => [gate.id, gate]));
  const recommendations = [];

  if (byId.get("throughput")?.status !== "pass") {
    recommendations.push(
      "Increase weekly sourced lead volume (query rotation, source mix, and enrichment capacity checks)."
    );
  }
  if (byId.get("qualification")?.status === "fail") {
    recommendations.push(
      "Tighten lead sourcing filters and qualification criteria to raise qualified/sourced ratio."
    );
  }
  if (byId.get("meeting")?.status === "fail") {
    recommendations.push(
      "Improve outreach-to-meeting conversion (faster follow-up cadence and stronger CTA proof points)."
    );
  }
  if (byId.get("revenue")?.status !== "pass") {
    recommendations.push(
      "Prioritize proposal-to-deposit conversion improvements before scaling outbound spend."
    );
  }
  if (byId.get("pipeline")?.status !== "pass") {
    recommendations.push(
      "Increase active pipeline value by steering volume toward higher-ticket offers."
    );
  }
  if (kpi.outcomeGateReadiness.consecutiveReadyWeeks < kpi.outcomeGateReadiness.targetConsecutiveWeeks) {
    recommendations.push(
      `Maintain >=${kpi.outcomeGateReadiness.minimumPassOrWarnGates}/5 pass|warn gates for ${kpi.outcomeGateReadiness.targetConsecutiveWeeks} consecutive weeks to close the outcome-gate milestone.`
    );
  }
  if (
    variant.decisionSummary.keep + variant.decisionSummary.fix + variant.decisionSummary.kill <
    1
  ) {
    recommendations.push(
      "Increase weekly experiment volume so keep/fix/kill decisions are based on non-zero outcome data."
    );
  }
  if (variant.decisionSummary.kill > 2) {
    recommendations.push(
      "Retire underperforming variants and focus on one replacement hypothesis per segment."
    );
  }
  if (recommendations.length === 0 && gateEvaluation.overall === "healthy") {
    recommendations.push(
      "Canonical outcome gates are healthy. Scale top-performing offer/channel combinations."
    );
  }

  return Array.from(new Set(recommendations)).slice(0, 6);
}

function buildMarkdown(payload) {
  const { generatedAt, uid, kpi, variant, gateEvaluation, recommendations } = payload;
  const lines = [
    `# Weekly Business Health Report (${generatedAt.slice(0, 10)})`,
    "",
    `- UID: \`${uid}\``,
    `- Generated: ${generatedAt}`,
    `- KPI Window: ${kpi.weekStartDate || "n/a"} to ${kpi.weekEndDate || "n/a"}`,
    `- Overall Health: **${gateEvaluation.overall}** (${gateEvaluation.score}/${gateEvaluation.maxScore})`,
    "",
    "## Core Metrics",
    "",
    markdownRow(["Metric", "Value"]),
    markdownRow(["---", "---"]),
    markdownRow(["Leads sourced", String(kpi.leadsSourced)]),
    markdownRow(["Qualified leads", String(kpi.qualifiedLeads)]),
    markdownRow(["Outreach-ready", String(kpi.outreachReady)]),
    markdownRow(["Meetings booked", String(kpi.meetingsBooked)]),
    markdownRow(["Deposits collected", String(kpi.depositsCollected)]),
    markdownRow(["Deals won", String(kpi.dealsWon)]),
    markdownRow(["Close rate %", `${round2(kpi.closeRatePct)}%`]),
    markdownRow(["Pipeline value", `$${round2(kpi.pipelineValueUsd)}`]),
    "",
    "## Canonical Outcome Gates",
    "",
    markdownRow(["Gate", "Threshold", "Actual", "Status"]),
    markdownRow(["---", "---", "---", "---"]),
  ];

  for (const gate of kpi.outcomeGates.gates) {
    lines.push(markdownRow([gate.label, gate.threshold, gate.actual, gate.status.toUpperCase()]));
  }

  lines.push("");
  lines.push("## Outcome Gate Readiness");
  lines.push("");
  lines.push(
    `- Pass/Warn Gates: ${kpi.outcomeGates.summary.passOrWarnCount}/5 (pass=${kpi.outcomeGates.summary.passCount}, warn=${kpi.outcomeGates.summary.warnCount}, fail=${kpi.outcomeGates.summary.failCount})`
  );
  lines.push(
    `- Critical gate failures: ${kpi.outcomeGates.criticalGateFailures.length > 0 ? kpi.outcomeGates.criticalGateFailures.join(", ") : "none"}`
  );
  lines.push(
    `- Consecutive ready weeks: ${kpi.outcomeGateReadiness.consecutiveReadyWeeks}/${kpi.outcomeGateReadiness.targetConsecutiveWeeks}`
  );
  lines.push(
    `- Two-week milestone met: ${kpi.outcomeGateReadiness.meetsTarget ? "yes" : "no"} (requires >=${kpi.outcomeGateReadiness.minimumPassOrWarnGates}/5 pass|warn)`
  );

  lines.push("");
  lines.push("## Supporting Signals");
  lines.push("");
  lines.push(
    `- KPI decisions: scale=${kpi.decisionSummary.scale}, fix=${kpi.decisionSummary.fix}, kill=${kpi.decisionSummary.kill}, watch=${kpi.decisionSummary.watch}`
  );
  lines.push(
    `- Variant decisions: keep=${variant.decisionSummary.keep}, fix=${variant.decisionSummary.fix}, kill=${variant.decisionSummary.kill}, watch=${variant.decisionSummary.watch}`
  );
  lines.push(`- Variant runs scanned: ${variant.runsScanned}`);
  if (variant.generatedAt) {
    lines.push(`- Variant report generated: ${variant.generatedAt}`);
  }

  lines.push("");
  lines.push("## Recommended Actions");
  lines.push("");
  for (const recommendation of recommendations) {
    lines.push(`- ${recommendation}`);
  }

  return `${lines.join("\n")}\n`;
}

async function readLatestDoc(db, uid, collectionName) {
  const snap = await db
    .collection("identities")
    .doc(uid)
    .collection(collectionName)
    .doc("latest")
    .get();
  return snap.exists ? snap.data() || null : null;
}

async function main() {
  const projectId =
    process.env.FIREBASE_PROJECT_ID ||
    process.env.GCP_PROJECT_ID ||
    process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const uid =
    process.env.REVENUE_HEALTH_UID ||
    process.env.REVENUE_VARIANT_UID ||
    process.env.REVENUE_WEEKLY_KPI_UID ||
    process.env.REVENUE_AUTOMATION_UID ||
    process.env.REVENUE_DAY30_UID ||
    process.env.REVENUE_DAY2_UID ||
    process.env.REVENUE_DAY1_UID;
  if (!uid) {
    throw new Error(
      "Missing REVENUE_HEALTH_UID (or REVENUE_VARIANT_UID/REVENUE_WEEKLY_KPI_UID/REVENUE_AUTOMATION_UID/REVENUE_DAY30_UID/REVENUE_DAY2_UID/REVENUE_DAY1_UID)"
    );
  }

  if (!getApps().length) {
    initializeApp({
      credential: applicationDefault(),
      projectId: projectId || undefined,
    });
  }

  const db = getFirestore();
  const [rawKpi, rawVariant] = await Promise.all([
    readLatestDoc(db, uid, "revenue_kpi_reports"),
    readLatestDoc(db, uid, "revenue_variant_decisions"),
  ]);

  const kpi = normalizeKpiPayload(rawKpi || {});
  const variant = normalizeVariantPayload(rawVariant || {});
  const gateEvaluation = evaluateOverallHealth(kpi.outcomeGates);
  const recommendations = buildRecommendations(kpi, variant, gateEvaluation);
  const generatedAt = new Date().toISOString();
  const datePrefix = generatedAt.slice(0, 10);

  const outputPath =
    process.env.REVENUE_HEALTH_REPORT_PATH ||
    path.join("docs", "reports", `${datePrefix}-weekly-business-health.md`);
  const jsonPath =
    process.env.REVENUE_HEALTH_JSON_PATH ||
    path.join("docs", "reports", `${datePrefix}-weekly-business-health.json`);
  const writeFirestore = parseBoolean(process.env.REVENUE_HEALTH_WRITE_FIRESTORE, true);

  const payload = {
    uid,
    generatedAt,
    kpi,
    variant,
    gateEvaluation,
    recommendations,
    source: "revenue_weekly_health_v2",
  };

  const markdown = buildMarkdown(payload);
  const absOutputPath = path.resolve(outputPath);
  const absJsonPath = path.resolve(jsonPath);
  await fs.mkdir(path.dirname(absOutputPath), { recursive: true });
  await fs.mkdir(path.dirname(absJsonPath), { recursive: true });
  await fs.writeFile(absOutputPath, markdown, "utf8");
  await fs.writeFile(absJsonPath, JSON.stringify(payload, null, 2) + "\n", "utf8");

  let firestoreWritten = false;
  if (writeFirestore) {
    const docId = kpi.weekStartDate || datePrefix;
    const root = db.collection("identities").doc(uid).collection("revenue_health_reports");
    await root.doc(docId).set(payload, { merge: true });
    await root.doc("latest").set(payload, { merge: true });
    firestoreWritten = true;
  }

  process.stdout.write(
    JSON.stringify(
      {
        ok: true,
        uid,
        generatedAt,
        overall: gateEvaluation.overall,
        score: gateEvaluation.score,
        maxScore: gateEvaluation.maxScore,
        outputPath: absOutputPath,
        jsonPath: absJsonPath,
        firestoreWritten,
      },
      null,
      2
    ) + "\n"
  );
}

const isDirectRun = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;

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
