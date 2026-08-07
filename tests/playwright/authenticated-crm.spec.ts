import { expect, test, type Page } from "@playwright/test";

const testEmail = process.env.PLAYWRIGHT_TEST_EMAIL;
const testPassword = process.env.PLAYWRIGHT_TEST_PASSWORD;

async function signIn(page: Page) {
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  const directTab = page.getByRole("tab", { name: "Direct" });
  await expect
    .poll(
      async () => {
        await directTab.click();
        return directTab.getAttribute("aria-selected");
      },
      { timeout: 10_000 }
    )
    .toBe("true");
  await expect(page.getByLabel("Email")).toBeVisible();
  await page.getByLabel("Email").fill(testEmail || "");
  await page.getByLabel("Password").fill(testPassword || "");
  await page.getByRole("button", { name: "Sign In" }).click();
  await page.waitForURL(/\/dashboard(?:\/|$)/, { timeout: 30_000 });

  const tour = page.getByTestId("first-scan-tour");
  if (await tour.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await tour.getByTitle("Dismiss").click();
    await expect(tour).toBeHidden();
  }
}

test.describe("authenticated CRM and autonomy UI", () => {
  test.describe.configure({ timeout: 90_000 });
  test.skip(!testEmail || !testPassword, "Set PLAYWRIGHT_TEST_EMAIL and PLAYWRIGHT_TEST_PASSWORD");

  test("desktop and phone operators can use CRM and save autonomy posture", async ({ page }) => {
    const mobile = (page.viewportSize()?.width || 1280) < 768;
    let stagePatch: Record<string, unknown> | null = null;
    let policyPut: Record<string, unknown> | null = null;

    // Specific handlers below are registered later and take precedence. Any
    // unexpected CRM request is blocked from touching production test data.
    await page.route("**/api/crm/**", async (route) => route.abort("blockedbyclient"));
    await page.route("**/api/crm/customers?limit=200", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          sourceOfTruth: "firestore_projected",
          customers: [
            {
              customerId: "ui-audit-customer",
              companyName: "UI Audit Customer",
              contactName: "Test Contact",
              businessUnit: "rt_solutions",
              offerCode: "starter",
              pipelineStage: "qualification",
              timelineCount: 1,
            },
          ],
        }),
      });
    });
    await page.route("**/api/crm/customers/ui-audit-customer", async (route) => {
      if (route.request().method() === "PATCH") {
        stagePatch = route.request().postDataJSON() as Record<string, unknown>;
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
        return;
      }
      await route.abort("blockedbyclient");
    });
    await page.route("**/api/crm/customers/ui-audit-customer/timeline?limit=50", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          sourceOfTruth: "firestore_projected",
          events: [
            {
              eventId: "event-1",
              type: "note",
              channel: "system",
              summary: "Authenticated responsive audit",
              occurredAt: "2026-08-06T12:00:00.000Z",
            },
          ],
        }),
      });
    });
    await page.route("**/api/agents/autonomy-policy", async (route) => {
      if (route.request().method() === "PUT") {
        policyPut = route.request().postDataJSON() as Record<string, unknown>;
        const requested = policyPut as { businessModes?: Record<string, string>; globalKillSwitch?: boolean };
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            policy: {
              uid: "playwright-ui-audit",
              version: 2,
              globalKillSwitch: Boolean(requested.globalKillSwitch),
              businessModes: requested.businessModes,
              updatedAt: "2026-08-06T12:00:00.000Z",
              updatedByUid: "playwright-ui-audit",
            },
            replayed: false,
          }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          policy: {
            uid: "playwright-ui-audit",
            version: 1,
            globalKillSwitch: false,
            businessModes: { rt_solutions: "assist", rosser_gallery: "supervised" },
            updatedAt: null,
            updatedByUid: null,
          },
          history: [],
        }),
      });
    });
    await page.route("**/api/agents/control-plane", async (route) => {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "Mocked during authenticated UI audit" }),
      });
    });
    await page.route("**/api/telemetry/error", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, mocked: true }),
      });
    });

    await signIn(page);
    await page.goto("/dashboard/crm", { waitUntil: "domcontentloaded" });
    const crmSurface = page.getByTestId(mobile ? "crm-mobile-list" : "crm-desktop-board");
    await expect(crmSurface).toBeVisible();
    await expect(crmSurface.getByText("UI Audit Customer").first()).toBeVisible();
    const crmOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(crmOverflow).toBeLessThanOrEqual(1);

    if (mobile) {
      await page.getByLabel("Pipeline stage for UI Audit Customer").selectOption("outreach");
      await expect.poll(() => stagePatch).toMatchObject({ pipelineStage: "outreach" });

      await page.getByRole("button", { name: "Open navigation menu" }).click();
      await expect(page.getByRole("navigation", { name: "Mobile navigation" })).toBeVisible();
      await page.getByRole("link", { name: "Agent Nexus" }).click();
    } else {
      await expect(page.getByRole("navigation", { name: "Primary navigation" })).toBeVisible();
      await page.goto("/dashboard/agents", { waitUntil: "domcontentloaded" });
    }

    await expect(page.getByText("Organization autonomy")).toBeVisible();
    const rtModes = page.getByRole("radiogroup", { name: "RT Solutions autonomy mode" });
    await rtModes.getByRole("radio", { name: "Autonomous (safe)" }).click();
    await page.getByRole("button", { name: "Save policy" }).click();
    await expect(page.getByText("Autonomy policy saved.")).toBeVisible();
    await expect.poll(() => policyPut).toMatchObject({
      businessModes: expect.objectContaining({ rt_solutions: "autonomous_safe" }),
      globalKillSwitch: false,
    });

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
