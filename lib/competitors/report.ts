import "server-only";

interface CompetitorSnapshot {
  name: string;
  url: string;
  title?: string;
  description?: string;
  keywords?: string;
  emails: string[];
  phones: string[];
  linkCount: number;
  markdownChars: number;
  warning?: string;
}

interface BuildReportArgs {
  monitorName: string;
  generatedAtIso: string;
  snapshots: CompetitorSnapshot[];
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatList(values: string[]): string {
  if (values.length === 0) return "-";
  return values.join(", ");
}

export function buildCompetitorMarkdownReport(args: BuildReportArgs): string {
  const lines: string[] = [];
  lines.push(`# ${args.monitorName} - Competitor Monitor`);
  lines.push("");
  lines.push(`Generated: ${args.generatedAtIso}`);
  lines.push(`Competitors scanned: ${args.snapshots.length}`);
  lines.push("");
  lines.push(
    "| Competitor | URL | Title | Emails | Phones | Links | Markdown chars |"
  );
  lines.push("|---|---|---|---:|---:|---:|---:|");

  for (const snapshot of args.snapshots) {
    lines.push(
      `| ${snapshot.name} | ${snapshot.url} | ${snapshot.title || "-"} | ${snapshot.emails.length} | ${snapshot.phones.length} | ${snapshot.linkCount} | ${snapshot.markdownChars} |`
    );
  }

  lines.push("");
  lines.push("## Per-competitor details");
  lines.push("");
  for (const snapshot of args.snapshots) {
    lines.push(`### ${snapshot.name}`);
    lines.push(`- URL: ${snapshot.url}`);
    lines.push(`- Title: ${snapshot.title || "-"}`);
    lines.push(`- Description: ${snapshot.description || "-"}`);
    lines.push(`- Keywords: ${snapshot.keywords || "-"}`);
    lines.push(`- Emails: ${formatList(snapshot.emails)}`);
    lines.push(`- Phones: ${formatList(snapshot.phones)}`);
    if (snapshot.warning) {
      lines.push(`- Warning: ${snapshot.warning}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

export function buildCompetitorHtmlReport(args: BuildReportArgs): string {
  const rows = args.snapshots
    .map((snapshot) => {
      return `<tr>
<td>${escapeHtml(snapshot.name)}</td>
<td><a href="${escapeHtml(snapshot.url)}" target="_blank" rel="noreferrer">${escapeHtml(
        snapshot.url
      )}</a></td>
<td>${escapeHtml(snapshot.title || "-")}</td>
<td>${snapshot.emails.length}</td>
<td>${snapshot.phones.length}</td>
<td>${snapshot.linkCount}</td>
<td>${snapshot.markdownChars}</td>
</tr>`;
    })
    .join("\n");

  const details = args.snapshots
    .map((snapshot) => {
      return `<section>
<h3>${escapeHtml(snapshot.name)}</h3>
<ul>
<li><strong>URL:</strong> <a href="${escapeHtml(snapshot.url)}" target="_blank" rel="noreferrer">${escapeHtml(
        snapshot.url
      )}</a></li>
<li><strong>Title:</strong> ${escapeHtml(snapshot.title || "-")}</li>
<li><strong>Description:</strong> ${escapeHtml(snapshot.description || "-")}</li>
<li><strong>Keywords:</strong> ${escapeHtml(snapshot.keywords || "-")}</li>
<li><strong>Emails:</strong> ${escapeHtml(formatList(snapshot.emails))}</li>
<li><strong>Phones:</strong> ${escapeHtml(formatList(snapshot.phones))}</li>
${
  snapshot.warning
    ? `<li><strong>Warning:</strong> ${escapeHtml(snapshot.warning)}</li>`
    : ""
}
</ul>
</section>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(args.monitorName)} - Competitor Monitor</title>
  <style>
    body { font-family: Arial, sans-serif; background: #0b1020; color: #e6edf7; margin: 0; padding: 24px; }
    h1, h2, h3 { margin: 0 0 12px; }
    p { margin: 0 0 12px; color: #9fb0d0; }
    table { width: 100%; border-collapse: collapse; margin: 12px 0 20px; }
    th, td { border: 1px solid #2a3551; padding: 8px; text-align: left; font-size: 13px; }
    th { background: #101a33; }
    section { border: 1px solid #2a3551; border-radius: 8px; padding: 12px; margin: 12px 0; background: #0d162c; }
    a { color: #73b4ff; }
    ul { margin: 0; padding-left: 18px; }
  </style>
</head>
<body>
  <h1>${escapeHtml(args.monitorName)} - Competitor Monitor</h1>
  <p>Generated: ${escapeHtml(args.generatedAtIso)} · Competitors scanned: ${
    args.snapshots.length
  }</p>
  <h2>Summary</h2>
  <table>
    <thead>
      <tr>
        <th>Competitor</th>
        <th>URL</th>
        <th>Title</th>
        <th>Emails</th>
        <th>Phones</th>
        <th>Links</th>
        <th>Markdown chars</th>
      </tr>
    </thead>
    <tbody>
      ${rows}
    </tbody>
  </table>
  <h2>Per-competitor details</h2>
  ${details}
</body>
</html>`;
}

export function extractEmails(text: string): string[] {
  const regex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  const matches = text.match(regex) || [];
  return Array.from(new Set(matches.map((value) => value.toLowerCase().trim()))).slice(0, 8);
}

export function extractPhones(text: string): string[] {
  const regex =
    /(?:\+?1[\s.-]?)?(?:\(\s*\d{3}\s*\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}/g;
  const matches = text.match(regex) || [];
  const normalized = matches
    .map((value) => value.trim().replace(/[^\d+]/g, ""))
    .filter((value) => {
      const digits = value.replace(/[^\d]/g, "");
      return digits.length >= 10 && digits.length <= 15;
    });
  return Array.from(new Set(normalized)).slice(0, 8);
}
