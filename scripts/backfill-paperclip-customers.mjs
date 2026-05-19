import fs from "node:fs";
import path from "node:path";
import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { pathToFileURL } from "node:url";

function asString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function parseInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseEnvFile(filepath) {
  if (!fs.existsSync(filepath)) return {};
  const content = fs.readFileSync(filepath, "utf8");
  const entries = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const idx = line.indexOf("=");
      if (idx <= 0) return null;
      const key = line.slice(0, idx).trim();
      const rawValue = line.slice(idx + 1).trim();
      const value =
        (rawValue.startsWith('"') && rawValue.endsWith('"')) ||
        (rawValue.startsWith("'") && rawValue.endsWith("'"))
          ? rawValue.slice(1, -1)
          : rawValue;
      return [key, value];
    })
    .filter(Boolean);
  return Object.fromEntries(entries);
}

function hydrateEnvFromLocalFile(env = process.env) {
  const localEnv = parseEnvFile(path.resolve(process.cwd(), ".env.local"));
  for (const [key, value] of Object.entries(localEnv)) {
    if (!env[key]) {
      env[key] = value;
    }
  }
  return env;
}

function parseArgs(argv, env = process.env) {
  const options = {
    uid: asString(env.PAPERCLIP_BACKFILL_UID) || null,
    companyId: asString(env.PAPERCLIP_DEFAULT_COMPANY_ID) || null,
    dryRun: false,
    skipTimeline: false,
    limit: parseInteger(env.PAPERCLIP_BACKFILL_LIMIT, 200),
    activityLimit: parseInteger(env.PAPERCLIP_BACKFILL_ACTIVITY_LIMIT, 1000),
    paperclipBaseUrl:
      asString(env.PAPERCLIP_API_BASE_URL) ||
      asString(env.PAPERCLIP_SYSTEM_URL) ||
      asString(env.PAPERCLIP_MCP_SERVER_URL) ||
      null,
    serviceToken: asString(env.PAPERCLIP_SERVICE_TOKEN) || null,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (token === "--skip-timeline") {
      options.skipTimeline = true;
      continue;
    }
    if ((token === "--uid" || token === "-u") && argv[i + 1]) {
      options.uid = argv[i + 1];
      i += 1;
      continue;
    }
    if ((token === "--company-id" || token === "-c") && argv[i + 1]) {
      options.companyId = argv[i + 1];
      i += 1;
      continue;
    }
    if ((token === "--limit" || token === "-l") && argv[i + 1]) {
      options.limit = parseInteger(argv[i + 1], options.limit);
      i += 1;
      continue;
    }
    if (token === "--activity-limit" && argv[i + 1]) {
      options.activityLimit = parseInteger(argv[i + 1], options.activityLimit);
      i += 1;
      continue;
    }
  }

  return options;
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

export function detectTimelineChannel(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (!normalized) return "system";
  if (normalized.includes("sms") || normalized.includes("text")) return "sms";
  if (normalized.includes("voice") || normalized.includes("call")) return "voice";
  if (normalized.includes("calendar") || normalized.includes("meeting")) return "calendar";
  if (normalized.includes("social")) return "social";
  if (normalized.includes("pos") || normalized.includes("square") || normalized.includes("payment")) {
    return "pos";
  }
  if (normalized.includes("ad")) return "ads";
  if (normalized.includes("mail") || normalized.includes("email") || normalized.includes("gmail")) {
    return "email";
  }
  return "system";
}

function resolveCompanyName(row) {
  return (
    asString(row.companyName) ||
    asString(row.company) ||
    asString(row.name) ||
    "Untitled Lead"
  );
}

function resolveContactName(row) {
  return asString(row.founderName) || asString(row.contactName) || asString(row.name) || null;
}

function resolvePipelineStage(row) {
  return asString(row.pipelineStage) || asString(row.status) || "lead_capture";
}

export function normalizeLeadForPaperclip(docId, row) {
  const email = asString(row.email) || null;
  const phone = asString(row.phone) || null;
  return {
    customerId: docId,
    companyName: resolveCompanyName(row),
    contactName: resolveContactName(row),
    email,
    phone,
    sourceLabel: asString(row.source) || "mission_control",
    businessUnit: asString(row.businessUnit) || "ai_cofoundry",
    offerCode: asString(row.offerCode) || "AICF-DISCOVERY",
    pipelineStage: resolvePipelineStage(row),
    metadata: {
      sourceSystem: "mission_control",
      sourceLeadId: docId,
      sourceUserId: asString(row.userId) || null,
      website: asString(row.website) || null,
      industry: asString(row.industry) || null,
      location: asString(row.location) || null,
      importedAt: new Date().toISOString(),
    },
  };
}

function snapshotExternalKey(leadId) {
  return `mission-control:lead:${leadId}:snapshot`;
}

function activityExternalKey(activityId) {
  return `mission-control:activity:${activityId}`;
}

export function buildTimelineImportPlan({ leadId, leadRow, activities, existingExternalKeys }) {
  const events = [];
  const leadKey = snapshotExternalKey(leadId);
  if (!existingExternalKeys.has(leadKey)) {
    const detailParts = [
      `Pipeline stage: ${resolvePipelineStage(leadRow)}`,
      asString(leadRow.source) ? `Source: ${asString(leadRow.source)}` : null,
      asString(leadRow.offerCode) ? `Offer: ${asString(leadRow.offerCode)}` : null,
    ].filter(Boolean);
    events.push({
      externalKey: leadKey,
      type: "mission_control.lead_snapshot",
      channel: "system",
      summary: "Imported Mission Control lead snapshot.",
      detail: detailParts.join(" • ") || null,
      occurredAt: toIso(leadRow.updatedAt) || toIso(leadRow.createdAt) || new Date().toISOString(),
      metadata: {
        sourceSystem: "mission_control",
        sourceCollection: "leads",
        sourceLeadId: leadId,
      },
    });
  }

  for (const activity of activities) {
    const externalKey = activityExternalKey(activity.id);
    if (existingExternalKeys.has(externalKey)) continue;
    const row = activity.data || {};
    const type = asString(row.action) || "activity.recorded";
    events.push({
      externalKey,
      type,
      channel: detectTimelineChannel(asString(row.type) || type),
      summary:
        asString(row.summary) ||
        asString(row.action) ||
        asString(row.details) ||
        "Imported Mission Control activity.",
      detail: asString(row.details) || null,
      occurredAt:
        toIso(row.timestamp) || toIso(row.updatedAt) || toIso(row.createdAt) || new Date().toISOString(),
      metadata: {
        sourceSystem: "mission_control",
        sourceCollection: "activities",
        sourceActivityId: activity.id,
        sourceLeadId: leadId,
        sourceUserId: asString(row.userId) || null,
        sourceType: asString(row.type) || null,
      },
    });
  }

  return events;
}

function buildHeaders(serviceToken, correlationId) {
  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    ...(serviceToken ? { Authorization: `Bearer ${serviceToken}` } : {}),
    ...(correlationId ? { "x-correlation-id": correlationId } : {}),
  };
}

