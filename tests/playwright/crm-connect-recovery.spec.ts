import { expect, test, type Page, type Route } from "@playwright/test";

const API_KEY = "playwright-local-api-key";
const UID = "playwright-crm-callback";
const ACTIVATION_PATH = "/api/crm/warm-reconnect/activation";
const CALLBACK_PARAMS = [
  "google", "googleError", "googleErrorDescription", "googleBusiness",
  "googleProfile", "googleCorrelation", "correlationId",
];

async function persistLocalUser(page: Page, uid = UID) {
  const now = Date.now();
  const seconds = Math.floor(now / 1_000);
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const accessToken = [
    encode({ alg: "none", typ: "JWT" }),
    encode({
      aud: "playwright-local", auth_time: seconds, exp: seconds + 3_600,
      iat: seconds, sub: uid, user_id: uid,
      firebase: { sign_in_provider: "custom" },
    }),
    "synthetic-local-signature",
  ].join(".");
  const user = {
    uid, email: `${uid}@example.test`, emailVerified: true,
    displayName: "Synthetic Callback Reviewer", isAnonymous: false, providerData: [],
    stsTokenManager: {
      refreshToken: "synthetic-local-refresh", accessToken, expirationTime: now + 3_600_000,
    },
    createdAt: String(now), lastLoginAt: String(now), apiKey: API_KEY, appName: "[DEFAULT]",
  };
  await page.evaluate(async ({ key, user }) => {
    localStorage.setItem(key, JSON.stringify(user));
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("firebaseLocalStorageDb", 1);
      request.onerror = () => reject(request.error);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains("firebaseLocalStorage")) {
          request.result.createObjectStore("firebaseLocalStorage", { keyPath: "fbase_key" });
        }
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

async function mockCallbackWorkspace(page: Page, baseURL: string) {
  const origin = new URL(baseURL).origin;
  expect(["localhost", "127.0.0.1"]).toContain(new URL(origin).hostname);
  const state = {
    activationReads: 0,
    activationOwners: [] as Array<string | null>,
    mutations: [] as string[],
    unexpectedApi: [] as string[],
    unexpectedExternal: [] as string[],
  };
  const json = (route: Route, body: unknown, status = 200) => route.fulfill({
    status, contentType: "application/json", headers: { "cache-control": "no-store" },
    body: JSON.stringify(body),
  });

  // Every API response is synthetic. OAuth, Firebase infrastructure, and all
  // other external traffic are blocked before navigating to an app page.
  await page.context().route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const label = `${request.method()} ${url.origin}${url.pathname}`;
    if (url.origin !== origin) {
      const firebaseInfrastructure = [
        "identitytoolkit.googleapis.com", "securetoken.googleapis.com", "firestore.googleapis.com",
      ].includes(url.hostname) || (url.hostname === "www.google.com" && url.pathname === "/images/cleardot.gif");
      if (!firebaseInfrastructure) state.unexpectedExternal.push(label);
      return route.abort("blockedbyclient");
    }
    if (!url.pathname.startsWith("/api/")) return route.continue();
    if (url.pathname === "/api/telemetry/error") return json(route, { ok: true });
    if (request.method() !== "GET") {
      state.mutations.push(`${request.method()} ${url.pathname}`);
      return json(route, { error: "Unexpected mutation blocked by the callback fixture" }, 418);
    }
    if (url.pathname === ACTIVATION_PATH) {
      state.activationReads++;
      const auth = request.headers().authorization;
      const uid = auth ? JSON.parse(Buffer.from(auth.split(".")[1], "base64url").toString()).sub as string : null;
      state.activationOwners.push(uid);
      const connectionState = uid === UID ? "not_connected" : "reconnect_required";
      return json(route, {
        schemaVersion: "crm.warm-reconnect-activation.v1",
        dataClassification: "authenticated_contact_review", providerActions: "none",
        workspace: { accessRole: "owner" },
        // A callback query must not override the authoritative status read.
        googleProfiles: [
          { businessId: "rosser_nft_gallery", profileId: "rosser_gallery_send", label: "Gallery sending", state: connectionState, connected: false, gmailCapable: false },
          { businessId: "rt_solutions", profileId: "rt_solutions_send", label: "RT.Solutions sending", state: connectionState, connected: false, gmailCapable: false },
        ],
        candidateSummary: { eligibleForReview: 0, excluded: 0, returned: 0, truncated: false },
        candidates: [], pilots: [],
        constraints: {
          initialPilotSize: 5, expandedPilotRange: [6, 10], expandedPilotRequiresNewApproval: true,
          approvalTtlHours: 24, launchAuthorizesExactProviderExecution: true, providerExecutionEnabled: false,
        },
      });
    }
    if (url.pathname === "/api/crm/customers") return json(route, { sourceOfTruth: "firestore_projected", customers: [] });
    if (url.pathname === "/api/crm/warm-reconnect/review") return json(route, { registrySummary: null, campaign: null });
    if (url.pathname === "/api/revenue/daily-outcomes") return json(route, { asOf: "2026-10-04T00:00:00.000Z", timeZone: "America/Chicago", outcomes: [] });
    state.unexpectedApi.push(`${request.method()} ${url.pathname}`);
    return json(route, { error: "Unexpected API request blocked by the callback fixture" }, 418);
  });
  await page.context().routeWebSocket("**/*", (socket) => socket.close());
  return state;
}

