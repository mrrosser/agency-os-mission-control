import { expect, test, type Page, type Route } from "@playwright/test";

const API_KEY = "playwright-local-api-key";
const UID = "playwright-sender-owner";
const ACTIVATION_PATH = "/api/crm/warm-reconnect/activation";
const CONNECT_PATH = "/api/google/connect";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth?state=synthetic-local-only";
const GALLERY = "Connect Gallery sending";
const RT = "Connect RT.Solutions sending";

function activation() {
  return {
    schemaVersion: "crm.warm-reconnect-activation.v1",
    dataClassification: "authenticated_contact_review",
    providerActions: "none",
    workspace: { accessRole: "owner" },
    googleProfiles: [
      { businessId: "rosser_nft_gallery", profileId: "rosser_gallery_send", label: "Gallery sending", state: "not_connected", connected: false, gmailCapable: false },
      { businessId: "rt_solutions", profileId: "rt_solutions_send", label: "RT.Solutions sending", state: "not_connected", connected: false, gmailCapable: false },
    ],
    candidateSummary: { eligibleForReview: 0, excluded: 0, returned: 0, truncated: false },
    candidates: [],
    pilots: [],
    constraints: { initialPilotSize: 5, expandedPilotRange: [6, 10], expandedPilotRequiresNewApproval: true, approvalTtlHours: 24, launchAuthorizesExactProviderExecution: true, providerExecutionEnabled: false },
  };
}

