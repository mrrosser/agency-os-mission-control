import fs from "node:fs";

const [, , inputPath, thresholdArg = "medium"] = process.argv;

if (!inputPath) {
  console.error("Usage: node promptfoo/scripts/assert-code-scan.mjs <input-path> [threshold]");
  process.exit(2);
}

const severityOrder = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

function normalizeSeverity(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return severityOrder[normalized] ? normalized : null;
}

function collectFindings(node, findings = []) {
  if (!node) return findings;
  if (Array.isArray(node)) {
    for (const item of node) collectFindings(item, findings);
    return findings;
  }
  if (typeof node !== "object") return findings;

  const record = node;
  const severity = normalizeSeverity(record.severity);
  const label = record.ruleId || record.rule_id || record.title || record.message || record.description;
  if (severity && label) {
    findings.push(record);
  }

  for (const value of Object.values(record)) {
    collectFindings(value, findings);
  }
  return findings;
}

const threshold = normalizeSeverity(thresholdArg) || "medium";
const payload = JSON.parse(fs.readFileSync(inputPath, "utf8"));
const findings = collectFindings(payload).filter((finding) => {
  const status = String(finding.status || finding.state || "").trim().toLowerCase();
  return !["resolved", "closed", "passed", "ok", "ignored"].includes(status);
});

const failing = findings.filter((finding) => {
  const severity = normalizeSeverity(finding.severity);
  return severity && severityOrder[severity] >= severityOrder[threshold];
});

if (failing.length > 0) {
  console.error(`Promptfoo code scan reported ${failing.length} findings at or above ${threshold}.`);
  for (const finding of failing.slice(0, 10)) {
    const severity = normalizeSeverity(finding.severity) || "unknown";
    const label = finding.ruleId || finding.rule_id || finding.title || finding.message || "finding";
    console.error(`- [${severity}] ${label}`);
  }
  process.exit(1);
}

console.log(`Promptfoo code scan clear at threshold ${threshold}.`);
