import { chromium } from "@playwright/test";
import fs from "fs";
import path from "path";

const args = process.argv.slice(2);
const key = args[0];
const profileDir = args[1] || ".playwright-profile";
const shortcutsPath = path.resolve(process.cwd(), "scripts", "playwright-shortcuts.json");

const shortcuts = JSON.parse(fs.readFileSync(shortcutsPath, "utf8"));

if (!key || key === "list" || key === "--list") {
  console.log("Available shortcuts:");
  for (const [name, url] of Object.entries(shortcuts)) {
    console.log(`- ${name}: ${url}`);
  }
  process.exit(0);
}

const url = shortcuts[key] || (key.startsWith("http") ? key : null);
if (!url) {
  console.error(`Unknown shortcut: ${key}`);
  process.exit(1);
}

const userDataDir = path.resolve(process.cwd(), profileDir);
fs.mkdirSync(userDataDir, { recursive: true });

const context = await chromium.launchPersistentContext(userDataDir, {
  headless: false,
  viewport: { width: 1280, height: 800 },
});

const page = context.pages()[0] || (await context.newPage());
await page.goto(url, { waitUntil: "domcontentloaded" });

console.log(`Playwright shortcut opened: ${url}`);
console.log("Use the window to log in or inspect. Press Ctrl+C to exit.");

process.on("SIGINT", async () => {
  await context.close();
  process.exit(0);
});

await new Promise(() => {});