async function persistUser(page: Page, uid = UID) {
  const now = Date.now();
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const token = [encode({ alg: "none", typ: "JWT" }), encode({
    aud: "playwright-local", auth_time: Math.floor(now / 1000), exp: Math.floor(now / 1000) + 3600,
    iat: Math.floor(now / 1000), sub: uid, user_id: uid, email: `${uid}@example.test`, email_verified: true,
    firebase: { sign_in_provider: "custom" },
  }), "synthetic-local-signature"].join(".");
  const user = {
    uid, email: `${uid}@example.test`, emailVerified: true, displayName: "Synthetic Sender Reviewer", isAnonymous: false,
    providerData: [], stsTokenManager: { refreshToken: "synthetic-local-refresh", accessToken: token, expirationTime: now + 3600_000 },
    createdAt: String(now), lastLoginAt: String(now), apiKey: API_KEY, appName: "[DEFAULT]",
  };
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

type Outcome = "success" | "network_error" | "server_error";
type ApiCall = { method: string; path: string; uid: string | null; body: Record<string, unknown> | null };

async function fixture(page: Page, baseURL: string, outcomes: Array<Outcome | "hold"> = ["hold"]) {
  const origin = new URL(baseURL).origin;
  expect(["localhost", "127.0.0.1"]).toContain(new URL(origin).hostname);
  const state = { calls: [] as ApiCall[], unexpectedApi: [] as string[], unexpectedExternal: [] as string[], oauthNavigations: [] as string[], blockedInfrastructure: [] as string[] };
  const held = new Map<number, (outcome: Outcome) => void>();
  let connectCount = 0;

  // Deliberately let this mocked transport resolve after cancellation. This
  // tests stale-result protection, not merely native fetch's abort behavior.
  await page.addInitScript(() => {
    const fixtureWindow = window as typeof window & { __senderSettled?: number; __senderDocument?: string };
    fixtureWindow.__senderSettled = 0;
    fixtureWindow.__senderDocument = crypto.randomUUID();
    const nativeFetch = window.fetch.bind(window);
    window.fetch = async (...args: Parameters<typeof fetch>) => {
      const input = args[0];
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, window.location.href);
      if (url.pathname !== "/api/google/connect") return nativeFetch(...args);
      const init = { ...args[1] };
      delete init.signal;
      try {
        const response = await nativeFetch(input, init);
        await response.clone().text();
        return response;
      } finally { fixtureWindow.__senderSettled!++; }
    };
  });

  const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", headers: { "cache-control": "no-store" }, body: JSON.stringify(body) });
  await page.context().route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== origin) {
      const label = `${request.method()} ${url.origin}${url.pathname}`;
      if (url.hostname === "accounts.google.com") state.oauthNavigations.push(label);
      else if (["identitytoolkit.googleapis.com", "securetoken.googleapis.com", "firestore.googleapis.com"].includes(url.hostname) || (url.hostname === "www.google.com" && url.pathname === "/images/cleardot.gif")) state.blockedInfrastructure.push(label);
      else state.unexpectedExternal.push(label);
      return route.abort("blockedbyclient");
    }
    if (!url.pathname.startsWith("/api/")) return route.continue();
    if (url.pathname === "/api/telemetry/error") return json(route, { ok: true });
    let uid: string | null = null;
    const auth = request.headers().authorization;
    if (auth) uid = JSON.parse(Buffer.from(auth.split(".")[1], "base64url").toString()).sub;
    const body = request.postData() ? request.postDataJSON() as Record<string, unknown> : null;
    state.calls.push({ method: request.method(), path: url.pathname, uid, body });
    if (request.method() === "GET") {
      if (url.pathname === ACTIVATION_PATH) return json(route, activation());
      if (url.pathname === "/api/crm/customers") return json(route, { sourceOfTruth: "firestore_projected", customers: [] });
      if (url.pathname === "/api/crm/warm-reconnect/review") return json(route, { registrySummary: null, campaign: null });
      if (url.pathname === "/api/revenue/daily-outcomes") return json(route, { asOf: new Date().toISOString(), timeZone: "America/Chicago", outcomes: [] });
    }
    if (request.method() === "POST" && url.pathname === CONNECT_PATH) {
      const index = connectCount++;
      let outcome = outcomes[index] || "server_error";
      if (outcome === "hold") outcome = await new Promise<Outcome>((resolve) => { held.set(index, resolve); });
      if (outcome === "network_error") return route.abort("failed");
      if (outcome === "server_error") return json(route, { error: "Synthetic connection unavailable; retry explicitly." }, 503);
      return json(route, { authUrl: AUTH_URL, businessId: body?.businessId, profileId: body?.profileId });
    }
    state.unexpectedApi.push(`${request.method()} ${url.pathname}`);
    return json(route, { error: "Unexpected API blocked by local sender fixture" }, 418);
  });
  await page.context().routeWebSocket("**", (socket) => socket.close());
  return {
    state,
    release(index: number, outcome: Outcome = "success") { const resolve = held.get(index); held.delete(index); resolve?.(outcome); },
    releaseAll() { for (const resolve of held.values()) resolve("server_error"); held.clear(); },
  };
}

const controls = (page: Page) => page.getByTestId("google-sender-connection-controls");
const connectCalls = (state: Awaited<ReturnType<typeof fixture>>["state"]) => state.calls.filter((call) => call.path === CONNECT_PATH);

