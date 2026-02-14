import { spawn } from "node:child_process";

const argv = process.argv.slice(2);
const args = argv.length > 0 ? argv : ["deploy", "--only", "hosting"];

// Firebase frameworks deploy may run an npm install for the generated SSR backend.
// Force production-only installs so devDependencies (e.g. Playwright) don't bloat the bundle.
const env = {
  ...process.env,
  NODE_ENV: "production",
  NPM_CONFIG_PRODUCTION: "true",
  FIREBASE_CLI_EXPERIMENTS: process.env.FIREBASE_CLI_EXPERIMENTS || "webframeworks",
};

const npxCmd = process.platform === "win32" ? "npx.cmd" : "npx";
const child = spawn(npxCmd, ["-y", "firebase-tools@15.5.1", ...args], {
  stdio: "inherit",
  env,
});

child.on("exit", (code) => {
  process.exit(code ?? 1);
});

