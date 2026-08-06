import { expect, test } from "@playwright/test";

async function expectNoHorizontalPageOverflow(page: import("@playwright/test").Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(overflow).toBeLessThanOrEqual(1);
}

test.describe("responsive public shell", () => {
  test.describe.configure({ timeout: 90_000 });

  test("login remains usable at desktop and phone widths", async ({ page }) => {
    await page.goto("/login", { waitUntil: "domcontentloaded" });

    await expect(page.getByRole("heading", { name: "Mission Control" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Open beta feedback" })).toBeVisible();
    await expectNoHorizontalPageOverflow(page);

    const phoneTab = page.getByRole("tab", { name: "Phone" });
    await expect(async () => {
      await phoneTab.click();
      expect(await phoneTab.getAttribute("data-state")).toBe("active");
    }).toPass({ timeout: 15_000 });
    await expect(page.getByLabel("Phone Number")).toBeVisible();
  });

  test("public legal shell remains readable without authentication", async ({ page }) => {
    await page.goto("/privacy", { waitUntil: "domcontentloaded" });

    await expect(page.getByRole("heading", { name: "Privacy Policy" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Back to Login" })).toBeVisible();
    await expectNoHorizontalPageOverflow(page);
  });
});
