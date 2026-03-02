#!/usr/bin/env node

import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";

function candidateEnvFiles() {
  const files = [".env.local", ".env"];
  const codexHome = process.env.CODEX_HOME;
  if (codexHome) {
    files.push(
      path.join(codexHome, "automations", "socialops-health", ".env.local"),
      path.join(codexHome, "automations", "socialops-health", ".env")
    );
  }
  return files;
}

export function loadLocalEnv() {
  if (typeof process.loadEnvFile !== "function") {
    return [];
  }

  const loaded = [];
  for (const file of candidateEnvFiles()) {
    const resolved = path.resolve(file);
    if (!existsSync(resolved)) continue;
    process.loadEnvFile(resolved);
    loaded.push(resolved);
  }
  return loaded;
}

