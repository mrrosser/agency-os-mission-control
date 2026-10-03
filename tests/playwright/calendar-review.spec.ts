import { expect, test, type Page, type Route } from "@playwright/test";
import type {
  CalendarChoicesResponse,
  CalendarEventDraft,
  CalendarEventReview,
  CalendarWorkProfileId,
} from "../../lib/calendar/event-contract";

const API_KEY = "playwright-local-api-key";
const UID = "playwright-calendar-review";
const EMAIL = "calendar-review@example.test";
const REQUEST_ID = "a".repeat(64);
const FINGERPRINT = "b".repeat(64);
const APPROVAL_LABEL = "I approve creating this exact event and sending the listed invitations.";
const RT_CALENDAR = "rt-calendar@example.test";
const GALLERY_CALENDAR = "gallery-calendar@example.test";

function choices(profileId: CalendarWorkProfileId): CalendarChoicesResponse {
  const isRt = profileId === "rt_solutions_work";
  return {
    profileId,
    accountEmail: isRt ? "rt-owner@example.test" : "gallery-owner@example.test",
    identityVerified: true,
    canWriteEvents: true,
    calendars: [{
      id: isRt ? RT_CALENDAR : GALLERY_CALENDAR,
      summary: isRt ? "Synthetic RT calendar" : "Synthetic Gallery calendar",
      timeZone: "America/Chicago",
      accessRole: "owner",
      primary: true,
      canCreateEvents: true,
    }],
  };
}

function review(status: CalendarEventReview["status"] = "awaiting_approval"): CalendarEventReview {
  return {
    requestId: REQUEST_ID,
    fingerprint: FINGERPRINT,
    status,
    createdAt: new Date(Date.now() - 2000).toISOString(),
    expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
    accountEmail: "rt-owner@example.test",
    calendar: choices("rt_solutions_work").calendars[0],
    event: {
      profileId: "rt_solutions_work",
      calendarId: RT_CALENDAR,
      summary: "Server-reviewed synthetic event",
      startLocal: "2099-04-06T10:00",
      endLocal: "2099-04-06T10:45",
      startDateTime: "2099-04-06T15:00:00.000Z",
      endDateTime: "2099-04-06T15:45:00.000Z",
      timeZone: "America/Chicago",
      attendees: ["guest.one@example.test", "guest.two@example.test"],
      location: "Synthetic review room",
      description: "Synthetic description from the immutable server review.",
      sendUpdates: "all",
    },
    availability: { available: true, checkedAt: new Date().toISOString() },
    approvedAt: status === "awaiting_approval" ? null : new Date(Date.now() - 1000).toISOString(),
    receipt: null,
    error: status === "unknown" ? "The provider result is unknown. Check this request before trying anything else." : null,
  };
}

function localIdToken(provider: string, fresh = false, uid = UID, email = EMAIL): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  return [encode({ alg: "none", typ: "JWT" }), encode({
    aud: "playwright-local",
    auth_time: fresh ? now : now - 3600,
    exp: now + 3600,
    iat: now,
    sub: uid,
    user_id: uid,
    email,
    email_verified: true,
    firebase: { sign_in_provider: provider },
  }), "synthetic-playwright-signature"].join(".");
}

async function persistUser(page: Page, provider: string, uid = UID, email = EMAIL): Promise<void> {
  const now = Date.now();
  const user = {
    uid,
    email,
    emailVerified: true,
    displayName: "Synthetic Calendar Reviewer",
    isAnonymous: false,
    // A linked password provider must not authorize a current custom/phone login.
    providerData: [{ providerId: "password", uid: email, displayName: null, email, phoneNumber: null, photoURL: null }],
    stsTokenManager: {
      refreshToken: "synthetic-local-refresh-token",
      accessToken: localIdToken(provider, false, uid, email),
      expirationTime: now + 3600_000,
    },
    createdAt: String(now),
    lastLoginAt: String(now),
    apiKey: API_KEY,
    appName: "[DEFAULT]",
  };
  await page.evaluate(async ({ persistedUser, key }) => {
    localStorage.setItem(key, JSON.stringify(persistedUser));
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
        transaction.objectStore("firebaseLocalStorage").put({ fbase_key: key, value: persistedUser });
        transaction.oncomplete = () => { db.close(); resolve(); };
        transaction.onerror = () => { db.close(); reject(transaction.error); };
      };
    });
  }, { persistedUser: user, key: `firebase:authUser:${API_KEY}:[DEFAULT]` });
}

