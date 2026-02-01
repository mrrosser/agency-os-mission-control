import { test, expect } from "@playwright/test";

test("smoke: basic rendering", async ({ page }) => {
  await page.goto("data:text/html,<h1>Playwright Smoke</h1>");
  await expect(page.locator("h1")).toHaveText("Playwright Smoke");
});
