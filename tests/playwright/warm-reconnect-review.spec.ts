import { expect, test, type Page } from "@playwright/test";

const LOCAL_FIREBASE_API_KEY = "playwright-local-api-key";
const LOCAL_AUTH_STORAGE_KEY =
  `firebase:authUser:${LOCAL_FIREBASE_API_KEY}:[DEFAULT]`;
const ARTWORK_URL =
  "/media/warm-reconnect/glass-braider-black-d53693963446e74b.webp";
const CTA_LABEL = "Choose what you’d like to hear about";

const registrySummary = {
  schemaVersion: 1,
  sourceOfTruth: "firestore_portfolio_registry",
  dataClassification: "aggregate_only",
  readOnly: true,
  registry: { accessRole: "owner" },
  totals: {
    people: 1_830,
    contactPoints: 2_097,
    emailContactPoints: 403,
    phoneContactPoints: 1_694,
    sourceRecords: 1_915,
    openConflicts: 0,
  },
  brands: {
    rosser_gallery: 120,
    rt_solutions: 1,
    kgclassy: 0,
    unassigned: 1_709,
  },
  sources: {
    google_people: 1_687,
    google_sheets: 134,
    blinq_csv: 94,
    other: 0,
  },
  permissions: {
    contactPointStates: {
      unknown: 2_097,
      opted_in: 0,
      opted_out: 0,
      reconfirm_required: 0,
      transactional_only: 0,
      other: 0,
    },
    sourceRecordsWithNoPermissionBasis: 1_915,
    permissionEvents: 0,
    suppressions: 0,
  },
  outreach: {
    status: "blocked",
    eligibleContacts: 0,
    reasons: ["No canonical permission events are recorded."],
  },
  freshness: {
    peopleUpdatedAt: "2026-07-21T23:04:01.000Z",
    contactPointsUpdatedAt: "2026-07-21T23:04:04.000Z",
    sourceRecordsUpdatedAt: "2026-07-21T23:04:03.000Z",
    latestUpdatedAt: "2026-07-21T23:04:04.000Z",
    observedAt: "2026-08-12T15:00:00.000Z",
  },
} as const;

const copy = {
  subject: "A quick hello from Marcus",
  alternateSubject: "Would you like to stay in touch?",
  preheader:
    "A personal note, and an easy way to choose what you’d like to hear about.",
  greeting: "Hi {{first_name | there}},",
  paragraphs: [
    "I’m reaching out personally because our paths crossed at some point through my art, business, or community work here in New Orleans. I’m bringing those relationships together more thoughtfully, and I wanted to ask before I send you anything else.",
    "If you’d like to stay connected, you’ll be able to choose what you want to hear about. That could be new work and events from Rosser Gallery, practical technology and business updates from RT.Solutions, or an occasional personal note from me.",
  ],
  postCtaParagraphs: [
    "If now isn’t the right time, no pressure. I’ll respect that.",
    "Thank you for being part of my story in some way. I’m grateful our paths crossed.",
  ],
  signature: ["Marcus Rosser", "New Orleans, Louisiana"],
} as const;

