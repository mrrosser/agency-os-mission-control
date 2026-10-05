import { expect, test, type Page } from "@playwright/test";

import { WARM_RECONNECT_QA_ORIGINAL_TEST_ID as ORIGINAL, WARM_RECONNECT_QA_REVISED_TEST_ID as REVISED, warmReconnectQaVersion } from "../../lib/crm/warm-reconnect-qa-version";

const API_KEY = "playwright-local-api-key";
const fingerprint = `sha256:${"a".repeat(64)}`;
const review = { ...warmReconnectQaVersion(REVISED), designReady: true, testMode: true, status: "prepared", artifactFingerprint: fingerprint,
  recipient: "owner-qa@example.test", from: "mrosser@rossergallery.com", subject: warmReconnectQaVersion(REVISED).subject,
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


async function fixture(page: Page, baseURL: string, options: { outcome?: "sent" | "delivery_unknown" | "network_error"; blocked?: boolean; wrongVersion?: boolean; holdPrepare?: boolean; target?: string } = {}) {
  const origin = new URL(baseURL).origin;
  expect(["localhost", "127.0.0.1"]).toContain(new URL(origin).hostname);
  const calls: { method: string; path: string; body: Record<string, unknown> | null; uid: string | null }[] = [];
  const prepared = new Set<string>(); const sent = new Set<string>();
  let release: (() => void) | undefined; let held = false;
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
    const uid = auth ? JSON.parse(Buffer.from(auth.split(".")[1], "base64url").toString()).sub : null;
    calls.push({ method: request.method(), path: url.pathname, body: request.postData() ? request.postDataJSON() : null, uid });
    if (!url.pathname.includes("/revised/")) {
      expect(request.method()).toBe("GET");
      return route.fulfill({ json: { ...warmReconnectQaVersion(ORIGINAL), designReady: true, testMode: true, status: "sent", providerMessageId: "original-fixture-receipt" } });
    }
    if (url.pathname.endsWith("/prepare")) {
      if (request.method() === "POST") {
        if (options.holdPrepare && !held) { held = true; await new Promise<void>(resolve => { release = resolve; }); }
        prepared.add(uid);
      }
      const status = options.blocked ? "blocked" : sent.has(uid) ? options.outcome === "sent" || !options.outcome ? "sent" : "delivery_unknown" : prepared.has(uid) ? "prepared" : "not_prepared";
      return route.fulfill({ json: { ...review, ...(options.wrongVersion && prepared.has(uid) ? warmReconnectQaVersion(ORIGINAL) : {}), status, designReady: !options.blocked,
        ...(sent.has(uid) ? { providerMessageId: "revised-fixture-receipt", qaPreferenceState: { topics: { rosser_gallery: true, rt_solutions: true }, globallyUnsubscribed: false, confirmations: 1 } } : {}) } });
    }
    sent.add(uid);
    if (options.outcome === "network_error") return route.abort("failed");
    return route.fulfill({ json: { ...warmReconnectQaVersion(REVISED), testMode: true, status: options.outcome || "sent", providerMessageId: "revised-fixture-receipt" } });
  });
  await page.context().routeWebSocket("**", socket => socket.close());
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await persistUser(page, "qa-owner-a");
  await page.goto(options.target || "/dashboard/crm/test-email", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: options.target ? "Your next conversation." : "Test your outreach email", exact: true })).toBeVisible({ timeout: 20_000 });
  const tour = page.getByTestId("first-scan-tour");
  if (await tour.isVisible().catch(() => false)) await tour.getByTitle("Dismiss").click();
  if (options.target) await page.getByRole("tab", { name: "Outreach", exact: true }).click();
  const panel = page.getByTestId("owner-test-revised");
  await expect(panel.getByRole("button", { name: "Prepare revised private test" })).toBeDisabled();
  return { calls, panel, release: () => release?.() };
}

async function prepare(state: Awaited<ReturnType<typeof fixture>>) {
  await state.panel.getByRole("button", { name: "Refresh revised test" }).click();
  await state.panel.getByLabel("Approved revised-test inbox").fill(review.recipient);
  await state.panel.getByRole("button", { name: "Prepare revised private test" }).click();
}