async function seedUser(page: Page, provider: string): Promise<void> {
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await persistUser(page, provider);
}

type ApiCall = { method: string; path: string; body: Record<string, unknown> | null };
type FixtureOptions = {
  provider?: string;
  initialReview?: CalendarEventReview;
  holdChoicesFor?: CalendarWorkProfileId;
  holdAgendaFor?: CalendarWorkProfileId;
  loseApprovalResponse?: boolean;
  holdOtherOwnerRead?: boolean;
};

async function mockCalendar(page: Page, baseURL: string, options: FixtureOptions = {}) {
  const origin = new URL(baseURL).origin;
  expect(["127.0.0.1", "localhost"]).toContain(new URL(origin).hostname);
  const state = {
    calls: [] as ApiCall[],
    unexpectedApi: [] as string[],
    unexpectedExternal: [] as string[],
    blockedInfrastructure: [] as string[],
    passwordReauths: 0,
    staleChoicesDelivered: false,
    staleAgendaDelivered: false,
    requestOwners: [] as string[],
    review: options.initialReview || review(),
  };
  let releaseChoices!: () => void;
  let releaseAgenda!: () => void;
  let releaseOtherOwner!: () => void;
  const heldChoices = new Promise<void>((resolve) => { releaseChoices = resolve; });
  const heldAgenda = new Promise<void>((resolve) => { releaseAgenda = resolve; });
  const heldOtherOwner = new Promise<void>((resolve) => { releaseOtherOwner = resolve; });
  const json = (route: Route, body: unknown, status = 200) => route.fulfill({
    status, contentType: "application/json", headers: { "Cache-Control": "no-store", "Access-Control-Allow-Origin": origin }, body: JSON.stringify(body),
  });

  // Mark response-body consumption (or an aborted request) in the browser,
  // rather than treating mock fulfilment as proof that React received it.
  await page.addInitScript(() => {
    const fixtureWindow = window as typeof window & { __calendarConsumed?: string[] };
    fixtureWindow.__calendarConsumed = [];
    const nativeFetch = window.fetch.bind(window);
    window.fetch = async (...args: Parameters<typeof fetch>) => {
      const input = args[0];
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, window.location.href);
      const isCalendarRead = url.pathname === "/api/calendar/calendars" || url.pathname === "/api/calendar/events";
      const body = isCalendarRead && typeof args[1]?.body === "string" ? JSON.parse(args[1].body) : null;
      const profile = url.searchParams.get("profileId") || body?.profileId || "";
      let response: Response;
      try { response = await nativeFetch(...args); }
      catch (error) {
        if (isCalendarRead) fixtureWindow.__calendarConsumed!.push(`${url.pathname}:${profile}`);
        throw error;
      }
      if (isCalendarRead) {
        const nativeText = response.text.bind(response);
        const nativeJson = response.json.bind(response);
        response.text = async () => {
          const value = await nativeText();
          fixtureWindow.__calendarConsumed!.push(`${url.pathname}:${profile}`);
          return value;
        };
        response.json = async () => {
          const value = await nativeJson();
          fixtureWindow.__calendarConsumed!.push(`${url.pathname}:${profile}`);
          return value;
        };
      }
      return response;
    };
  });

  // Context routing also covers popup pages. Every application API is mocked;
  // unknown APIs and every non-local destination are blocked before networking.
  await page.context().route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== origin) {
      if (["identitytoolkit.googleapis.com", "securetoken.googleapis.com"].includes(url.hostname) && request.method() === "OPTIONS") {
        return route.fulfill({ status: 204, headers: { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "POST", "Access-Control-Allow-Headers": "*" } });
      }
      if (url.hostname === "identitytoolkit.googleapis.com" && url.pathname.endsWith("/accounts:signInWithPassword") && options.provider === "password") {
        const body = request.postDataJSON();
        expect(body.email).toBe(EMAIL);
        expect(body.password).toBe("synthetic-password-only");
        state.passwordReauths++;
        return json(route, { localId: UID, email: EMAIL, idToken: localIdToken("password", true), refreshToken: "synthetic-local-refresh-token", expiresIn: "3600", registered: true });
      }
      if (url.hostname === "identitytoolkit.googleapis.com" && url.pathname.endsWith("/accounts:lookup") && state.passwordReauths > 0) {
        return json(route, { users: [{
          localId: UID, email: EMAIL, emailVerified: true,
          providerUserInfo: [{ providerId: "password", rawId: EMAIL, email: EMAIL }],
          createdAt: String(Date.now() - 3600_000), lastLoginAt: String(Date.now()),
        }] });
      }
      if (url.hostname === "securetoken.googleapis.com" && state.passwordReauths > 0) {
        return json(route, { access_token: localIdToken("password", true), id_token: localIdToken("password", true), refresh_token: "synthetic-local-refresh-token", expires_in: "3600", token_type: "Bearer", user_id: UID, project_id: "playwright-local" });
      }
      const label = `${request.method()} ${url.origin}${url.pathname}`;
      if (["identitytoolkit.googleapis.com", "securetoken.googleapis.com", "firestore.googleapis.com"].includes(url.hostname) || (url.hostname === "www.google.com" && url.pathname === "/images/cleardot.gif")) {
        state.blockedInfrastructure.push(label);
      } else {
        state.unexpectedExternal.push(label);
      }
      return route.abort("blockedbyclient");
    }
    if (!url.pathname.startsWith("/api/")) return route.continue();
    if (url.pathname === "/api/telemetry/error") return json(route, { ok: true });
    if (url.pathname === "/api/revenue/daily-outcomes") return json(route, { asOf: new Date().toISOString(), timeZone: "America/Chicago", outcomes: [] });
    const body = request.postData() ? request.postDataJSON() as Record<string, unknown> : null;
    state.calls.push({ method: request.method(), path: `${url.pathname}${url.search}`, body });
    if (url.pathname === "/api/calendar/calendars" && request.method() === "GET") {
      const profileId = url.searchParams.get("profileId") as CalendarWorkProfileId;
      expect(["rt_solutions_work", "rosser_gallery_work"]).toContain(profileId);
      if (profileId === options.holdChoicesFor) {
        await heldChoices;
        await json(route, choices(profileId));
        state.staleChoicesDelivered = true;
        return;
      }
      return json(route, choices(profileId));
    }
    if (url.pathname === "/api/calendar/events" && url.search === "?action=list" && request.method() === "POST") {
      const profileId = body?.profileId as CalendarWorkProfileId;
      expect(body?.calendarId).toBe(choices(profileId).calendars[0].id);
      if (profileId === options.holdAgendaFor) await heldAgenda;
      await json(route, { events: [{
        id: `${profileId}-event`,
        summary: profileId === "rt_solutions_work" ? "RT-only synthetic agenda" : "Gallery-only synthetic agenda",
        start: { dateTime: "2099-04-06T13:00:00.000Z" },
        end: { dateTime: "2099-04-06T13:30:00.000Z" },
      }] });
      if (profileId === options.holdAgendaFor) state.staleAgendaDelivered = true;
      return;
    }
    if (url.pathname === "/api/calendar/requests" && request.method() === "POST") return json(route, { request: state.review });
    if (url.pathname === `/api/calendar/requests/${REQUEST_ID}` && request.method() === "GET") {
      const claims = JSON.parse(Buffer.from(request.headers().authorization.split(".")[1], "base64url").toString());
      state.requestOwners.push(claims.sub);
      if (options.holdOtherOwnerRead && claims.sub !== UID) {
        await heldOtherOwner;
        return json(route, { error: "Request not found for this account." }, 404);
      }
      return json(route, { request: state.review });
    }
    if (url.pathname === `/api/calendar/requests/${REQUEST_ID}/approve` && request.method() === "POST") {
      expect(body).toEqual({ fingerprint: FINGERPRINT, approved: true });
      expect(state.passwordReauths).toBe(1);
      const claims = JSON.parse(Buffer.from(request.headers().authorization.split(".")[1], "base64url").toString());
      expect(claims.firebase.sign_in_provider).toBe("password");
      expect(claims.auth_time * 1000).toBeGreaterThanOrEqual(Date.parse(state.review.createdAt));
      state.review = { ...state.review, status: "approved", approvedAt: new Date().toISOString() };
      if (options.loseApprovalResponse) return route.abort("failed");
      return json(route, { request: state.review });
    }
    if (url.pathname === `/api/calendar/requests/${REQUEST_ID}/execute` && request.method() === "POST") {
      expect(body).toEqual({ fingerprint: FINGERPRINT });
      expect(state.review.status).toBe("approved");
      state.review = { ...state.review, status: "unknown", error: "The provider outcome is unknown; reconcile this request." };
      return json(route, { request: state.review });
    }
    if (url.pathname === `/api/calendar/requests/${REQUEST_ID}/reconcile` && request.method() === "POST") {
      expect(body).toEqual({ fingerprint: FINGERPRINT });
      state.review = { ...state.review, status: "completed", error: null, receipt: {
        eventId: "synthetic-calendar-event", htmlLink: "https://calendar.google.com/calendar/event?eid=synthetic",
        createdAt: new Date().toISOString(), reconciled: true, sendUpdates: "all",
      } };
      return json(route, { request: state.review });
    }
    state.unexpectedApi.push(`${request.method()} ${url.pathname}${url.search}`);
    return json(route, { error: "Unexpected API blocked by the local calendar fixture" }, 418);
  });
  await page.context().routeWebSocket("**", (socket) => socket.close());
  return { state, releaseChoices, releaseAgenda, releaseOtherOwner };
}