test.describe("local mocked CRM callback recovery", () => {
  test.describe.configure({ mode: "serial", timeout: 90_000 });
  test.use({ viewport: { width: 412, height: 915 } });
  test.skip(Boolean(process.env.PLAYWRIGHT_BASE_URL), "Synthetic authentication must never run against a deployed service.");

  for (const withOutreachHint of [true, false]) {
    for (const outcome of ["connected", "error"] as const) {
      test(`${outcome} callback ${withOutreachHint ? "with an Outreach hint" : "without a tab hint"} keeps Outreach and feedback after URL cleanup`, async ({ page, baseURL }, testInfo) => {
        const state = await mockCallbackWorkspace(page, baseURL!);
        await page.goto("/login", { waitUntil: "domcontentloaded" });
        await persistLocalUser(page);
        const params = new URLSearchParams({
          google: outcome,
          googleBusiness: outcome === "connected" ? "rosser_nft_gallery" : "rt_solutions",
          googleProfile: outcome === "connected" ? "rosser_gallery_send" : "rt_solutions_send",
          googleCorrelation: "synthetic-callback-20261004",
          fixture: "preserved",
        });
        if (withOutreachHint) params.set("tab", "outreach");
        if (outcome === "error") {
          params.set("googleError", "access_denied");
          params.set("googleErrorDescription", "raw-provider-description-must-not-render");
        }
        await page.goto(`/dashboard/crm?${params}`, { waitUntil: "domcontentloaded" });

        await expect(page.getByRole("heading", { name: "Your next conversation.", exact: true })).toBeVisible({ timeout: 20_000 });
        const tour = page.getByTestId("first-scan-tour");
        if (await tour.isVisible().catch(() => false)) await tour.getByTitle("Dismiss").click();
        const outreach = page.getByRole("tab", { name: "Outreach", exact: true });
        await expect(outreach).toHaveAttribute("aria-selected", "true");
        await expect(page.locator("#crm-panel-outreach")).toBeVisible();
        await expect(page.getByRole("tab", { name: "People", exact: true })).toHaveAttribute("aria-selected", "false");

        await expect.poll(() => CALLBACK_PARAMS.filter((key) => new URL(page.url()).searchParams.has(key))).toEqual([]);
        expect(new URL(page.url()).searchParams.get("fixture")).toBe("preserved");
        expect(new URL(page.url()).searchParams.get("tab")).toBe(withOutreachHint ? "outreach" : null);

        const title = outcome === "connected"
          ? "Gallery sending Google connection completed"
          : "RT.Solutions sending Google connection was not completed";
        const feedback = page.getByRole("status").filter({ has: page.getByText(title, { exact: true }) });
        await expect(feedback).toBeVisible();
        await expect(feedback).toContainText(outcome === "connected"
          ? "No campaign was approved, launched, or sent."
          : "The connection was canceled. Try again and choose the Google account intended for this organization.");
        await expect(page.getByText("raw-provider-description-must-not-render", { exact: true })).toHaveCount(0);

        const controls = page.getByTestId("google-sender-connection-controls");
        await expect(controls.getByRole("button", { name: "Connect Gallery sending", exact: true })).toBeEnabled();
        await expect(controls.getByRole("button", { name: "Connect RT.Solutions sending", exact: true })).toBeEnabled();
        await expect.poll(() => state.activationReads).toBeGreaterThan(0);

        // Rerender after cleanup: the callback result should remain readable,
        // and selecting another workspace must not replay the callback action.
        await page.getByRole("tab", { name: "People", exact: true }).click();
        await expect(page.getByRole("tab", { name: "People", exact: true })).toHaveAttribute("aria-selected", "true");
        await expect(feedback).toBeVisible();
        await outreach.click();
        await expect(outreach).toHaveAttribute("aria-selected", "true");
        await expect(feedback).toBeVisible();
        expect(state.mutations).toEqual([]);
        expect(state.unexpectedApi).toEqual([]);
        expect(state.unexpectedExternal).toEqual([]);

        await testInfo.attach("crm-callback-recovery", {
          body: await page.screenshot({ fullPage: true, style: "nextjs-portal { display: none !important; }" }),
          contentType: "image/png",
        });
      });
    }
  }

  test("switching Firebase owners removes the cleaned callback banner and reloads that owner's connection status", async ({ page, baseURL }) => {
    const state = await mockCallbackWorkspace(page, baseURL!);
    await page.goto("/login", { waitUntil: "domcontentloaded" });
    await persistLocalUser(page);
    await page.goto("/dashboard/crm?google=connected&googleBusiness=rosser_nft_gallery&googleProfile=rosser_gallery_send", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Your next conversation.", exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("tab", { name: "Outreach", exact: true })).toHaveAttribute("aria-selected", "true");
    const title = page.getByText("Gallery sending Google connection completed", { exact: true });
    await expect(title).toBeVisible();
    await expect.poll(() => CALLBACK_PARAMS.filter((key) => new URL(page.url()).searchParams.has(key))).toEqual([]);
    const controls = page.getByTestId("google-sender-connection-controls");
    await expect(controls.getByText("Not Connected", { exact: true })).toHaveCount(2);
    expect(state.activationOwners).toContain(UID);

    // Updating Firebase persistence exercises the mounted auth subscription;
    // a document reload would erase retained state without testing isolation.
    const originalDocument = await page.evaluateHandle(() => document);
    const otherUid = "playwright-crm-callback-other-owner";
    await persistLocalUser(page, otherUid);
    await expect.poll(() => state.activationOwners.includes(otherUid), { timeout: 15_000 }).toBe(true);
    await expect(title).toHaveCount(0);
    await expect(controls.getByText("Reconnect Required", { exact: true })).toHaveCount(2);
    await expect(controls.getByText("Not Connected", { exact: true })).toHaveCount(0);
    await expect(controls.getByRole("button", { name: "Connect Gallery sending", exact: true })).toBeEnabled();
    await expect(controls.getByRole("button", { name: "Connect RT.Solutions sending", exact: true })).toBeEnabled();
    expect(await originalDocument.evaluate((previous) => previous === document)).toBe(true);
    await originalDocument.dispose();
    await expect(page).toHaveURL(/\/dashboard\/crm$/);
    expect(state.mutations).toEqual([]);
    expect(state.unexpectedApi).toEqual([]);
    expect(state.unexpectedExternal).toEqual([]);
  });
});