test.describe("versioned owner test panel with local synthetic authentication", () => {
  test.setTimeout(60_000);
  test.skip(Boolean(process.env.PLAYWRIGHT_BASE_URL), "Synthetic authentication must never run against a deployed service.");

  for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) test(`revised version and readiness controls are visible at ${viewport.width}px`, async ({ page, baseURL }) => {
    await page.setViewportSize(viewport);
    const state = await fixture(page, baseURL!);
    await expect(state.panel.getByRole("heading")).toBeInViewport();
    await expect(state.panel.getByRole("button", { name: "Refresh revised test" })).toBeInViewport();
    await expect(state.panel).toContainText(REVISED);
    expect(state.calls).toEqual([]);
    const width = await page.evaluate(() => ({ content: document.documentElement.scrollWidth, viewport: innerWidth }));
    expect(width.content).toBeLessThanOrEqual(width.viewport + 1);
  });

  test("preserves the original receipt in a read-only panel", async ({ page, baseURL }) => {
    const state = await fixture(page, baseURL!);
    await page.getByText("Original October 4 test receipt (read only)", { exact: true }).click();
    const old = page.getByTestId("owner-test-original");
    await old.getByRole("button", { name: "Refresh original receipt" }).click();
    await expect(old).toContainText("original-fixture-receipt");
    await expect(old.getByRole("button")).toHaveCount(1);
    await expect(old.getByRole("checkbox")).toHaveCount(0);
    expect(state.calls).toHaveLength(1); expect(state.calls[0].method).toBe("GET");
  });

  test("requires revised review, fingerprint and explicit version confirmation", async ({ page, baseURL }) => {
    const state = await fixture(page, baseURL!); await prepare(state);
    await expect(state.panel.getByRole("button", { name: "Send one revised test" })).toBeDisabled();
    await expect(state.panel).toContainText(fingerprint);
    await expect(page.frameLocator('iframe[title="Private revised test email preview"]').locator("a")).not.toHaveAttribute("href");
    await state.panel.getByRole("checkbox").check();
    await state.panel.getByRole("button", { name: "Send one revised test" }).click();
    await expect(state.panel.getByRole("status")).toContainText("This version was sent");
    const sends = state.calls.filter(call => call.path.endsWith("/send"));
    expect(sends).toHaveLength(1);
    expect(sends[0]).toMatchObject({ path: "/api/crm/warm-reconnect/qa/revised/send", uid: "qa-owner-a", body: { recipient: review.recipient, artifactFingerprint: fingerprint, confirmSendOneTest: true, reviewedTestId: REVISED, reviewedDesignVersion: warmReconnectQaVersion(REVISED).designVersion } });
    await state.panel.getByRole("button", { name: "Refresh revised test" }).click();
    await expect(state.panel).toContainText("Test choices: Rosser Gallery and RT.Solutions");
  });

  test("missing exact design disables preparation and send", async ({ page, baseURL }) => {
    const state = await fixture(page, baseURL!, { blocked: true });
    await state.panel.getByRole("button", { name: "Refresh revised test" }).click();
    await expect(state.panel).toContainText("Preparation and sending are disabled");
    await expect(state.panel.getByRole("button", { name: "Prepare revised private test" })).toBeDisabled();
    await expect(state.panel.getByRole("checkbox")).toHaveCount(0);
    expect(state.calls.every(call => call.method === "GET")).toBe(true);
  });

  test("rejects an original-version response at the revised route", async ({ page, baseURL }) => {
    const state = await fixture(page, baseURL!, { wrongVersion: true }); await prepare(state);
    await expect(state.panel.getByRole("alert")).toContainText("This test version could not be loaded");
    await expect(state.panel.getByRole("button", { name: "Send one revised test" })).toHaveCount(0);
    expect(state.calls.filter(call => call.path.endsWith("/send"))).toHaveLength(0);
  });

  for (const outcome of ["delivery_unknown", "network_error"] as const) test(`${outcome} keeps the revised send locked`, async ({ page, baseURL }) => {
    const state = await fixture(page, baseURL!, { outcome }); await prepare(state);
    await state.panel.getByRole("checkbox").check();
    await state.panel.getByRole("button", { name: "Send one revised test" }).click();
    if (outcome === "network_error") await expect(state.panel.getByRole("alert")).toContainText("Do not send another test");
    else await expect(state.panel.getByRole("status")).toContainText("Delivery is uncertain");
    await state.panel.getByRole("button", { name: "Refresh revised test" }).click();
    await expect(state.panel.getByRole("status")).toContainText("Delivery is uncertain");
    await expect(state.panel.getByRole("button", { name: "Send one revised test" })).toHaveCount(0);
    expect(state.calls.filter(call => call.path.endsWith("/send"))).toHaveLength(1);
  });

  test("switching owners ignores a late draft and clears confirmation", async ({ page, baseURL }) => {
    const state = await fixture(page, baseURL!, { holdPrepare: true }); await prepare(state);
    await expect.poll(() => state.calls.length).toBe(2);
    await persistUser(page, "qa-owner-b");
    await expect(state.panel.getByRole("button", { name: "Refresh revised test" })).toBeEnabled({ timeout: 15_000 });
    await expect(state.panel.getByRole("checkbox")).toHaveCount(0);
    state.release();
    await state.panel.getByRole("button", { name: "Refresh revised test" }).click();
    await expect(state.panel.getByLabel("Approved revised-test inbox")).toHaveValue("");
    expect(state.calls.at(-1)?.uid).toBe("qa-owner-b");
    expect(state.calls.some(call => call.path.endsWith("/send"))).toBe(false);
  });

  test("CRM keeps the direct test link and panel before campaign controls", async ({ page, baseURL }) => {
    const state = await fixture(page, baseURL!, { target: "/dashboard/crm" });
    await expect(page.getByRole("link", { name: "Test one email", exact: true })).toHaveAttribute("href", "/dashboard/crm/test-email");
    expect(await page.locator("#crm-panel-outreach > :first-child").getAttribute("data-testid")).toBe("warm-reconnect-owner-test");
    expect(state.calls).toEqual([]);
  });
});