async function requestJson(url, init = {}) {
  const response = await fetch(url, init);
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }
  return { response, payload };
}

function log(level, event, fields = {}) {
  const line = {
    level,
    event,
    ...fields,
    ts: new Date().toISOString(),
  };
  const rendered = JSON.stringify(line);
  if (level === "error") {
    process.stderr.write(`${rendered}\n`);
    return;
  }
  process.stdout.write(`${rendered}\n`);
}

async function resolveCompanyId(options, correlationId) {
  if (options.companyId) return options.companyId;
  if (!options.paperclipBaseUrl) {
    throw new Error("Missing PAPERCLIP_API_BASE_URL (or PAPERCLIP_SYSTEM_URL / PAPERCLIP_MCP_SERVER_URL).");
  }

  const { response, payload } = await requestJson(
    new URL("/api/companies", options.paperclipBaseUrl).toString(),
    {
      method: "GET",
      headers: buildHeaders(options.serviceToken, correlationId),
    },
  );

  if (!response.ok) {
    throw new Error(`Failed to resolve Paperclip companies (${response.status}).`);
  }

  const items = Array.isArray(payload?.companies)
    ? payload.companies
    : Array.isArray(payload?.items)
      ? payload.items
      : Array.isArray(payload)
        ? payload
        : [];

  if (items.length !== 1 || !asString(items[0]?.id)) {
    throw new Error("Set PAPERCLIP_DEFAULT_COMPANY_ID (or pass --company-id) when multiple Paperclip companies are accessible.");
  }

  return asString(items[0].id);
}