async function openOutreach(page: Page) {
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await persistUser(page);
  await page.goto("/dashboard/crm", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Your next conversation.", exact: true })).toBeVisible({ timeout: 20_000 });
  const tour = page.getByTestId("first-scan-tour");
  if (await tour.isVisible().catch(() => false)) await tour.getByTitle("Dismiss").click();
  await page.getByRole("tab", { name: "Outreach", exact: true }).click();
  await expect(controls(page).getByRole("button", { name: GALLERY, exact: true })).toBeEnabled();
  await expect(controls(page).getByRole("button", { name: RT, exact: true })).toBeEnabled();
}

async function waitForLateResponse(page: Page, count = 1) {
  await page.waitForFunction((expected) => ((window as typeof window & { __senderSettled?: number }).__senderSettled || 0) >= expected, count);
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

function assertIsolated(state: Awaited<ReturnType<typeof fixture>>["state"], expectedNavigationCount = 0) {
  expect(state.unexpectedApi).toEqual([]);
  expect(state.unexpectedExternal).toEqual([]);
  expect(state.oauthNavigations).toHaveLength(expectedNavigationCount);
  expect(state.calls.filter((call) => call.method !== "GET").every((call) => call.path === CONNECT_PATH)).toBe(true);
}

test.describe("local mocked sender connection recovery", () => {
  test.describe.configure({ mode: "serial", timeout: 90_000 });
  test.use({ viewport: { width: 412, height: 915 } });
  test.skip(Boolean(process.env.PLAYWRIGHT_BASE_URL), "Synthetic authentication must never run against a deployed service.");

  test("a current successful attempt navigates once to the intercepted Google authorization destination", async ({ page, baseURL }) => {
    const mock = await fixture(page, baseURL!, ["success"]);
    await openOutreach(page);
    await controls(page).getByRole("button", { name: GALLERY, exact: true }).click();
    await expect.poll(() => mock.state.oauthNavigations).toEqual(["GET https://accounts.google.com/o/oauth2/v2/auth"]);
    expect(connectCalls(mock.state)).toHaveLength(1);
    assertIsolated(mock.state, 1);
  });

  test("disables both senders and ignores repeated taps while one connection is opening", async ({ page, baseURL }) => {
    const mock = await fixture(page, baseURL!);
    try {
      await openOutreach(page);
      await controls(page).getByRole("button", { name: GALLERY, exact: true }).click();
      await expect.poll(() => connectCalls(mock.state).length).toBe(1);
      await expect(controls(page).getByRole("button", { name: "Opening Google…", exact: true })).toBeDisabled();
      await expect(controls(page).getByRole("button", { name: RT, exact: true })).toBeDisabled();
      await controls(page).getByRole("button", { name: /^(Opening Google…|Connect .* sending)$/ }).evaluateAll((buttons) => { for (let repeat = 0; repeat < 3; repeat++) for (const button of buttons) (button as HTMLButtonElement).click(); });
      expect(connectCalls(mock.state)).toHaveLength(1);
      expect(connectCalls(mock.state)[0]).toMatchObject({ uid: UID, body: { returnTo: "/dashboard/crm", scopePreset: "gmail_send", businessId: "rosser_nft_gallery", profileId: "rosser_gallery_send" } });
      mock.release(0, "server_error");
      await expect(controls(page).getByRole("alert")).toContainText("Synthetic connection unavailable");
      await expect(controls(page).getByRole("button", { name: GALLERY, exact: true })).toBeEnabled();
      assertIsolated(mock.state);
    } finally { mock.releaseAll(); }
  });

  test("shows a failed fetch next to the sender controls and retries only after another explicit tap", async ({ page, baseURL }) => {
    const mock = await fixture(page, baseURL!, ["network_error", "server_error"]);
    await openOutreach(page);
    await controls(page).getByRole("button", { name: RT, exact: true }).click();
    await expect(controls(page).getByRole("alert")).toBeVisible();
    await expect(controls(page).getByRole("button", { name: GALLERY, exact: true })).toBeEnabled();
    await expect(controls(page).getByRole("button", { name: RT, exact: true })).toBeEnabled();
    expect(connectCalls(mock.state)).toHaveLength(1);
    await controls(page).getByRole("button", { name: RT, exact: true }).click();
    await expect(controls(page).getByRole("alert")).toContainText("Synthetic connection unavailable");
    expect(connectCalls(mock.state)).toHaveLength(2);
    expect(connectCalls(mock.state).every((call) => call.body?.profileId === "rt_solutions_send")).toBe(true);
    assertIsolated(mock.state);
  });

  test("ends a timed-out connection with an inline error and ignores its late authorization URL", async ({ page, baseURL }) => {
    const mock = await fixture(page, baseURL!);
    try {
      await openOutreach(page);
      await page.clock.install();
      await controls(page).getByRole("button", { name: GALLERY, exact: true }).click();
      await expect.poll(() => connectCalls(mock.state).length).toBe(1);
      await page.clock.fastForward(20_100);
      await expect(controls(page).getByRole("alert")).toContainText(/did not finish in time|timed out|taking too long/i);
      await expect(controls(page).getByRole("button", { name: GALLERY, exact: true })).toBeEnabled();
      await expect(controls(page).getByRole("button", { name: RT, exact: true })).toBeEnabled();
      mock.release(0);
      await waitForLateResponse(page);
      await expect(page).toHaveURL(/\/dashboard\/crm$/);
      expect(connectCalls(mock.state)).toHaveLength(1);
      assertIsolated(mock.state);
    } finally { mock.releaseAll(); }
  });

  test("a persisted pageshow clears busy state and refreshes status without restarting OAuth", async ({ page, baseURL }) => {
    const mock = await fixture(page, baseURL!);
    try {
      await openOutreach(page);
      await controls(page).getByRole("button", { name: GALLERY, exact: true }).click();
      await expect.poll(() => connectCalls(mock.state).length).toBe(1);
      const readsBefore = mock.state.calls.filter((call) => call.path === ACTIVATION_PATH).length;
      await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
      await expect.poll(() => mock.state.calls.filter((call) => call.path === ACTIVATION_PATH).length).toBeGreaterThan(readsBefore);
      await expect(controls(page).getByRole("button", { name: GALLERY, exact: true })).toBeEnabled();
      await expect(controls(page).getByRole("button", { name: RT, exact: true })).toBeEnabled();
      mock.release(0);
      await waitForLateResponse(page);
      await expect(page).toHaveURL(/\/dashboard\/crm$/);
      expect(connectCalls(mock.state)).toHaveLength(1);
      assertIsolated(mock.state);
    } finally { mock.releaseAll(); }
  });

  test("switching Firebase owners prevents the previous owner's late authorization redirect", async ({ page, baseURL }) => {
    const mock = await fixture(page, baseURL!);
    try {
      await openOutreach(page);
      await controls(page).getByRole("button", { name: RT, exact: true }).click();
      await expect.poll(() => connectCalls(mock.state).length).toBe(1);
      const otherUid = "playwright-sender-other-owner";
      await persistUser(page, otherUid);
      await expect.poll(() => mock.state.calls.some((call) => call.path === ACTIVATION_PATH && call.uid === otherUid), { timeout: 15_000 }).toBe(true);
      await expect(controls(page).getByRole("button", { name: RT, exact: true })).toBeEnabled();
      mock.release(0);
      await waitForLateResponse(page);
      await expect(page).toHaveURL(/\/dashboard\/crm$/);
      expect(connectCalls(mock.state)).toHaveLength(1);
      expect(connectCalls(mock.state)[0].uid).toBe(UID);
      assertIsolated(mock.state);
    } finally { mock.releaseAll(); }
  });

  test("leaving CRM through mobile navigation suppresses a late authorization redirect", async ({ page, baseURL }) => {
    const mock = await fixture(page, baseURL!);
    try {
      await openOutreach(page);
      const documentId = await page.evaluate(() => (window as typeof window & { __senderDocument?: string }).__senderDocument);
      await controls(page).getByRole("button", { name: GALLERY, exact: true }).click();
      await expect.poll(() => connectCalls(mock.state).length).toBe(1);
      await page.getByRole("button", { name: "Open navigation menu", exact: true }).click();
      await page.getByRole("navigation", { name: "Mobile navigation", exact: true }).getByRole("link", { name: "Calendar", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Calendar", exact: true })).toBeVisible();
      await expect(controls(page)).toHaveCount(0);
      expect(await page.evaluate(() => (window as typeof window & { __senderDocument?: string }).__senderDocument)).toBe(documentId);
      mock.release(0);
      await waitForLateResponse(page);
      await expect(page).toHaveURL(/\/dashboard\/calendar$/);
      expect(connectCalls(mock.state)).toHaveLength(1);
      assertIsolated(mock.state);
    } finally { mock.releaseAll(); }
  });
});
