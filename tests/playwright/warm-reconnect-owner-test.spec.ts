import { expect, test, type Page } from "@playwright/test";

const API_KEY = "playwright-local-api-key";
const fingerprint = `sha256:${"a".repeat(64)}`;
const review = { testMode: true, status: "prepared", artifactFingerprint: fingerprint,
  recipient: "owner-qa@example.test", from: "mrosser@rossergallery.com", subject: "[TEST] A quick hello from Marcus",
  plainText: "Hi Marcus,\nReview fixture only.", html: '<!doctype html><html><head></head><body><p>Hi Marcus,</p><a href="https://example.invalid">Both</a></body></html>' };

async function persistUser(page: Page, uid: string) {
  const now = Date.now();
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const token = [encode({ alg: "none", typ: "JWT" }), encode({ aud: "playwright-local", auth_time: Math.floor(now / 1000),
    exp: Math.floor(now / 1000) + 3600, iat: Math.floor(now / 1000), sub: uid, user_id: uid,
    email: `${uid}@example.test`, email_verified: true, firebase: { sign_in_provider: "custom" } }), "local-fixture-signature"].join(".");
  const user = { uid, email: `${uid}@example.test`, emailVerified: true, displayName: "Local Test Owner", isAnonymous: false,
    providerData: [], stsTokenManager: { refreshToken: "local-fixture-refresh", accessToken: token, expirationTime: now + 3600_000 },
    createdAt: String(now), lastLoginAt: String(now), apiKey: API_KEY, appName: "[DEFAULT]" };
  await page.evaluate(async ({ key, user }) => {
    localStorage.setItem(key, JSON.stringify(user));
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("firebaseLocalStorageDb", 1);
      request.onerror = () => reject(request.error);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains("firebaseLocalStorage")) request.result.createObjectStore("firebaseLocalStorage", { keyPath: "fbase_key" });
      };
      request.onsuccess = () => {
        const db = request.result;
        const transaction = db.transaction("firebaseLocalStorage", "readwrite");
        transaction.objectStore("firebaseLocalStorage").put({ fbase_key: key, value: user });
        transaction.oncomplete = () => { db.close(); resolve(); };
        transaction.onerror = () => { db.close(); reject(transaction.error); };
      };
    });
  }, { key: `firebase:authUser:${API_KEY}:[DEFAULT]`, user });
}

