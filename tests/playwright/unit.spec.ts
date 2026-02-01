import { test, expect } from "@playwright/test";

test("unit: mocked api response", async ({ page }) => {
  await page.route("**/api/health", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true }),
    });
  });

  await page.setContent(`
    <button id="run">Run</button>
    <pre id="out"></pre>
    <script>
      document.getElementById('run').addEventListener('click', async () => {
        const res = await fetch('https://example.test/api/health');
        const data = await res.json();
        document.getElementById('out').textContent = data.ok ? 'ok' : 'fail';
      });
    </script>
  `);

  await page.click("#run");
  await expect(page.locator("#out")).toHaveText("ok");
});