async function upsertPaperclipCustomer(options, companyId, requestedByUid, leadPayload, correlationId) {
  if (options.dryRun) {
    return {
      customerId: leadPayload.customerId,
      dryRun: true,
      payload: null,
    };
  }

  const url = new URL("/api/customers", options.paperclipBaseUrl).toString();
  const { response, payload } = await requestJson(url, {
    method: "POST",
    headers: buildHeaders(options.serviceToken, correlationId),
    body: JSON.stringify({
      requestedByUid,
      companyId,
      ...leadPayload,
    }),
  });

  if (!response.ok) {
    throw new Error(`Paperclip customer upsert failed (${response.status}): ${JSON.stringify(payload)}`);
  }

  const customer =
    payload?.customer ||
    (Array.isArray(payload?.customers) ? payload.customers[0] : null) ||
    (Array.isArray(payload?.items) ? payload.items[0] : null);

  const customerId =
    asString(customer?.customerId) || asString(customer?.id) || leadPayload.customerId;
  if (!customerId) {
    throw new Error("Paperclip customer upsert returned no customerId.");
  }

  return {
    customerId,
    dryRun: false,
    payload,
  };
}

async function fetchExistingTimelineExternalKeys(options, companyId, customerId, requestedByUid, correlationId) {
  const url = new URL(
    `/api/customers/${encodeURIComponent(customerId)}/timeline`,
    options.paperclipBaseUrl,
  );
  url.searchParams.set("companyId", companyId);
  url.searchParams.set("requestedByUid", requestedByUid);
  url.searchParams.set("limit", "200");

  const { response, payload } = await requestJson(url.toString(), {
    method: "GET",
    headers: buildHeaders(options.serviceToken, correlationId),
  });

  if (!response.ok) {
    throw new Error(`Paperclip customer timeline lookup failed (${response.status}).`);
  }

  const events = Array.isArray(payload?.events)
    ? payload.events
    : Array.isArray(payload?.items)
      ? payload.items
      : [];

  return new Set(
    events
      .map((event) => asString(event?.externalKey))
      .filter(Boolean),
  );
}

async function appendTimelineEvent(options, companyId, customerId, requestedByUid, event, correlationId) {
  const url = new URL(
    `/api/customers/${encodeURIComponent(customerId)}/timeline`,
    options.paperclipBaseUrl,
  ).toString();

  const { response, payload } = await requestJson(url, {
    method: "POST",
    headers: buildHeaders(options.serviceToken, correlationId),
    body: JSON.stringify({
      requestedByUid,
      companyId,
      externalKey: event.externalKey,
      type: event.type,
      channel: event.channel,
      summary: event.summary,
      detail: event.detail,
      metadata: event.metadata,
      occurredAt: event.occurredAt,
    }),
  });

  if (!response.ok) {
    throw new Error(`Paperclip timeline append failed (${response.status}): ${JSON.stringify(payload)}`);
  }

  return payload;
}

async function collectLeadDocs(db, uid, limit) {
  let query = db.collection("leads");
  if (uid) {
    query = query.where("userId", "==", uid);
  }
  const snap = await query.limit(limit).get();
  return snap.docs.map((doc) => ({ id: doc.id, data: doc.data() || {} }));
}

async function collectActivities(db, uid, limit) {
  let query = db.collection("activities");
  if (uid) {
    query = query.where("userId", "==", uid);
  }
  const snap = await query.limit(limit).get();
  return snap.docs.map((doc) => ({ id: doc.id, data: doc.data() || {} }));
}