async function fixture(page: Page, baseURL: string, outcome: "sent" | "delivery_unknown" | "network_error" = "sent", holdPrepare = false) {
  const origin = new URL(baseURL).origin;
  expect(["localhost", "127.0.0.1"]).toContain(new URL(origin).hostname);
  const calls: { method: string; path: string; body: Record<string, unknown> | null; uid: string | null }[] = [];
  let release: (() => void) | undefined;
  let prepareCount = 0;
  let sent = false;
  await page.context().route("**/*", async route => {
    const request = route.request(); const url = new URL(request.url());
    if (url.origin !== origin) return route.abort();
    if (!url.pathname.startsWith("/api/")) return route.continue();
    if (!url.pathname.startsWith("/api/crm/warm-reconnect/qa/")) {
      if (url.pathname === "/api/crm/warm-reconnect/activation") return route.fulfill({ json: { schemaVersion: "crm.warm-reconnect-activation.v1", dataClassification: "authenticated_contact_review", providerActions: "none", googleProfiles: [], candidates: [], pilots: [], candidateSummary: { eligibleForReview: 0, returned: 0, excluded: 0, truncated: false }, constraints: { providerExecutionEnabled: false } } });
      if (url.pathname === "/api/crm/warm-reconnect/review") return route.fulfill({ json: { registrySummary: null, campaign: null } });
      if (url.pathname === "/api/crm/customers") return route.fulfill({ json: { customers: [], sourceOfTruth: "firestore_projected" } });
      return route.fulfill({ json: {} });
    }
    const auth = request.headers().authorization;
    calls.push({ method: request.method(), path: url.pathname, body: request.postData() ? request.postDataJSON() : null,
      uid: auth ? JSON.parse(Buffer.from(auth.split(".")[1], "base64url").toString()).sub : null });
    if (url.pathname.endsWith("/prepare")) {
      if (request.method() === "POST" && holdPrepare && prepareCount++ === 0) await new Promise<void>(resolve => { release = resolve; });
      return route.fulfill({ json: { ...review, status: sent ? outcome === "sent" ? "sent" : "delivery_unknown" : "prepared",
        qaPreferenceState: sent ? { topics: { rosser_gallery: true, rt_solutions: true }, globallyUnsubscribed: false, confirmations: 1 } : null } });
    }
    sent = true;
    if (outcome === "network_error") return route.abort("failed");
    return route.fulfill({ json: { testMode: true, status: outcome, providerMessageId: outcome === "sent" ? "local-fixture-delivery" : null } });
  });
  await page.context().routeWebSocket("**", socket => socket.close());
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await persistUser(page, "qa-owner-a");
  await page.goto("/dashboard/crm", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Your next conversation.", exact: true })).toBeVisible({ timeout: 20_000 });
  const tour = page.getByTestId("first-scan-tour");
  if (await tour.isVisible().catch(() => false)) await tour.getByTitle("Dismiss").click();
  await page.getByRole("tab", { name: "Outreach", exact: true }).click();
  const panel = page.getByTestId("warm-reconnect-owner-test");
  await expect(panel.getByRole("button", { name: "Prepare private test" })).toBeDisabled();
  await panel.getByLabel("Approved test inbox").fill(review.recipient);
  await expect(panel.getByRole("button", { name: "Prepare private test" })).toBeEnabled();
  return { calls, panel, release: () => release?.() };
}

test.describe("owner-only test panel with local synthetic authentication", () => {
  test.setTimeout(60_000);
  test.skip(Boolean(process.env.PLAYWRIGHT_BASE_URL), "Synthetic authentication must never run against a deployed service.");

  test("requires review and explicit send, then reads back test-only choices", async ({ page, baseURL }) => {
    const { calls, panel } = await fixture(page, baseURL!);
    expect(calls).toEqual([]);
    await expect(panel).not.toContainText(review.recipient);
    await panel.getByRole("button", { name: "Prepare private test" }).click();
    await expect(panel.getByRole("button", { name: "Send one test" })).toBeDisabled();
    expect(calls[0]).toMatchObject({ method: "POST", uid: "qa-owner-a" });
    expect(calls[0].body).toEqual({ recipient: review.recipient, testOnly: true });
    await expect(panel).toContainText(review.recipient);
    await expect(page.frameLocator('iframe[title="Private test email preview"]').locator("a")).not.toHaveAttribute("href");
    await panel.getByRole("checkbox").check();
    await panel.getByRole("button", { name: "Send one test" }).click();
    await expect(panel.getByRole("status")).toContainText("Test sent.");
    expect(calls[1]).toMatchObject({ method: "POST", uid: "qa-owner-a", body: { recipient: "owner-qa@example.test", artifactFingerprint: fingerprint, confirmSendOneTest: true } });
    await panel.getByRole("button", { name: "Refresh test receipt" }).click();
    await expect(panel).toContainText("Test choices: Rosser Gallery and RT.Solutions");
    expect(calls.filter(call => call.path.endsWith("/send"))).toHaveLength(1);
    expect(calls.at(-1)?.method).toBe("GET");
  });

  for (const outcome of ["delivery_unknown", "network_error"] as const) test(`${outcome} never offers a blind resend`, async ({ page, baseURL }) => {
    const { calls, panel } = await fixture(page, baseURL!, outcome);
    await panel.getByRole("button", { name: "Prepare private test" }).click();
    await panel.getByRole("checkbox").check();
    await panel.getByRole("button", { name: "Send one test" }).click();
    if (outcome === "network_error") await expect(panel.getByRole("alert")).toContainText("Do not send another test");
    else await expect(panel.getByRole("status")).toContainText("Delivery is uncertain");
    await panel.getByRole("button", { name: "Refresh test receipt" }).click();
    await expect(panel.getByRole("status")).toContainText("Delivery is uncertain");
    await expect(panel.getByRole("button", { name: "Send one test" })).toHaveCount(0);
    expect(calls.filter(call => call.path.endsWith("/send"))).toHaveLength(1);
  });

  test("switching owners releases pending controls and ignores a late old-owner draft", async ({ page, baseURL }) => {
    const state = await fixture(page, baseURL!, "sent", true);
    await state.panel.getByRole("button", { name: "Prepare private test" }).click();
    await expect.poll(() => state.calls.length).toBe(1);
    await persistUser(page, "qa-owner-b");
    await expect(state.panel.getByLabel("Approved test inbox")).toBeEnabled({ timeout: 15_000 });
    await expect(state.panel.getByLabel("Approved test inbox")).toHaveValue("");
    await state.panel.getByLabel("Approved test inbox").fill(review.recipient);
    await expect(state.panel.getByRole("button", { name: "Prepare private test" })).toBeEnabled();
    state.release();
    await state.panel.getByRole("button", { name: "Refresh test receipt" }).click();
    await expect(state.panel.getByRole("button", { name: "Send one test" })).toBeDisabled();
    expect(state.calls.at(-1)?.uid).toBe("qa-owner-b");
    expect(state.calls.some(call => call.path.endsWith("/send"))).toBe(false);
  });
});
