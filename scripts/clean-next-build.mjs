import { rm } from "node:fs/promises";
import path from "node:path";

const nextDir = path.join(process.cwd(), ".next");

try {
  await rm(nextDir, { recursive: true, force: true });
  console.log(`[prebuild] cleaned ${nextDir}`);
} catch (error) {
  console.warn("[prebuild] unable to clean .next", error);
}
