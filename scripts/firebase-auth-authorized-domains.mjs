import { GoogleAuth } from "google-auth-library";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";

const SCOPE = "https://www.googleapis.com/auth/cloud-platform";
const DEFAULT_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT || "leadflow-review";
const RUN_ID = process.env.RUN_ID || `auth-domains-${Date.now()}`;

function log(level, event, payload = {}) {
  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      level,
      runId: RUN_ID,
      event,
      ...payload,
    })
  );
}

export function normalizeDomain(input) {
  const value = String(input || "").trim().toLowerCase();
  if (!value) {
    throw new Error("Domain value cannot be empty.");
  }

  const withScheme = value.startsWith("http://") || value.startsWith("https://") ? value : `https://${value}`;
  const parsed = new URL(withScheme);
  if (parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new Error(`Invalid domain "${input}". Provide hostname only (no path/query/hash).`);
  }
  return parsed.hostname;
}

export function mergeAuthorizedDomains(currentDomains, domainsToAdd) {
  const merged = [...(Array.isArray(currentDomains) ? currentDomains : [])];
  const seen = new Set(merged.map((domain) => String(domain).toLowerCase()));
  for (const raw of domainsToAdd) {
    const domain = normalizeDomain(raw);
    if (seen.has(domain)) continue;
    seen.add(domain);
    merged.push(domain);
  }
  return merged;
}

export function parseAuthorizedDomainArgs(argv) {
  const args = Array.isArray(argv) ? [...argv] : [];
  let projectId = DEFAULT_PROJECT_ID;
  let dryRun = false;
  let projectSetByFlag = false;
  const domains = [];
  const positionals = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "dry-run") {
      dryRun = true;
      continue;
    }
    if (arg === "--project") {
      projectId = args[index + 1] || "";
      projectSetByFlag = true;
      index += 1;
      continue;
    }
    if (arg === "--add-domain") {
      domains.push(args[index + 1] || "");
      index += 1;
      continue;
    }
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      return { help: true, projectId, dryRun, domains: [] };
    }
    if (arg.startsWith("-")) {
      throw new Error(`Unknown argument: ${arg}`);
    }
    positionals.push(arg);
  }

  if (positionals.length > 0) {
    if (!projectSetByFlag) {
      projectId = positionals.shift() || projectId;
    }
    domains.push(...positionals);
  }

  if (!projectId) {
    throw new Error("Missing project id. Use --project <id> or set FIREBASE_PROJECT_ID.");
  }
  if (domains.length === 0 && !dryRun) {
    throw new Error("At least one --add-domain value is required.");
  }

  return {
    help: false,
    projectId,
    dryRun,
    domains: domains.map((domain) => normalizeDomain(domain)),
  };
}

function getAccessToken() {
  const envToken = process.env.GOOGLE_OAUTH_ACCESS_TOKEN;
  if (typeof envToken === "string" && envToken.trim().length > 0) {
    return envToken.trim();
  }

  const tokenFromGcloud = tryGetTokenFromCommand("gcloud", ["auth", "print-access-token"]);
  if (tokenFromGcloud) {
    return tokenFromGcloud;
  }

  if (process.platform === "win32") {
    const tokenFromPowerShell = tryGetTokenFromCommand("powershell", [
      "-NoProfile",
      "-Command",
      "gcloud auth print-access-token",
    ]);
    if (tokenFromPowerShell) {
      return tokenFromPowerShell;
    }
  }

  return null;
}

function tryGetTokenFromCommand(command, args) {
  try {
    const output = execFileSync(command, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const token = output.trim();
    return token.length > 0 ? token : null;
  } catch {
    return null;
  }
}

function printUsage() {
  console.log(`
Usage:
  node scripts/firebase-auth-authorized-domains.mjs <project-id> <hostname> [hostname...] [--dry-run]
  node scripts/firebase-auth-authorized-domains.mjs --project <project-id> --add-domain <hostname> [--add-domain <hostname>] [--dry-run]

Examples:
  node scripts/firebase-auth-authorized-domains.mjs leadflow-review ai-hell-mary-mission-control-gdyt2qma6a-uc.a.run.app
  node scripts/firebase-auth-authorized-domains.mjs leadflow-review ai-hell-mary-mission-control-gdyt2qma6a-uc.a.run.app --dry-run
  node scripts/firebase-auth-authorized-domains.mjs --project leadflow-review --add-domain ai-hell-mary-mission-control-gdyt2qma6a-uc.a.run.app
`);
}

export async function runAuthorizedDomainsCli(argv = process.argv.slice(2)) {
  const parsed = parseAuthorizedDomainArgs(argv);
  if (parsed.help) {
    printUsage();
    return;
  }

  let token = getAccessToken();
  if (!token) {
    const auth = new GoogleAuth({ scopes: [SCOPE] });
    const client = await auth.getClient();
    const accessToken = await client.getAccessToken();
    token = accessToken?.token ?? null;
  }
  if (!token) {
    throw new Error(
      "Failed to obtain Google access token. Run `gcloud auth login` and set the active account, or set GOOGLE_OAUTH_ACCESS_TOKEN."
    );
  }

  const baseUrl = `https://identitytoolkit.googleapis.com/admin/v2/projects/${parsed.projectId}/config`;
  const headers = {
    Authorization: `Bearer ${token}`,
    "x-goog-user-project": parsed.projectId,
    "Content-Type": "application/json",
  };

  log("info", "auth_domains_fetch_start", { projectId: parsed.projectId });
  const currentResponse = await fetch(baseUrl, { method: "GET", headers });
  if (!currentResponse.ok) {
    const body = await currentResponse.text();
    throw new Error(`Failed to read Firebase Auth config (${currentResponse.status}): ${body}`);
  }
  const currentConfig = await currentResponse.json();
  const currentDomains = Array.isArray(currentConfig.authorizedDomains) ? currentConfig.authorizedDomains : [];
  const mergedDomains = mergeAuthorizedDomains(currentDomains, parsed.domains);

  log("info", "auth_domains_computed", {
    projectId: parsed.projectId,
    currentCount: currentDomains.length,
    mergedCount: mergedDomains.length,
    addedDomains: parsed.domains,
    dryRun: parsed.dryRun,
  });

  if (parsed.dryRun) {
    log("info", "auth_domains_dry_run", { authorizedDomains: mergedDomains });
    return;
  }

  const updateUrl = `${baseUrl}?updateMask=authorizedDomains`;
  const updateResponse = await fetch(updateUrl, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ authorizedDomains: mergedDomains }),
  });
  if (!updateResponse.ok) {
    const body = await updateResponse.text();
    throw new Error(`Failed to update Firebase Auth domains (${updateResponse.status}): ${body}`);
  }
  const updatedConfig = await updateResponse.json();
  const updatedDomains = Array.isArray(updatedConfig.authorizedDomains)
    ? updatedConfig.authorizedDomains
    : [];

  log("info", "auth_domains_update_success", {
    projectId: parsed.projectId,
    authorizedDomains: updatedDomains,
  });
}

const isDirectExecution =
  typeof process.argv[1] === "string" && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectExecution) {
  runAuthorizedDomainsCli().catch((error) => {
    log("error", "auth_domains_update_failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  });
}