export async function runBackfill(rawOptions = {}) {
  hydrateEnvFromLocalFile(process.env);
  const options = {
    ...parseArgs([], process.env),
    ...rawOptions,
  };

  if (!options.paperclipBaseUrl) {
    throw new Error("Missing PAPERCLIP_API_BASE_URL (or PAPERCLIP_SYSTEM_URL / PAPERCLIP_MCP_SERVER_URL).");
  }

  const correlationRoot = `paperclip-backfill-${Date.now()}`;
  const companyId = await resolveCompanyId(options, `${correlationRoot}:companies`);
  const projectId =
    process.env.FIREBASE_PROJECT_ID ||
    process.env.GCP_PROJECT_ID ||
    process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;

  if (!getApps().length) {
    initializeApp({
      credential: applicationDefault(),
      projectId: projectId || undefined,
    });
  }

  const db = getFirestore();
  const leads = await collectLeadDocs(db, options.uid, options.limit);
  const activities = await collectActivities(db, options.uid, options.activityLimit);
  const activitiesByCustomerId = new Map();
  for (const activity of activities) {
    const customerId = asString(activity.data.customerId);
    if (!customerId) continue;
    const existing = activitiesByCustomerId.get(customerId) || [];
    existing.push(activity);
    activitiesByCustomerId.set(customerId, existing);
  }

  const summary = {
    ok: true,
    dryRun: options.dryRun,
    companyId,
    uidScope: options.uid || null,
    leadsScanned: leads.length,
    customersUpserted: 0,
    timelineEventsImported: 0,
    timelineEventsSkipped: 0,
    failures: [],
  };

  log("info", "paperclip.backfill.start", {
    correlationId: correlationRoot,
    dryRun: options.dryRun,
    companyId,
    uidScope: options.uid || null,
    leadsScanned: leads.length,
  });

  for (const lead of leads) {
    const requestedByUid = asString(lead.data.userId) || "mission-control-backfill";
    const leadPayload = normalizeLeadForPaperclip(lead.id, lead.data);
    const correlationId = `${correlationRoot}:${lead.id}`;

    try {
      const upserted = await upsertPaperclipCustomer(
        options,
        companyId,
        requestedByUid,
        leadPayload,
        correlationId,
      );
      summary.customersUpserted += 1;

      if (!options.skipTimeline) {
        const existingExternalKeys = options.dryRun
          ? new Set()
          : await fetchExistingTimelineExternalKeys(
              options,
              companyId,
              upserted.customerId,
              requestedByUid,
              `${correlationId}:timeline`,
            );
        const events = buildTimelineImportPlan({
          leadId: lead.id,
          leadRow: lead.data,
          activities: activitiesByCustomerId.get(lead.id) || [],
          existingExternalKeys,
        });

        summary.timelineEventsSkipped +=
          Math.max(0, (activitiesByCustomerId.get(lead.id) || []).length + 1 - events.length);

        for (const event of events) {
          if (!options.dryRun) {
            await appendTimelineEvent(
              options,
              companyId,
              upserted.customerId,
              requestedByUid,
              event,
              `${correlationId}:${event.externalKey}`,
            );
          }
          summary.timelineEventsImported += 1;
        }
      }

      log("info", "paperclip.backfill.customer_complete", {
        correlationId,
        customerId: upserted.customerId,
        sourceLeadId: lead.id,
        requestedByUid,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      summary.failures.push({
        leadId: lead.id,
        message,
      });
      log("error", "paperclip.backfill.customer_failed", {
        correlationId,
        sourceLeadId: lead.id,
        message,
      });
    }
  }

  log("info", "paperclip.backfill.complete", {
    correlationId: correlationRoot,
    customersUpserted: summary.customersUpserted,
    timelineEventsImported: summary.timelineEventsImported,
    timelineEventsSkipped: summary.timelineEventsSkipped,
    failures: summary.failures.length,
  });

  return summary;
}

async function main() {
  hydrateEnvFromLocalFile(process.env);
  const options = parseArgs(process.argv.slice(2), process.env);
  const summary = await runBackfill(options);
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

const isDirectRun =
  Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  main().catch((error) => {
    process.stderr.write(
      `${JSON.stringify(
        {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        },
        null,
        2,
      )}\n`,
    );
    process.exit(1);
  });
}
