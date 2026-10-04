import { expect, test } from "@playwright/test";

// Synthetic capabilities and intercepted API only. No contact or provider access.
const token = "p".repeat(43);
const empty = { rosser_gallery: false, rt_solutions: false };

for (const [choice, selected] of [
  ["rosser_gallery", [true, false]],
  ["rt_solutions", [false, true]],
  ["both", [true, true]],
] as const) {
  test(`${choice} preselects but only explicit confirmation saves`, async ({ page }) => {
    const bodies: Record<string, unknown>[] = [];
    await page.route("**/api/crm/warm-reconnect/preferences", async (route) => {
      const body = route.request().postDataJSON();
      bodies.push(body);
      await route.fulfill({ json: { available: true, canUpdatePreferences: true, globallyUnsubscribed: false,
        topics: body.action === "save_preferences" ? body.topics : empty, message: "Your choices are saved." } });
    });
    await page.goto(`/preferences#token=${token}&choice=${choice}`);
    await expect(page.getByRole("button", { name: "Confirm my updates" })).toBeEnabled();
    const boxes = page.getByRole("checkbox");
    await expect(boxes).toHaveCount(2);
    for (let i = 0; i < 2; i++) await expect(boxes.nth(i)).toBeChecked({ checked: selected[i] });
    expect(new URL(page.url()).hash).toBe("");
    expect(bodies).toEqual([{ action: "inspect", token }]);
    await page.getByRole("button", { name: "Confirm my updates" }).click();
    await expect(page.getByRole("status")).toHaveText("Your choices are saved.");
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toMatchObject({ action: "save_preferences", token,
      topics: { rosser_gallery: selected[0], rt_solutions: selected[1] } });
    expect(bodies[1].requestId).toEqual(expect.any(String));
  });
}

test("generic links stay unselected and empty confirmation cannot subscribe", async ({ page }) => {
  const actions: string[] = [];
  await page.route("**/api/crm/warm-reconnect/preferences", async (route) => {
    actions.push(route.request().postDataJSON().action);
    await route.fulfill({ json: { available: true, canUpdatePreferences: true, topics: empty } });
  });
  await page.goto(`/preferences#token=${token}`);
  await expect(page.getByRole("button", { name: "Confirm my updates" })).toBeEnabled();
  await expect(page.getByRole("checkbox").nth(0)).not.toBeChecked();
  await expect(page.getByRole("checkbox").nth(1)).not.toBeChecked();
  await page.getByRole("button", { name: "Confirm my updates" }).click();
  await expect(page.getByRole("status")).toContainText("Choose at least one update");
  expect(actions).toEqual(["inspect"]);
});

test("expired links do not apply a choice or enable subscription; unsubscribe still confirms", async ({ page }) => {
  const actions: string[] = [];
  await page.route("**/api/crm/warm-reconnect/preferences", async (route) => {
    const action = route.request().postDataJSON().action;
    actions.push(action);
    await route.fulfill({ json: { available: true, expired: true, canUpdatePreferences: false,
      globallyUnsubscribed: action === "unsubscribe", topics: empty, message: "Unsubscribed." } });
  });
  await page.goto(`/preferences#token=${token}&choice=both`);
  await expect(page.getByRole("button", { name: "Confirm my updates" })).toBeDisabled();
  await expect(page.getByRole("checkbox").nth(0)).not.toBeChecked();
  await expect(page.getByRole("checkbox").nth(1)).not.toBeChecked();
  await page.getByRole("button", { name: "Unsubscribe from promotional email" }).click();
  expect(actions).toEqual(["inspect"]);
  await page.getByRole("button", { name: "Yes, unsubscribe me" }).click();
  await expect(page.getByRole("heading", { name: "You're unsubscribed." })).toBeVisible();
  expect(actions).toEqual(["inspect", "unsubscribe"]);
});

test("existing opt-out cannot be overridden by a choice link", async ({ page }) => {
  const actions: string[] = [];
  await page.route("**/api/crm/warm-reconnect/preferences", async (route) => {
    actions.push(route.request().postDataJSON().action);
    await route.fulfill({ json: { available: true, canUpdatePreferences: false, globallyUnsubscribed: true, topics: empty } });
  });
  await page.goto(`/preferences#token=${token}&choice=both`);
  await expect(page.getByRole("heading", { name: "You're unsubscribed." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Confirm my updates" })).toHaveCount(0);
  expect(actions).toEqual(["inspect"]);
});

test("QA choice uses only isolated QA API with a visible TEST notice and explicit nonce-bound confirmation", async ({ page }) => {
  const bodies: Record<string, unknown>[] = [];
  const campaignRequests: string[] = [];
  await page.route("**/api/crm/warm-reconnect/preferences", async (route) => {
    campaignRequests.push(route.request().url()); await route.abort();
  });
  await page.route("**/api/crm/warm-reconnect/qa/preferences", async (route) => {
    const body = route.request().postDataJSON(); bodies.push(body);
    await route.fulfill({ json: { available: true, canUpdatePreferences: true, testMode: true,
      confirmationNonce: "fixture-confirmation-nonce", topics: body.topics || empty, message: "Test choices saved. No newsletter subscription was changed." } });
  });
  await page.goto(`/preferences#token=${token}&mode=qa&choice=both`);
  await expect(page.getByRole("note")).toContainText("TEST:");
  await expect(page.getByRole("checkbox").nth(0)).toBeChecked();
  await expect(page.getByRole("checkbox").nth(1)).toBeChecked();
  expect(bodies).toEqual([{ action: "inspect", token }]);
  await page.getByRole("button", { name: "Confirm my updates" }).click();
  await expect(page.getByRole("status")).toContainText("Test choices saved");
  expect(bodies[1]).toMatchObject({ action: "save_preferences", confirmationNonce: "fixture-confirmation-nonce", topics: { rosser_gallery: true, rt_solutions: true } });
  expect(bodies[1].requestId).toEqual(expect.any(String));
  expect(campaignRequests).toEqual([]);
});

test("QA unsubscribe remains a separate explicit confirmation with a request ID", async ({ page }) => {
  const bodies: Record<string, unknown>[] = [];
  await page.route("**/api/crm/warm-reconnect/qa/preferences", async (route) => {
    const body = route.request().postDataJSON(); bodies.push(body);
    await route.fulfill({ json: { available: true, canUpdatePreferences: false, expired: true, testMode: true,
      confirmationNonce: "fixture-confirmation-nonce", globallyUnsubscribed: body.action === "unsubscribe", topics: empty, message: "Test unsubscribed." } });
  });
  await page.goto(`/preferences#token=${token}&mode=qa&choice=both`);
  await expect(page.getByRole("note")).toContainText("only to this private test");
  await page.getByRole("button", { name: "Unsubscribe from promotional email" }).click();
  expect(bodies).toHaveLength(1);
  await page.getByRole("button", { name: "Yes, unsubscribe me" }).click();
  await expect(page.getByRole("heading", { name: "Test unsubscribe saved." })).toBeVisible();
  await expect(page.getByText("Your test choices are cleared. Real newsletter subscriptions and campaign contacts are unchanged.")).toBeVisible();
  expect(bodies[1]).toMatchObject({ action: "unsubscribe", confirmationNonce: "fixture-confirmation-nonce" });
  expect(bodies[1].requestId).toEqual(expect.any(String));
});
