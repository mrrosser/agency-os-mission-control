import { expect, test, type Page } from "@playwright/test";

const LOCAL_FIREBASE_API_KEY = "playwright-local-api-key";
const LOCAL_AUTH_STORAGE_KEY =
  `firebase:authUser:${LOCAL_FIREBASE_API_KEY}:[DEFAULT]`;

function localOnlyIdToken(): string {
  const encode = (value: Record<string, unknown>) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const now = Math.floor(Date.now() / 1_000);
  return [
    encode({ alg: "none", typ: "JWT" }),
    encode({
      aud: "playwright-local",
      auth_time: now,
      exp: now + 3_600,
      firebase: { sign_in_provider: "custom" },
      iat: now,
      sub: "playwright-application-desk",
      user_id: "playwright-application-desk",
    }),
    "local-playwright-signature",
  ].join(".");
}

async function seedLocalFirebaseUser(page: Page): Promise<void> {
  const now = Date.now();
  const user = {
    uid: "playwright-application-desk",
    email: "application-desk@playwright.local",
    emailVerified: true,
    displayName: "Application Desk Audit",
    isAnonymous: false,
    providerData: [],
    stsTokenManager: {
      refreshToken: "local-playwright-refresh-token",
      accessToken: localOnlyIdToken(),
      expirationTime: now + 3_600_000,
    },
    createdAt: String(now),
    lastLoginAt: String(now),
    apiKey: LOCAL_FIREBASE_API_KEY,
    appName: "[DEFAULT]",
  };

  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await page.evaluate(
    async ({ key, persistedUser }) => {
      localStorage.setItem(key, JSON.stringify(persistedUser));
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("firebaseLocalStorageDb", 1);
        request.onerror = () => reject(request.error);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains("firebaseLocalStorage")) {
            db.createObjectStore("firebaseLocalStorage", { keyPath: "fbase_key" });
          }
        };
        request.onsuccess = () => {
          const db = request.result;
          const transaction = db.transaction("firebaseLocalStorage", "readwrite");
          transaction.objectStore("firebaseLocalStorage").put({
            fbase_key: key,
            value: persistedUser,
          });
          transaction.oncomplete = () => {
            db.close();
            resolve();
          };
          transaction.onerror = () => reject(transaction.error);
        };
      });
    },
    { key: LOCAL_AUTH_STORAGE_KEY, persistedUser: user },
  );
}

test.describe("local mocked Application Desk", () => {
  test.use({ viewport: { width: 412, height: 915 } });
  test.skip(
    Boolean(process.env.PLAYWRIGHT_BASE_URL),
    "This authenticated fixture is local-only and must never run against a deployed service.",
  );

  test("mobile navigation exposes the desk and the route has no horizontal overflow", async ({
    page,
  }, testInfo) => {
    await page.route(/https:\/\/(identitytoolkit|securetoken|firestore)\.googleapis\.com\/.*/, (route) =>
      route.abort("blockedbyclient"),
    );
    await page.route("**/api/telemetry/error", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' }),
    );
    await page.route("**/api/application-desk/workspaces", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "x-correlation-id": "playwright-workspaces" },
        body: JSON.stringify({
          workspaces: [
            {
              id: "ws_cd43331c4b1648d0",
              slug: "marcus-rosser",
              name: "Marcus Rosser",
              status: "active",
              defaultProfileVersion: "artist-manager-default@v1",
            },
          ],
        }),
      }),
    );
    await page.route("**/api/application-desk/reviews", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "x-correlation-id": "playwright-reviews" },
        body: JSON.stringify({
          canDecide: true,
          items: [
            {
              schemaVersion: "artist-manager.application-review-item.v1",
              reviewId: "review_playwright_mobile",
              workspaceId: "ws_cd43331c4b1648d0",
              opportunityId: "opportunity_playwright_mobile",
              applicantTrack: "marcus_artist",
              reviewRoundId: "round_playwright_mobile",
              actionFingerprint: "action_fingerprint_playwright",
              artifactFingerprint: "artifact_fingerprint_playwright",
              stateRef: "state:playwright-mobile",
              status: "needs_review",
              opportunity: {
                id: "opportunity_playwright_mobile",
                workspaceId: "ws_cd43331c4b1648d0",
                lane: "artist_call",
                sourceDomain: "example.org",
                title: "Mobile Application Desk Verification",
                organization: "Playwright Arts Council",
                summary: "A local-only record used to verify the responsive review interface.",
                url: "https://example.org/opportunity",
                location: "New Orleans, LA",
                deadline: "2026-08-21",
                feeUsd: 0,
                requirements: [],
                sourceOfficial: true,
                fitScore: 92,
                fitLabel: "strong",
                rationale: ["Local responsive audit"],
                missingRequirementKeys: [],
                executionPolicy: "review_required",
                requirementsVerified: true,
                applicationReady: true,
                workflowStatus: "review_required",
              },
              approvalScope: ["internal_preparation"],
              excludedScope: ["external_submission", "payment", "communication"],
              preparationBlockers: [],
              reviewBlockers: [],
              approvalEligible: true,
              driftReasons: [],
              latestDecisionId: null,
              latestDecisionKind: null,
              decisionNote: "",
              deferUntil: null,
              decidedAt: null,
            },
          ],
        }),
      }),
    );

    await seedLocalFirebaseUser(page);
    await page.goto("/dashboard/opportunities", { waitUntil: "domcontentloaded" });

    await expect(
      page.getByRole("heading", { name: "Application Desk", exact: true }),
    ).toBeVisible();
    await expect(page.getByTestId("application-review-desk")).toBeVisible();
    await expect(page.getByText("Mobile Application Desk Verification")).toBeVisible();

    await page.getByRole("button", { name: "Open navigation menu" }).click();
    const mobileNavigation = page.getByRole("navigation", { name: "Mobile navigation" });
    await expect(mobileNavigation).toBeVisible();
    const deskLink = mobileNavigation.getByRole("link", { name: "Application Desk" });
    await expect(deskLink).toBeVisible();
    await expect(deskLink).toHaveAttribute("aria-current", "page");
    await testInfo.attach("application-desk-mobile-navigation", {
      body: await page.screenshot({
        fullPage: true,
        style: "nextjs-portal { display: none !important; }",
      }),
      contentType: "image/png",
    });
    await page.keyboard.press("Escape");

    const overflow = await page.evaluate(() => ({
      body: document.body.scrollWidth - document.body.clientWidth,
      document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }));
    expect(overflow.body).toBeLessThanOrEqual(1);
    expect(overflow.document).toBeLessThanOrEqual(1);

    await testInfo.attach("application-desk-mobile-route", {
      body: await page.screenshot({
        fullPage: true,
        style: "nextjs-portal { display: none !important; }",
      }),
      contentType: "image/png",
    });
  });
});
