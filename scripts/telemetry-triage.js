/* eslint-disable no-console */

// Phase 2: scheduled triage that turns high-signal telemetry groups into GitHub issues.
// Guardrails:
// - idempotent: once a group has triage.issueNumber set, we never create a duplicate issue
// - no auto-merge: this only files issues (PR creation can be added behind a feature flag later)

const admin = require("firebase-admin");

function getEnv(name, fallback = undefined) {
  const value = process.env[name];
  return value === undefined || value === "" ? fallback : value;
}

function requiredEnv(name) {
  const value = getEnv(name);
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

function clip(text, max) {
  if (!text) return "";
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function safeJson(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

async function initFirestore() {
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
      projectId: getEnv("GCLOUD_PROJECT"),
    });
  }
  return admin.firestore();
}

async function createGithubIssue({ title, body }) {
  const token = requiredEnv("GITHUB_TOKEN");
  const repo = requiredEnv("GITHUB_REPOSITORY"); // owner/repo

  const response = await fetch(`https://api.github.com/repos/${repo}/issues`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      "User-Agent": "telemetry-triage-bot",
    },
    body: JSON.stringify({
      title,
      body,
    }),
  });

  const payloadText = await response.text();
  let payload = null;
  try {
    payload = JSON.parse(payloadText);
  } catch {
    payload = { raw: payloadText };
  }

  if (!response.ok) {
    throw new Error(`GitHub issue create failed (${response.status}): ${safeJson(payload)}`);
  }

  return payload;
}

function issueTitleFromGroup(group) {
  const sample = group.sample || {};
  const base = sample.name ? `${sample.name}: ${sample.message || ""}` : sample.message || "Unknown error";
  return clip(`[Telemetry] ${base}`, 240);
}

function issueBodyFromGroup(group) {
  const sample = group.sample || {};
  const lines = [];

  lines.push("## Telemetry Error Group");
  lines.push("");
  lines.push(`- Fingerprint: \`${group.fingerprint || "unknown"}\``);
  lines.push(`- Kind: \`${group.kind || "unknown"}\``);
  lines.push(`- Count: \`${group.count || 0}\``);

  if (group.firstSeenAt) lines.push(`- First seen: \`${group.firstSeenAt.toDate?.().toISOString?.() || String(group.firstSeenAt)}\``);
  if (group.lastSeenAt) lines.push(`- Last seen: \`${group.lastSeenAt.toDate?.().toISOString?.() || String(group.lastSeenAt)}\``);
  if (group.last?.correlationId) lines.push(`- Latest correlation ID: \`${group.last.correlationId}\``);
  if (group.last?.eventId) lines.push(`- Latest event ID: \`${group.last.eventId}\``);
  if (group.last?.uid) lines.push(`- Latest UID: \`${group.last.uid}\``);

  lines.push("");
  lines.push("## Sample");
  lines.push("");
  lines.push(`- Message: ${clip(String(sample.message || ""), 500)}`);
  if (sample.route) lines.push(`- Route: \`${sample.route}\``);
  if (sample.url) lines.push(`- URL: \`${clip(String(sample.url), 300)}\``);
  if (sample.correlationId) lines.push(`- Correlation ID: \`${sample.correlationId}\``);
  if (sample.eventId) lines.push(`- Event ID: \`${sample.eventId}\``);

  if (sample.stack) {
    lines.push("");
    lines.push("```");
    lines.push(clip(String(sample.stack), 12000));
    lines.push("```");
  }

  lines.push("");
  lines.push("## Next Steps");
  lines.push("");
  lines.push("- Check Cloud Run logs for the correlation ID (if present).");
  lines.push("- Reproduce in local dev if possible; verify fix with `npm test` and `npm run build`.");
  lines.push("- If this is an upstream HTML/text response, validate the API route is returning JSON and not a platform error page.");

  return lines.join("\n");
}

async function main() {
  const minCount = Number(getEnv("TELEMETRY_TRIAGE_MIN_COUNT", "3"));
  const maxGroups = Number(getEnv("TELEMETRY_TRIAGE_LIMIT", "10"));

  const db = await initFirestore();

  const snap = await db
    .collection("telemetry_error_groups")
    .where("triage.status", "==", "new")
    .limit(Math.max(maxGroups * 3, 25))
    .get();

  const candidates = snap.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }))
    .filter((group) => typeof group.count === "number" && group.count >= minCount)
    .filter((group) => !group.triage?.issueNumber);

  candidates.sort((a, b) => (b.count || 0) - (a.count || 0));

  const picked = candidates.slice(0, maxGroups);
  console.log(
    JSON.stringify(
      {
        level: "info",
        message: "telemetry.triage.start",
        timestamp: new Date().toISOString(),
        minCount,
        maxGroups,
        fetched: snap.size,
        eligible: candidates.length,
        selected: picked.length,
      },
      null,
      0
    )
  );

  for (const group of picked) {
    const ref = db.collection("telemetry_error_groups").doc(group.id);
    const fresh = await ref.get();
    const freshData = fresh.data() || {};
    if (freshData?.triage?.issueNumber) continue;

    const title = issueTitleFromGroup({ fingerprint: group.id, ...freshData });
    const body = issueBodyFromGroup({ fingerprint: group.id, ...freshData });

    const issue = await createGithubIssue({ title, body });
    const issueNumber = issue.number;
    const issueUrl = issue.html_url;

    await ref.set(
      {
        triage: {
          status: "issued",
          issueNumber,
          issueUrl,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
      },
      { merge: true }
    );

    console.log(
      JSON.stringify(
        {
          level: "info",
          message: "telemetry.triage.issued",
          timestamp: new Date().toISOString(),
          fingerprint: group.id,
          issueNumber,
          issueUrl,
          count: freshData.count || 0,
        },
        null,
        0
      )
    );
  }
}

main().catch((err) => {
  console.error(
    JSON.stringify(
      {
        level: "error",
        message: "telemetry.triage.failed",
        timestamp: new Date().toISOString(),
        error: err instanceof Error ? { message: err.message, stack: err.stack } : String(err),
      },
      null,
      0
    )
  );
  process.exitCode = 1;
});

