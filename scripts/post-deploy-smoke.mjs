import fs from "node:fs";
import path from "node:path";
import { initializeApp, applicationDefault, getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

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

function resolveFirebaseApiKey() {
  if (process.env.NEXT_PUBLIC_FIREBASE_API_KEY) return process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  const loaded = parseEnvFile(path.resolve(process.cwd(), ".env.local"));
  return loaded.NEXT_PUBLIC_FIREBASE_API_KEY;
}

function resolveProjectId() {
  return (
    process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.GCLOUD_PROJECT ||
    process.env.FIREBASE_PROJECT_ID ||
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||
    null
  );
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestJson(url, init = {}) {
  const response = await fetch(url, init);
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { raw: text };
  }
  return { response, payload };
}

async function exchangeCustomToken({ apiKey, customToken }) {
  const { response, payload } = await requestJson(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${encodeURIComponent(
      apiKey
    )}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: customToken, returnSecureToken: true }),
    }
  );
  if (!response.ok) {
    throw new Error(`Custom token exchange failed (${response.status}): ${JSON.stringify(payload)}`);
  }
  assert(typeof payload.idToken === "string" && payload.idToken.length > 0, "Missing ID token");
  return payload.idToken;
}

async function main() {
  const baseUrl = (
    process.env.SMOKE_BASE_URL ||
    process.env.PLAYWRIGHT_BASE_URL ||
    "https://leadflow-review.web.app"
  ).replace(/\/+$/, "");
  const apiKey = resolveFirebaseApiKey();
  const projectId = resolveProjectId();
  const uid = process.env.SMOKE_TEST_UID || "ci-smoke-user";

  assert(apiKey, "Missing NEXT_PUBLIC_FIREBASE_API_KEY (env or .env.local).");
  assert(projectId, "Missing Firebase project id env (GOOGLE_CLOUD_PROJECT / GCLOUD_PROJECT / FIREBASE_PROJECT_ID).");

  if (getApps().length === 0) {
    initializeApp({
      credential: applicationDefault(),
      projectId,
    });
  }

  const db = getFirestore();
  const auth = getAuth();

  const runTag = Date.now();
  const templateName = `ci-smoke-${runTag}`;
  const leadDocId = `ci-smoke-${runTag}`;
  let templateId = null;
  let idToken = null;

  console.log(`[smoke] baseUrl=${baseUrl} uid=${uid}`);

  try {
    // 1) Public health/login checks
    {
      const health = await requestJson(`${baseUrl}/api/health`);
      assert(health.response.status === 200, `Health check failed (${health.response.status})`);
      assert(health.payload?.status === "ok", "Health payload status is not ok.");
      console.log("[smoke] health check passed");
    }

    {
      const response = await fetch(`${baseUrl}/login`, { method: "GET" });
      const html = await response.text();
      assert(response.status === 200, `Login page failed (${response.status})`);
      assert(html.includes("Mission Control"), "Login page does not contain Mission Control.");
      console.log("[smoke] login page render check passed");
    }

    // 2) Authenticate synthetic smoke user
    const customToken = await auth.createCustomToken(uid, { smoke: true });
    idToken = await exchangeCustomToken({ apiKey, customToken });
    const authHeaders = {
      Authorization: `Bearer ${idToken}`,
      "Content-Type": "application/json",
      "X-Idempotency-Key": crypto.randomUUID(),
    };

    // 3) Seed one lead for deterministic worker run
    await db.collection("leads").doc(leadDocId).set({
      userId: uid,
      companyName: "CI Smoke Co",
      name: "Smoke Contact",
      email: "smoke@example.com",
      phone: "+15555550123",
      website: "https://example.com",
      industry: "Testing",
      location: "New Orleans",
      createdAt: new Date(),
    });
    console.log("[smoke] seeded smoke lead");

    // 4) Save template
    {
      const { response, payload } = await requestJson(`${baseUrl}/api/leads/templates`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          name: templateName,
          params: {
            sources: ["firestore"],
            limit: 1,
            includeEnrichment: false,
            minScore: 0,
          },
        }),
      });
      if (!response.ok) {
        throw new Error(`Template save failed (${response.status}): ${JSON.stringify(payload)}`);
      }
      templateId = payload?.template?.templateId;
      assert(typeof templateId === "string" && templateId.length > 0, "Template save missing templateId.");
      console.log(`[smoke] template save passed templateId=${templateId}`);
    }

    // 5) Source from firestore + start worker run
    let runId = null;
    {
      const { response, payload } = await requestJson(`${baseUrl}/api/leads/source`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          sources: ["firestore"],
          limit: 1,
          includeEnrichment: false,
          minScore: 0,
        }),
      });
      if (!response.ok) {
        throw new Error(`Lead source failed (${response.status}): ${JSON.stringify(payload)}`);
      }
      runId = payload?.runId;
      assert(typeof runId === "string" && runId.length > 0, "Lead source missing runId.");
      assert(Array.isArray(payload?.leads) && payload.leads.length > 0, "Lead source returned no leads.");
      console.log(`[smoke] lead source passed runId=${runId}`);
    }

    {
      const { response, payload } = await requestJson(
        `${baseUrl}/api/lead-runs/${encodeURIComponent(runId)}/jobs`,
        {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            action: "start",
            config: {
              dryRun: true,
              draftFirst: true,
              timeZone: "America/Chicago",
            },
          }),
        }
      );
      if (!response.ok) {
        throw new Error(`Lead run start failed (${response.status}): ${JSON.stringify(payload)}`);
      }
      console.log("[smoke] lead run start passed");
    }

    // 6) Poll worker until completion
    {
      const maxWaitMs = 120_000;
      const started = Date.now();
      let lastStatus = "unknown";
      while (Date.now() - started < maxWaitMs) {
        const { response, payload } = await requestJson(`${baseUrl}/api/lead-runs/${encodeURIComponent(runId)}/jobs`, {
          headers: { Authorization: `Bearer ${idToken}` },
        });
        if (!response.ok) {
          throw new Error(`Lead run status failed (${response.status}): ${JSON.stringify(payload)}`);
        }
        const status = payload?.job?.status;
        if (typeof status === "string") lastStatus = status;
        if (status === "completed") {
          console.log("[smoke] lead run worker completed");
          break;
        }
        if (status === "failed") {
          throw new Error(`Lead run worker failed: ${payload?.job?.lastError || "unknown"}`);
        }
        await sleep(2500);
      }
      assert(lastStatus === "completed", `Lead run worker did not complete in time (last=${lastStatus}).`);
    }

    console.log("[smoke] post-deploy smoke passed");
  } finally {
    // Best-effort cleanup
    try {
      if (templateId && idToken) {
        await fetch(`${baseUrl}/api/leads/templates/${encodeURIComponent(templateId)}`, {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${idToken}`,
          },
        });
      }
    } catch {
      // ignore cleanup errors
    }

    try {
      await db.collection("leads").doc(leadDocId).delete();
    } catch {
      // ignore cleanup errors
    }
  }
}

main().catch((error) => {
  console.error("[smoke] failed", error);
  process.exit(1);
});
