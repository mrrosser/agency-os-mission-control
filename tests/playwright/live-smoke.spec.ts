import { test, expect } from "@playwright/test";

test.describe("live smoke", () => {
  test.skip(
    !process.env.PLAYWRIGHT_BASE_URL,
    "Set PLAYWRIGHT_BASE_URL (ex: https://leadflow-review.web.app) to run live smoke tests."
  );

  test("api: /api/health returns JSON + correlation id", async ({ request }) => {
    const res = await request.get("/api/health");
    expect(res.status()).toBe(200);

    const headers = res.headers();
    expect(headers["content-type"]).toContain("application/json");
    expect(headers["x-correlation-id"]).toBeTruthy();

    const body = await res.json();
    expect(body).toEqual(
      expect.objectContaining({
        status: "ok",
      })
    );
  });

  test("api: /api/google/status returns JSON 401 when unauthenticated", async ({ request }) => {
    const res = await request.get("/api/google/status");
    expect(res.status()).toBe(401);
    expect(res.headers()["content-type"]).toContain("application/json");

    const body = await res.json();
    expect(body).toEqual(
      expect.objectContaining({
        error: expect.any(String),
        correlationId: expect.any(String),
      })
    );
  });

  test("ui: /login renders", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "Mission Control" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
  });
});
