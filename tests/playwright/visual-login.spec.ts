import { expect, test } from "@playwright/test";

test.describe("visual: login", () => {
  test.describe.configure({ timeout: 60_000 });
  test.use({
    reducedMotion: "reduce",
    viewport: { width: 1280, height: 720 },
  });

  test("login card snapshot is stable", async ({ page }) => {
    // Make canvas/node initialization deterministic to avoid flaky snapshots.
    await page.addInitScript(() => {
      let seed = 1337;
      // Minimal LCG; good enough for deterministic UI tests.
      Math.random = () => {
        seed = (seed * 16807) % 2147483647;
        return (seed - 1) / 2147483646;
      };
    });

    await page.goto("/login", { waitUntil: "networkidle" });

    await expect(page.getByTestId("lead-flow-backdrop")).toHaveCount(1);
    await expect(page.getByTestId("login-card")).toBeVisible();

    // Avoid locator "stable" heuristics in dev mode by clipping a page screenshot.
    const box = await page.getByTestId("login-card").boundingBox();
    expect(box).toBeTruthy();
    const clip = box
      ? { x: box.x, y: box.y, width: box.width, height: box.height }
      : undefined;
    const image = await page.screenshot({ clip });
    expect(image).toMatchSnapshot("login-card.png");
  });
});
