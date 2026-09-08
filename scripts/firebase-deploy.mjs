import { spawn } from "node:child_process";
import { normalizeFirebaseDeployArgs } from "./firebase-deploy-args.mjs";
import { buildFirebaseDeployEnv } from "./firebase-deploy-env.mjs";

const argv = process.argv.slice(2);
const args = normalizeFirebaseDeployArgs(argv);

// Firebase frameworks deploy may run an npm install for the generated SSR backend.
// Force production-only installs so devDependencies (e.g. Playwright) don't bloat the bundle.
const env = buildFirebaseDeployEnv(process.env);

const npxCmd = process.platform === "win32" ? "npx.cmd" : "npx";
const child = spawn(
  process.platform === "win32" ? "cmd.exe" : npxCmd,
  process.platform === "win32"
    ? ["/d", "/s", "/c", npxCmd, "-y", "firebase-tools@15.5.1", ...args]
    : ["-y", "firebase-tools@15.5.1", ...args],
  {
    stdio: "inherit",
    env,
  }
);

child.on("exit", (code) => {
  process.exit(code ?? 1);
});