const campaignReview = {
  schemaVersion: "crm.warm-reconnect-review.v1",
  dataClassification: "aggregate_only",
  readOnly: true,
  registrySummary,
  campaign: {
    schemaVersion: 1,
    campaignId: "marcus-warm-reconnect",
    campaignVersion: "2026-08-12.1",
    state: "review_only",
    owner: {
      senderName: "Marcus Rosser",
      brands: ["Marcus Rosser", "Rosser Gallery", "RT.Solutions"],
    },
    intent: "warm_reconnect_preferences_invitation",
    source: {
      schemaVersion: 1,
      sourceOfTruth: "firestore_portfolio_registry",
      dataClassification: "aggregate_only",
      observedAt: "2026-08-12T15:00:00.000Z",
    },
    audience: {
      people: 1_830,
      unassignedPeople: 1_709,
      emailContactPoints: 403,
      heldEmailContactPoints: 403,
      unknownEmailContactPointsHeld: 403,
      unknownEmailCountIsExact: true,
      sourceRecordsWithNoPermissionBasis: 1_915,
      eligibleContacts: 0,
      eligibilityComputation: "not_available_in_review_only",
      posture: "held_for_permission_and_provenance_review",
    },
    channels: {
      email: "preview_only",
      sms: "blocked",
      calls: "blocked",
      social: "blocked",
    },
    copy: {
      ...copy,
      plainText: [
        copy.greeting,
        ...copy.paragraphs,
        `${CTA_LABEL}\n{{verified_preferences_url}}`,
        ...copy.postCtaParagraphs,
        copy.signature.join("\n"),
      ].join("\n\n"),
    },
    primaryCta: {
      label: CTA_LABEL,
      purpose: "preferences_and_unsubscribe",
      state: "missing",
      enabled: false,
      href: null,
      placeholder: "{{verified_preferences_url}}",
      requirement:
        "Verify a public HTTPS endpoint that saves preferences and accepts immediate unsubscribe requests before activation.",
    },
    artwork: {
      usage: "review_preview_only",
      emailChannelApproval: "missing",
      url: ARTWORK_URL,
      sha256:
        "sha256:d53693963446e74b53ee9d2a4eb617ba251bf3cfe73b686922f2a2f10ebf2ed4",
      sourceRepository: "https://github.com/mrrosser/RNGwebsite",
      sourceAssetPath: "public/art/glass-braider-black-1280.webp",
      sourceAssetCommit: "ba574e78afb280391c93c1ab6d796863c746ec62",
      sourceArtworkPath: "public/art/glass-braider-black.jpg",
      sourceArtworkSha256:
        "sha256:f680db88a56b7b5c80808aaf153577ea431512a5c0e149878054fdbe66a0c243",
      sourceManifestPath: "src/content/mediaManifest.ts",
      rightsApprovalPath: "docs/campaigns/the-braider-atlanta/media-approval.md",
      rightsEvidenceCommit: "69f3e2c255ed988754f866bb645bb7ed0a11e656",
      alt: "Black two-figure braiding sculpture by Marcus Rosser on a reflective glass surface.",
    },
    structuredPreview: {
      renderer: "component_only",
      rawHtml: false,
      scripts: "none",
      forms: "none",
      tracking: "none",
      remoteContent: "none",
      contentOrder: [
        "preheader",
        "greeting",
        "body",
        "primary_cta",
        "post_cta",
        "signature",
      ],
    },
    activation: {
      status: "blocked",
      gates: [
        ["sender_legal_identity", "Sender legal identity"],
        ["physical_postal_address", "Physical postal address"],
        ["preferences_unsubscribe_endpoint", "Preferences and unsubscribe endpoint"],
        ["suppression_ledger", "Suppression ledger"],
        ["spf_dkim_dmarc", "SPF, DKIM, and DMARC"],
        ["monitored_reply_to", "Monitored reply-to"],
        ["audience_provenance", "Audience provenance"],
        ["artwork_email_channel_approval", "Artwork email-channel approval"],
      ].map(([id, label]) => ({
        id,
        label,
        status: "missing",
        requirement: `${label} must be verified before activation.`,
        evidenceRef: null,
      })),
    },
    authority: {
      mode: "review_only",
      externalSideEffects: false,
      recipientData: "aggregate_only",
      allowedActions: ["render_review_preview", "inspect_preview_copy"],
      excludedActions: [
        "email_send",
        "email_provider_draft_create",
        "sms_send",
        "phone_call",
        "social_profile_lookup",
        "social_direct_message",
        "recipient_enrichment",
        "recipient_export",
      ],
    },
    review: {
      reviewRoundId: "marcus-warm-reconnect:2026-08-12.1:round-1",
      decisionId: null,
      previewFingerprint:
        "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      fingerprintAuthority: "none",
      approvalScope: "review_preview_only",
      excludedScope: [
        "email_send",
        "email_provider_draft_create",
        "sms_send",
        "phone_call",
        "social_profile_lookup",
        "social_direct_message",
        "recipient_enrichment",
        "recipient_export",
      ],
      materialDriftPredicate: "Any material campaign change requires a new review.",
    },
  },
};

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
      sub: "playwright-warm-reconnect",
      user_id: "playwright-warm-reconnect",
    }),
    "local-playwright-signature",
  ].join(".");
}

