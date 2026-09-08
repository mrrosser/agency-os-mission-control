const DEFAULT_DISCOVERY_TIMEOUT_SECONDS = 60;
const MIN_DISCOVERY_TIMEOUT_SECONDS = 10;
const MAX_DISCOVERY_TIMEOUT_SECONDS = 300;

function normalizeDiscoveryTimeout(value) {
  const raw = typeof value === "string" ? value.trim() : "";
  const candidate = raw || String(DEFAULT_DISCOVERY_TIMEOUT_SECONDS);

  if (!/^\d+$/.test(candidate)) {
    throw new Error("FUNCTIONS_DISCOVERY_TIMEOUT must be an integer number of seconds");
  }

  const seconds = Number(candidate);
  if (seconds < MIN_DISCOVERY_TIMEOUT_SECONDS || seconds > MAX_DISCOVERY_TIMEOUT_SECONDS) {
    throw new Error(
      `FUNCTIONS_DISCOVERY_TIMEOUT must be between ${MIN_DISCOVERY_TIMEOUT_SECONDS} and ${MAX_DISCOVERY_TIMEOUT_SECONDS} seconds`
    );
  }

  return String(seconds);
}

export function buildFirebaseDeployEnv(baseEnv = {}) {
  return {
    ...baseEnv,
    NODE_ENV: "production",
    // Prefer npm's modern omit flag over deprecated "production=true".
    NPM_CONFIG_OMIT: "dev",
    FIREBASE_CLI_EXPERIMENTS: baseEnv.FIREBASE_CLI_EXPERIMENTS || "webframeworks",
    // Firebase's framework discovery can exceed the CLI's 10-second default on this app.
    FUNCTIONS_DISCOVERY_TIMEOUT: normalizeDiscoveryTimeout(baseEnv.FUNCTIONS_DISCOVERY_TIMEOUT),
  };
}
