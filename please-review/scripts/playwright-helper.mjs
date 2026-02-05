import { chromium } from "@playwright/test";
import fs from "fs";
import path from "path";

const url = process.argv[2] || "https://console.cloud.google.com/";
const profileDir = process.argv[3] || ".playwright-profile";
const userDataDir = path.resolve(process.cwd(), profileDir);

fs.mkdirSync(userDataDir, { recursive: true });

const context = await chromium.launchPersistentContext(userDataDir, {
  headless: false,
  viewport: { width: 1280, height: 800 },
});

const page = context.pages()[0] || (await context.newPage());
await page.goto(url, { waitUntil: "domcontentloaded" });

console.log(`Playwright helper opened: ${url}`);
console.log("Use the window to log in or inspect. Press Ctrl+C to exit.");

process.on("SIGINT", async () => {
  await context.close();
  process.exit(0);
});

await new Promise(() => {});
