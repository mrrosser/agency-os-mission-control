import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { join } from "node:path";

const baseUrl = process.env.BOOTSTRAP_SMOKE_BASE_URL || "http://127.0.0.1:3318";
const expectRecovery = process.env.BOOTSTRAP_SMOKE_EXPECT_RECOVERY === "1";
const origin = new URL(baseUrl).origin;
const artifactDir = process.env.BOOTSTRAP_SMOKE_ARTIFACT_DIR;
assert(["127.0.0.1", "localhost", "[::1]"].includes(new URL(origin).hostname), "This mocked bootstrap smoke test is local-only.");

const browser = await chromium.launch({ headless: true });
try {
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    const context = await browser.newContext({ viewport });
    // No authentication bypass or provider writes. External calls are blocked;
    // telemetry and other non-GET local API calls are mocked.
    await context.route("**/*", async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin !== origin) return route.abort("blockedbyclient");
      if (!["GET", "HEAD"].includes(request.method())) return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
      return route.continue();
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    const configResponse = await context.request.get(`${origin}/api/runtime/firebase-client-config`);
    assert.equal(configResponse.status(), expectRecovery ? 503 : 200);
    await page.goto(`${origin}/dashboard/crm`, { waitUntil: "domcontentloaded" });
    if (expectRecovery) {
      await page.getByRole("button", { name: "Reload workspace" }).waitFor({ timeout: 15000 });
    } else {
      await page.waitForURL(/\/login(?:\?|$)/, { timeout: 15000 });
      await page.getByRole("button", { name: "Continue with Google", exact: true }).waitFor({ timeout: 15000 });
      await page.getByRole("tab", { name: "Direct", exact: true }).click();
      await page.locator('input[type="email"]').waitFor({ timeout: 15000 });
      assert.deepEqual(errors, [], `Unexpected browser errors: ${errors.join("; ")}`);
      const presentKeys = await page.evaluate(() => Object.keys(window.__LEADFLOW_FIREBASE_CONFIG__ || {}));
      assert(["apiKey", "authDomain", "projectId"].every(key => presentKeys.includes(key)), "Expected all required public runtime config fields");
    }
    const overflowing = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    assert.equal(overflowing, false, "Unexpected horizontal page overflow");
    if (artifactDir) await page.screenshot({ path: join(artifactDir, `bootstrap-${expectRecovery ? "missing-config" : "runtime-defaults"}-${viewport.width}.png`), fullPage: true });
    console.log(JSON.stringify({ correlationId: "crm-bootstrap-sept8", result: "PASS", viewport: viewport.width, scenario: expectRecovery ? "readable-missing-config" : "runtime-defaults-login", finalPath: new URL(page.url()).pathname }));
    if (expectRecovery) {
      for (const brand of ["rosser-gallery", "rt-solutions"]) {
        errors.length = 0;
        await page.goto(`${origin}/connect/${brand}`, { waitUntil: "domcontentloaded" });
        await page.getByRole("heading", { name: "Marcus Rosser", exact: true }).waitFor();
        await page.getByRole("button", { name: "Share live link", exact: true }).waitFor();
        assert.deepEqual(errors, [], "Public cards must not load the unavailable Firebase workspace module");
        if (artifactDir) await page.screenshot({ path: join(artifactDir, `public-${brand}-no-config-${viewport.width}.png`), fullPage: true });
        console.log(JSON.stringify({ correlationId: "crm-bootstrap-sept8", result: "PASS", viewport: viewport.width, scenario: "public-card-without-firebase", brand }));
      }
    }
    await context.close();
  }
} finally {
  await browser.close();
}