async function openCalendar(page: Page, provider = "custom", requestId?: string) {
  await seedUser(page, provider);
  await page.goto(`/dashboard/calendar${requestId ? `?request=${requestId}` : ""}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Calendar", exact: true })).toBeVisible();
  const tour = page.getByTestId("first-scan-tour");
  if (await tour.isVisible().catch(() => false)) await tour.getByTitle("Dismiss").click();
}

async function prepareReview(page: Page) {
  await page.getByLabel("Google work profile", { exact: true }).selectOption("rt_solutions_work");
  await page.getByLabel("Calendar", { exact: true }).selectOption(RT_CALENDAR);
  await page.getByRole("button", { name: "Create Event", exact: true }).click();
  await page.getByLabel("Title", { exact: true }).fill("Synthetic proposal before server review");
  await page.getByLabel("Start", { exact: true }).fill("2099-04-06T10:00");
  await page.getByLabel("End", { exact: true }).fill("2099-04-06T10:45");
  await page.getByLabel("Timezone", { exact: true }).fill("America/Chicago");
  await page.getByLabel("Guests", { exact: true }).fill("guest.two@example.test,\nguest.one@example.test");
  await page.getByLabel("Location", { exact: true }).fill("Synthetic proposal room");
  await page.getByLabel("Description", { exact: true }).fill("Synthetic proposal description");
  await page.getByRole("button", { name: "Prepare review", exact: true }).click();
  await expect(page.getByTestId("calendar-event-review")).toBeVisible();
}

function assertIsolated(state: Awaited<ReturnType<typeof mockCalendar>>["state"]) {
  expect(state.unexpectedApi).toEqual([]);
  expect(state.unexpectedExternal).toEqual([]);
}

test.describe("local mocked calendar approval workflow", () => {
  test.describe.configure({ mode: "serial", timeout: 90_000 });
  test.skip(Boolean(process.env.PLAYWRIGHT_BASE_URL), "Synthetic authentication must never run against a deployed service.");

  test("requires explicit selections and prepares an immutable review without creating an event", async ({ page, baseURL }) => {
    const { state } = await mockCalendar(page, baseURL!, { provider: "password" });
    await openCalendar(page, "password");
    await expect(page.getByLabel("Google work profile", { exact: true })).toHaveValue("");
    await expect(page.getByRole("button", { name: "Create Event", exact: true })).toBeDisabled();
    expect(state.calls).toEqual([]);
    await prepareReview(page);
    const immutableReview = page.getByTestId("calendar-event-review");
    for (const text of [state.review.event.summary, state.review.accountEmail, state.review.calendar.summary, state.review.calendar.id, state.review.event.timeZone, state.review.event.startLocal, state.review.event.endLocal, state.review.event.startDateTime, state.review.event.endDateTime, state.review.event.location, state.review.event.description, ...state.review.event.attendees]) {
      await expect(immutableReview).toContainText(text);
    }
    for (const label of ["Title", "Start", "End", "Timezone", "Guests", "Location", "Description"]) {
      await expect(immutableReview.getByLabel(label, { exact: true })).toHaveCount(0);
    }
    await expect(page.getByLabel(APPROVAL_LABEL, { exact: true })).not.toBeChecked();
    await expect(page.getByLabel(APPROVAL_LABEL, { exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Approve and create event", exact: true })).toBeDisabled();
    await expect(page.getByRole("link", { name: "Revise event details", exact: true })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`\\?request=${REQUEST_ID}$`));
    const prepared = state.calls.filter((call) => call.path === "/api/calendar/requests");
    expect(prepared).toHaveLength(1);
    expect(prepared[0].body).toMatchObject({
      profileId: "rt_solutions_work", calendarId: RT_CALENDAR,
      startLocal: "2099-04-06T10:00", endLocal: "2099-04-06T10:45", timeZone: "America/Chicago", sendUpdates: "all",
    } satisfies Partial<CalendarEventDraft>);
    expect(state.calls.some((call) => /\/(approve|execute|reconcile)$/.test(call.path))).toBe(false);
    expect(state.passwordReauths).toBe(0);
    assertIsolated(state);
  });

  test("treats a draft handoff as optional form details without selecting an account or taking an action", async ({ page, baseURL }) => {
    const { state } = await mockCalendar(page, baseURL!);
    await seedUser(page, "custom");
    const handoff: CalendarEventDraft = {
      profileId: "rt_solutions_work", calendarId: RT_CALENDAR,
      summary: "Synthetic handoff event", startLocal: "2099-04-06T10:00", endLocal: "2099-04-06T10:45",
      timeZone: "America/Chicago", attendees: ["draft.guest@example.test"],
      location: "Synthetic handoff room", description: "Draft details only; no authority.", sendUpdates: "all",
    };
    await page.goto(`/dashboard/calendar#draft=${encodeURIComponent(JSON.stringify(handoff))}`, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("button", { name: "Use draft details", exact: true })).toBeVisible();
    await expect(page.getByLabel("Google work profile", { exact: true })).toHaveValue("");
    await expect(page.getByRole("button", { name: "Create Event", exact: true })).toBeDisabled();
    expect(state.calls).toEqual([]);
    await page.getByRole("button", { name: "Use draft details", exact: true }).click();
    await expect(page.getByLabel("Google work profile", { exact: true })).toHaveValue("");
    expect(state.calls).toEqual([]);
    await page.getByLabel("Google work profile", { exact: true }).selectOption("rt_solutions_work");
    await page.getByLabel("Calendar", { exact: true }).selectOption(RT_CALENDAR);
    await page.getByRole("button", { name: "Create Event", exact: true }).click();
    await expect(page.getByLabel("Title", { exact: true })).toHaveValue(handoff.summary);
    await expect(page.getByLabel("Start", { exact: true })).toHaveValue(handoff.startLocal);
    await expect(page.getByLabel("End", { exact: true })).toHaveValue(handoff.endLocal);
    await expect(page.getByLabel("Guests", { exact: true })).toHaveValue("draft.guest@example.test");
    expect(state.calls.some((call) => call.path.startsWith("/api/calendar/requests"))).toBe(false);
    assertIsolated(state);
  });

  test("fills an already opened event form only after explicit draft acceptance", async ({ page, baseURL }) => {
    const { state } = await mockCalendar(page, baseURL!);
    await seedUser(page, "custom");
    const handoff: CalendarEventDraft = {
      profileId: "rosser_gallery_work", calendarId: GALLERY_CALENDAR,
      summary: "Explicitly accepted synthetic draft", startLocal: "2099-04-07T11:00", endLocal: "2099-04-07T11:45",
      timeZone: "America/Chicago", attendees: ["late.draft@example.test"],
      location: "Later handoff room", description: "Only copy these fields after acceptance.", sendUpdates: "all",
    };
    await page.goto(`/dashboard/calendar#draft=${encodeURIComponent(JSON.stringify(handoff))}`, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("button", { name: "Use draft details", exact: true })).toBeVisible();
    await page.getByLabel("Google work profile", { exact: true }).selectOption("rt_solutions_work");
    await page.getByLabel("Calendar", { exact: true }).selectOption(RT_CALENDAR);
    await page.getByRole("button", { name: "Create Event", exact: true }).click();
    await expect(page.getByLabel("Title", { exact: true })).toHaveValue("");
    await expect(page.getByLabel("Guests", { exact: true })).toHaveValue("");
    expect(state.calls.some((call) => call.path.startsWith("/api/calendar/requests"))).toBe(false);

    await page.getByRole("button", { name: "Use draft details", exact: true }).click();
    for (const [label, value] of [["Title", handoff.summary], ["Start", handoff.startLocal], ["End", handoff.endLocal], ["Timezone", handoff.timeZone], ["Guests", handoff.attendees.join(", ")], ["Location", handoff.location], ["Description", handoff.description]]) {
      await expect(page.getByLabel(label, { exact: true })).toHaveValue(value);
    }
    await expect(page.getByLabel("Google work profile", { exact: true })).toHaveValue("rt_solutions_work");
    await expect(page.getByLabel("Calendar", { exact: true })).toHaveValue(RT_CALENDAR);
    await expect(page.getByRole("button", { name: "Use draft details", exact: true })).toHaveCount(0);
    expect(state.calls.some((call) => call.path.startsWith("/api/calendar/requests"))).toBe(false);
    assertIsolated(state);
  });

  test("removes the previous account's private review before the new account's request lookup resolves", async ({ page, baseURL }) => {
    const { state, releaseOtherOwner } = await mockCalendar(page, baseURL!, { provider: "password", holdOtherOwnerRead: true });
    try {
      await openCalendar(page, "password");
      await prepareReview(page);
      await page.getByLabel("Current password", { exact: true }).fill("private-unsent-password");
      const privateTexts = [state.review.event.summary, state.review.event.location, state.review.event.description, state.review.accountEmail, state.review.calendar.id, ...state.review.event.attendees];
      for (const value of privateTexts) await expect(page.getByTestId("calendar-event-review")).toContainText(value);
      const callsBeforeSwitch = state.calls.length;
      const nextUid = "playwright-calendar-review-other-owner";
      // Update Firebase persistence while the page stays mounted, simulating an
      // account change in another tab without hiding stale state via navigation.
      await persistUser(page, "password", nextUid, "other-reviewer@example.test");
      await expect.poll(() => state.requestOwners.includes(nextUid), { timeout: 15_000 }).toBe(true);
      await expect(page.getByTestId("calendar-event-review")).toHaveCount(0);
      await expect(page.getByLabel("Current password", { exact: true })).toHaveCount(0);
      for (const value of privateTexts) await expect(page.locator("body")).not.toContainText(value);
      await expect(page.getByLabel("Google work profile", { exact: true })).toHaveValue("");
      await expect(page.getByLabel("Calendar", { exact: true })).toHaveValue("");

      releaseOtherOwner();
      await expect(page.getByRole("alert").filter({ hasText: "Request not found for this account." })).toBeVisible();
      await expect(page.getByTestId("calendar-event-review")).toHaveCount(0);
      for (const value of privateTexts) await expect(page.locator("body")).not.toContainText(value);
      expect(state.calls.slice(callsBeforeSwitch)).toEqual([
        { method: "GET", path: `/api/calendar/requests/${REQUEST_ID}`, body: null },
      ]);
      expect(state.passwordReauths).toBe(0);
      assertIsolated(state);
    } finally { releaseOtherOwner(); }
  });

  for (const provider of ["custom", "phone"]) {
    test(`blocks ${provider} approval even when a password provider is linked`, async ({ page, baseURL }) => {
      const { state } = await mockCalendar(page, baseURL!, { provider });
      await openCalendar(page, provider);
      await prepareReview(page);
      await expect(page.getByRole("button", { name: "Approve and create event", exact: true })).toBeDisabled();
      await expect(page.getByLabel("Current password", { exact: true })).toHaveCount(0);
      await expect(page.getByLabel(APPROVAL_LABEL, { exact: true })).not.toBeChecked();
      await expect(page.getByLabel(APPROVAL_LABEL, { exact: true })).toBeDisabled();
      await expect(page.getByTestId("calendar-event-review").getByRole("alert")).toContainText("This sign-in method cannot approve calendar events here.");
      await expect(page.getByRole("button", { name: "Verify your identity", exact: true })).toBeDisabled();
      expect(state.calls.some((call) => /\/(approve|execute)$/.test(call.path))).toBe(false);
      expect(state.passwordReauths).toBe(0);
      assertIsolated(state);
    });
  }

  test("ignores stale calendar choices after the work profile changes", async ({ page, baseURL }) => {
    const { state, releaseChoices } = await mockCalendar(page, baseURL!, { holdChoicesFor: "rt_solutions_work" });
    try {
      await openCalendar(page);
      await page.getByLabel("Google work profile", { exact: true }).selectOption("rt_solutions_work");
      await expect.poll(() => state.calls.some((call) => call.path.endsWith("profileId=rt_solutions_work"))).toBe(true);
      await page.getByLabel("Google work profile", { exact: true }).selectOption("rosser_gallery_work");
      await page.getByLabel("Calendar", { exact: true }).selectOption(GALLERY_CALENDAR);
      await expect(page.getByText("Gallery-only synthetic agenda", { exact: true })).toBeVisible();
      releaseChoices();
      await expect.poll(() => state.staleChoicesDelivered).toBe(true);
      await page.waitForFunction(() => (window as typeof window & { __calendarConsumed?: string[] }).__calendarConsumed?.includes("/api/calendar/calendars:rt_solutions_work"));
      await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      await expect(page.getByLabel("Google work profile", { exact: true })).toHaveValue("rosser_gallery_work");
      await expect(page.getByLabel("Calendar", { exact: true })).toHaveValue(GALLERY_CALENDAR);
      await expect(page.getByLabel("Calendar", { exact: true }).locator(`option[value="${RT_CALENDAR}"]`)).toHaveCount(0);
      expect(state.calls.filter((call) => call.path === "/api/calendar/events?action=list").every((call) => call.body?.profileId === "rosser_gallery_work")).toBe(true);
      assertIsolated(state);
    } finally { releaseChoices(); }
  });

  test("ignores an old agenda response after selecting another work profile", async ({ page, baseURL }) => {
    const { state, releaseAgenda } = await mockCalendar(page, baseURL!, { holdAgendaFor: "rt_solutions_work" });
    try {
      await openCalendar(page);
      await page.getByLabel("Google work profile", { exact: true }).selectOption("rt_solutions_work");
      await page.getByLabel("Calendar", { exact: true }).selectOption(RT_CALENDAR);
      await expect.poll(() => state.calls.some((call) => call.path === "/api/calendar/events?action=list")).toBe(true);
      await page.getByLabel("Google work profile", { exact: true }).selectOption("rosser_gallery_work");
      await page.getByLabel("Calendar", { exact: true }).selectOption(GALLERY_CALENDAR);
      await expect(page.getByText("Gallery-only synthetic agenda", { exact: true })).toBeVisible();
      releaseAgenda();
      await expect.poll(() => state.staleAgendaDelivered).toBe(true);
      await page.waitForFunction(() => (window as typeof window & { __calendarConsumed?: string[] }).__calendarConsumed?.includes("/api/calendar/events:rt_solutions_work"));
      await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      await expect(page.getByText("Gallery-only synthetic agenda", { exact: true })).toBeVisible();
      await expect(page.getByText("RT-only synthetic agenda", { exact: true })).toHaveCount(0);
      assertIsolated(state);
    } finally { releaseAgenda(); }
  });

  for (const status of ["unknown", "executing"] as const) {
    test(`recovers persisted ${status} requests using status and reconciliation only`, async ({ page, baseURL }) => {
      const { state } = await mockCalendar(page, baseURL!, { initialReview: review(status) });
      await openCalendar(page, "custom", REQUEST_ID);
      await expect(page.getByTestId("calendar-event-review")).toContainText(state.review.event.summary);
      await expect(page.getByRole("button", { name: "Approve and create event", exact: true })).toHaveCount(0);
      await expect(page.getByRole("link", { name: "Revise event details", exact: true })).toHaveCount(0);
      await page.getByRole("button", { name: "Check request status", exact: true }).click();
      await page.getByRole("button", { name: "Reconcile event status", exact: true }).click();
      await expect(page.getByTestId("calendar-event-review")).toContainText(/completed|created/i);
      expect(state.calls.filter((call) => call.method !== "GET")).toEqual([
        { method: "POST", path: `/api/calendar/requests/${REQUEST_ID}/reconcile`, body: { fingerprint: FINGERPRINT } },
      ]);
      expect(state.calls.filter((call) => call.path === `/api/calendar/requests/${REQUEST_ID}`)).toHaveLength(2);
      assertIsolated(state);
    });
  }

  test("requires unchecked consent before executing a recovered approved request and never approves it twice", async ({ page, baseURL }) => {
    const { state } = await mockCalendar(page, baseURL!, { provider: "password", initialReview: review("approved") });
    await openCalendar(page, "password", REQUEST_ID);
    const consent = page.getByLabel(APPROVAL_LABEL, { exact: true });
    const create = page.getByRole("button", { name: "Create approved event", exact: true });
    await expect(page.getByTestId("calendar-event-review")).toContainText(state.review.event.summary);
    await expect(consent).not.toBeChecked();
    await expect(create).toBeDisabled();
    expect(state.calls.filter((call) => call.method !== "GET")).toEqual([]);
    await consent.check();
    await create.click();
    await expect(page.getByRole("button", { name: "Reconcile event status", exact: true })).toBeVisible();
    expect(state.calls.filter((call) => call.method !== "GET")).toEqual([
      { method: "POST", path: `/api/calendar/requests/${REQUEST_ID}/execute`, body: { fingerprint: FINGERPRINT } },
    ]);
    expect(state.passwordReauths).toBe(0);
    assertIsolated(state);
  });

  test("requires fresh password verification and unchecked exact approval, then recovers an unknown result without repeating execution", async ({ page, baseURL }) => {
    const { state } = await mockCalendar(page, baseURL!, { provider: "password" });
    await openCalendar(page, "password");
    await prepareReview(page);
    const approval = page.getByLabel(APPROVAL_LABEL, { exact: true });
    const create = page.getByRole("button", { name: "Approve and create event", exact: true });
    await expect(create).toBeDisabled();
    await page.getByLabel("Current password", { exact: true }).fill("synthetic-password-only");
    await page.getByRole("button", { name: "Verify your identity", exact: true }).click();
    await expect.poll(() => state.passwordReauths).toBe(1);
    await expect(approval).not.toBeChecked();
    await expect(create).toBeDisabled();
    await approval.check();
    await expect(create).toBeEnabled();
    await create.click();
    await expect(page.getByRole("button", { name: "Reconcile event status", exact: true })).toBeVisible();
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("calendar-event-review")).toContainText(state.review.event.summary);
    await expect(page.getByRole("button", { name: "Approve and create event", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Reconcile event status", exact: true }).click();
    await expect(page.getByTestId("calendar-event-review")).toContainText(/completed|created/i);
    expect(state.calls.filter((call) => /\/(approve|execute|reconcile)$/.test(call.path)).map((call) => call.path)).toEqual([
      `/api/calendar/requests/${REQUEST_ID}/approve`,
      `/api/calendar/requests/${REQUEST_ID}/execute`,
      `/api/calendar/requests/${REQUEST_ID}/reconcile`,
    ]);
    assertIsolated(state);
  });

  test("recovers a lost approval response through GET without executing until fresh unchecked consent is given", async ({ page, baseURL }) => {
    const { state } = await mockCalendar(page, baseURL!, { provider: "password", loseApprovalResponse: true });
    await openCalendar(page, "password");
    await prepareReview(page);
    await page.getByLabel("Current password", { exact: true }).fill("synthetic-password-only");
    await page.getByRole("button", { name: "Verify your identity", exact: true }).click();
    const consent = page.getByLabel(APPROVAL_LABEL, { exact: true });
    await expect(consent).toBeEnabled();
    await expect(consent).not.toBeChecked();
    await consent.check();
    await page.getByRole("button", { name: "Approve and create event", exact: true }).click();
    await expect(page.getByRole("button", { name: "Reconcile event status", exact: true })).toBeVisible();
    expect(state.calls.filter((call) => call.path.endsWith("/approve"))).toHaveLength(1);
    expect(state.calls.filter((call) => call.path.endsWith("/execute"))).toHaveLength(0);

    await page.getByRole("button", { name: "Check request status", exact: true }).click();
    const createApproved = page.getByRole("button", { name: "Create approved event", exact: true });
    await expect(createApproved).toBeVisible();
    await expect(consent).not.toBeChecked();
    await expect(createApproved).toBeDisabled();
    expect(state.calls.filter((call) => call.path === `/api/calendar/requests/${REQUEST_ID}`)).toHaveLength(1);
    expect(state.calls.filter((call) => call.path.endsWith("/execute"))).toHaveLength(0);

    await consent.check();
    await createApproved.click();
    await expect(page.getByRole("button", { name: "Reconcile event status", exact: true })).toBeVisible();
    expect(state.calls.filter((call) => /\/(approve|execute)$/.test(call.path)).map((call) => call.path)).toEqual([
      `/api/calendar/requests/${REQUEST_ID}/approve`, `/api/calendar/requests/${REQUEST_ID}/execute`,
    ]);
    assertIsolated(state);
  });
});