async function seedLocalFirebaseUser(page: Page): Promise<void> {
  const now = Date.now();
  const user = {
    uid: "playwright-warm-reconnect",
    email: "warm-reconnect@playwright.local",
    emailVerified: true,
    displayName: "Warm Reconnect Audit",
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

test.describe("local mocked warm reconnect review", () => {
  test.describe.configure({ mode: "serial", timeout: 90_000 });
  test.skip(
    Boolean(process.env.PLAYWRIGHT_BASE_URL),
    "This authenticated fixture is local-only and must never run against a deployed service.",
  );

  for (const viewport of [
    { name: "desktop", width: 1440, height: 1000 },
    { name: "pixel", width: 412, height: 915 },
  ]) {
    test(`${viewport.name} keeps the campaign visual and inert`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });

      const unexpectedApiRequests: string[] = [];
      const unexpectedExternalRequests: string[] = [];
      const blockedFirebaseInfrastructureRequests: string[] = [];
      const mutationRequests: string[] = [];
      const localArtworkRequests: string[] = [];
      const externalArtworkRequests: string[] = [];
      let releaseReviewResponse: () => void = () => undefined;
      const reviewResponseHeld = new Promise<void>((resolve) => {
        releaseReviewResponse = resolve;
      });

      await page.route("**/api/**", async (route) => {
        unexpectedApiRequests.push(
          `${route.request().method()} ${new URL(route.request().url()).pathname}`,
        );
        await route.fulfill({
          status: 418,
          contentType: "application/json",
          body: '{"error":"Unexpected local API request blocked by Playwright"}',
        });
      });
      await page.route("**/*", async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        const localHost = url.hostname === "localhost" || url.hostname === "127.0.0.1";

        if (!localHost && (url.protocol === "http:" || url.protocol === "https:")) {
          if (
            url.hostname === "identitytoolkit.googleapis.com" ||
            url.hostname === "securetoken.googleapis.com" ||
            url.hostname === "firestore.googleapis.com" ||
            (url.hostname === "www.google.com" && url.pathname === "/images/cleardot.gif")
          ) {
            blockedFirebaseInfrastructureRequests.push(
              `${request.method()} ${url.origin}${url.pathname}`,
            );
            await route.abort("blockedbyclient");
            return;
          }
          unexpectedExternalRequests.push(`${request.method()} ${url.origin}${url.pathname}`);
          await route.abort("blockedbyclient");
          return;
        }
        await route.continue();
      });
      await page.route("**/api/telemetry/error", (route) =>
        route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' }),
      );
      await page.route("**/api/revenue/daily-outcomes", (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            asOf: "2026-08-12T15:00:00.000Z",
            timeZone: "America/Chicago",
            outcomes: [],
          }),
        }),
      );
      await page.route("**/api/crm/customers?limit=200", (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            sourceOfTruth: "firestore_projected",
            customers: [],
          }),
        }),
      );
      await page.route("**/api/crm/warm-reconnect/review", async (route) => {
        await reviewResponseHeld;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          headers: {
            "Cache-Control": "private, no-store, max-age=0",
            "x-correlation-id": "playwright-warm-reconnect",
          },
          body: JSON.stringify(campaignReview),
        });
      });

      page.on("request", (request) => {
        const url = new URL(request.url());
        if (url.pathname.includes("glass-braider-black")) {
          const isLocalArtwork =
            url.hostname === "localhost" || url.hostname === "127.0.0.1";
          (isLocalArtwork ? localArtworkRequests : externalArtworkRequests).push(
            `${request.method()} ${url.origin}${url.pathname}`,
          );
        }
        if (
          url.pathname.startsWith("/api/") &&
          url.pathname !== "/api/telemetry/error" &&
          request.method() !== "GET"
        ) {
          mutationRequests.push(`${request.method()} ${url.pathname}`);
        }
      });

      await seedLocalFirebaseUser(page);
      await page.goto("/dashboard/crm", { waitUntil: "domcontentloaded" });

      const loadingReview = page.getByTestId("warm-reconnect-campaign");
      await expect(
        loadingReview.getByRole("heading", {
          name: "Building the read-only campaign preview…",
        }),
      ).toBeVisible();
      releaseReviewResponse();

      const review = page.getByTestId("warm-reconnect-campaign");
      await expect(review).toBeVisible();
      await expect(
        review.getByRole("heading", { name: "A thoughtful way back into the conversation" }),
      ).toBeVisible();
      await expect(review.getByText("Warm reconnect · concept review")).toBeVisible();
      await expect(review.getByText("No contacts selected · nothing drafted or sent")).toBeVisible();
      await expect(review.getByText("Activation blocked", { exact: true })).toBeVisible();
      await expect(review.getByText("Eligible recipients")).toBeVisible();
      await expect(review.getByText("0", { exact: true })).toBeVisible();

      await expect(review.getByText(copy.subject, { exact: true })).toBeVisible();
      await expect(review.getByText(copy.preheader, { exact: true })).toBeVisible();
      await expect(review.getByText(copy.greeting, { exact: true })).toBeVisible();
      for (const paragraph of [...copy.paragraphs, ...copy.postCtaParagraphs]) {
        await expect(review.getByText(paragraph, { exact: true })).toBeVisible();
      }

      const disabledCta = review.getByRole("button", {
        name: `${CTA_LABEL} · preference link required`,
      });
      await expect(disabledCta).toBeVisible();
      await expect(disabledCta).toBeDisabled();
      await expect(review.getByRole("button")).toHaveCount(1);
      await expect(review.getByRole("link")).toHaveCount(0);
      await expect(review.locator("form")).toHaveCount(0);
      await expect(
        review.getByRole("button", {
          name: /send|submit|approve|create.*draft|select.*recipient/i,
        }),
      ).toHaveCount(0);

      const artwork = review.locator(`img[src="${ARTWORK_URL}"]`);
      await expect(artwork).toBeVisible();
      await expect(artwork).toHaveAttribute("alt", "");
      await expect(artwork).toHaveAttribute("aria-hidden", "true");
      await expect
        .poll(() => artwork.evaluate((element) => (element as HTMLImageElement).naturalWidth))
        .toBeGreaterThan(0);
      await expect(
        review.getByText(
          "Black two-figure braiding sculpture by Marcus Rosser on a reflective glass surface.",
          { exact: true },
        ),
      ).toBeVisible();

      const layout = await page.evaluate(() => ({
        bodyOverflow: document.body.scrollWidth - document.body.clientWidth,
        documentOverflow:
          document.documentElement.scrollWidth - document.documentElement.clientWidth,
      }));
      expect(layout.bodyOverflow).toBeLessThanOrEqual(1);
      expect(layout.documentOverflow).toBeLessThanOrEqual(1);

      const reviewBox = await review.boundingBox();
      expect(reviewBox).not.toBeNull();
      expect(reviewBox?.x ?? -1).toBeGreaterThanOrEqual(0);
      expect((reviewBox?.x ?? 0) + (reviewBox?.width ?? 0)).toBeLessThanOrEqual(
        viewport.width + 1,
      );

      expect(mutationRequests).toEqual([]);
      expect(unexpectedApiRequests).toEqual([]);
      expect(unexpectedExternalRequests).toEqual([]);
      expect(localArtworkRequests).toEqual([
        `GET ${new URL(page.url()).origin}${ARTWORK_URL}`,
      ]);
      expect(externalArtworkRequests).toEqual([]);
      expect(
        blockedFirebaseInfrastructureRequests.every((request) =>
          /identitytoolkit|securetoken|firestore|cleardot/.test(request),
        ),
      ).toBe(true);

      await testInfo.attach(`warm-reconnect-${viewport.name}`, {
        body: await page.screenshot({
          fullPage: true,
          style: "nextjs-portal { display: none !important; }",
        }),
        contentType: "image/png",
      });
    });
  }
});
