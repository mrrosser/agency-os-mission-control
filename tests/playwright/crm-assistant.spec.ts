import { expect, test, type Page } from "@playwright/test";

const key = "firebase:authUser:playwright-local-api-key:[DEFAULT]";
const capabilities = { textEnabled: true, voiceEnabled: true, toolsEnabled: true, provider: "openai", keyStatus: "checked_on_request", voiceMaxSeconds: 300 };

async function seedLocalUser(page: Page) {
  const now = Date.now();
  const encode = (data: unknown) => Buffer.from(JSON.stringify(data)).toString("base64url");
  const token = `${encode({ alg: "none", typ: "JWT" })}.${encode({ aud: "playwright-local", sub: "local-assistant-owner", user_id: "local-assistant-owner", iat: Math.floor(now / 1000), exp: Math.floor(now / 1000) + 3600, auth_time: Math.floor(now / 1000), firebase: { sign_in_provider: "custom" } })}.local-only-test-signature`;
  const persistedUser = { uid: "local-assistant-owner", email: "assistant@example.test", displayName: "Synthetic local operator", emailVerified: true, isAnonymous: false, providerData: [], stsTokenManager: { refreshToken: "local-only-refresh", accessToken: token, expirationTime: now + 3600000 }, createdAt: String(now), lastLoginAt: String(now), apiKey: "playwright-local-api-key", appName: "[DEFAULT]" };
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await page.evaluate(async ({ key, persistedUser }) => {
    localStorage.setItem(key, JSON.stringify(persistedUser));
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("firebaseLocalStorageDb", 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains("firebaseLocalStorage")) request.result.createObjectStore("firebaseLocalStorage", { keyPath: "fbase_key" });
      };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const transaction = db.transaction("firebaseLocalStorage", "readwrite");
        transaction.objectStore("firebaseLocalStorage").put({ fbase_key: key, value: persistedUser });
        transaction.oncomplete = () => { db.close(); resolve(); };
        transaction.onerror = () => reject(transaction.error);
      };
    });
  }, { key, persistedUser });
}

test.describe("local mocked CRM Assistant", () => {
  test.describe.configure({ mode: "serial", timeout: 120_000 });
  test.skip(Boolean(process.env.PLAYWRIGHT_BASE_URL), "Synthetic authentication is local-only; no deployed service may use this fixture.");
  for (const width of [1440, 390, 320]) {
    test(`${width}px typed drafts, voice cleanup and optional site tools`, async ({ page, baseURL }, testInfo) => {
      expect(new URL(baseURL!).hostname).toMatch(/^(localhost|127\.0\.0\.1)$/);
      await page.setViewportSize({ width, height: width > 768 ? 1000 : 844 });
      const errors: string[] = [];
      let health: Record<string, unknown> = { ...capabilities };
      const apiWrites: string[] = [];
      const assistantRequests: { path: string; body: unknown }[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.addInitScript(() => {
        const state = { microphoneStarts: 0, microphoneStops: 0, tools: new Map<string, unknown>(), permissionDenied: false };
        Object.assign(window, { __assistantTest: state });
        Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: {
          getUserMedia: async () => {
            state.microphoneStarts += 1;
            if (state.permissionDenied) throw new DOMException("Test permission denied", "NotAllowedError");
            const track = { enabled: true, onended: null, stop: () => { state.microphoneStops += 1; } };
            return { getTracks: () => [track], getAudioTracks: () => [track] };
          },
          enumerateDevices: async () => [{ kind: "audioinput", deviceId: "synthetic-mic", label: "Synthetic microphone" }],
        } });
        class LocalPeer {
          localDescription = { sdp: "v=0\r\nsynthetic-offer" };
          channel = { readyState: "open", onopen: null as (() => void) | null, close() {}, send() {} };
          addTrack() {} close() {} async createOffer() { return this.localDescription; }
          async setLocalDescription() {} async setRemoteDescription() { this.channel.onopen?.(); }
          createDataChannel() { return this.channel; }
        }
        Object.defineProperty(window, "RTCPeerConnection", { configurable: true, value: LocalPeer });
        Object.defineProperty(document, "modelContext", { configurable: true, value: {
          registerTool: async (tool: { name: string }, options: { signal: AbortSignal }) => {
            state.tools.set(tool.name, tool);
            options.signal.addEventListener("abort", () => state.tools.delete(tool.name), { once: true });
          },
        } });
      });
      await page.route("**/*", async (route) => {
        const request = route.request(); const url = new URL(request.url());
        if (url.origin !== new URL(baseURL!).origin) return route.abort("blockedbyclient");
        if (!url.pathname.startsWith("/api/")) return route.continue();
        const json = (data: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(data) });
        if (request.method() !== "GET") apiWrites.push(url.pathname);
        if (url.pathname === "/api/crm/assistant") return json(health);
        if (url.pathname.startsWith("/api/crm/assistant/")) {
          assistantRequests.push({ path: url.pathname, body: request.postDataJSON() });
          if (url.pathname.endsWith("/chat")) return json({ success: true, message: "Here is a synthetic survey draft for local interface testing. Nothing has been published.", correlationId: "local-assistant-test", cards: [{ id: "local-draft", kind: "draft", title: "Synthetic survey", body: "Test fixture only. Edit before any real use.", destination: "share", draft: { subject: "Synthetic survey title", body: "Which workshop would you like to try?\nThis is a local UI test fixture.", format: "survey" } }] });
          if (url.pathname.endsWith("/voice")) return json({ sdp: "v=0\r\nsynthetic-answer", sessionId: "00000000-0000-4000-8000-000000000001", maxSeconds: 300 });
          if (url.pathname.endsWith("/voice/stop")) { delete health.voiceSession; return json({ success: true }); }
          if (url.pathname.endsWith("/tools")) return json({ ok: true, summary: "Synthetic CRM totals; not production data.", cards: [{ id: "evidence", kind: "evidence", title: "Synthetic totals", body: "Test evidence only." }] });
          return json({ error: "Unexpected assistant route" }, 418);
        }
        if (url.pathname === "/api/crm/customers") return json({ sourceOfTruth: "firestore_projected", customers: [] });
        if (url.pathname === "/api/revenue/daily-outcomes") return json({ outcomes: [], asOf: "2026-09-08T12:00:00Z", timeZone: "America/Chicago" });
        if (url.pathname === "/api/telemetry/error") return json({ ok: true });
        return json({ error: "CRM provider data intentionally unavailable in local test" }, 503);
      });
      await seedLocalUser(page);
      await page.goto("/dashboard/crm", { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("heading", { name: "Your next conversation." })).toBeVisible({ timeout: 30_000 });
      const tour = page.getByTestId("first-scan-tour");
      if (await tour.isVisible().catch(() => false)) await tour.getByTitle("Dismiss").click();
      await page.getByRole("tab", { name: "Assistant", exact: true }).click();
      await expect(page.getByRole("heading", { name: "What are we working on?" })).toBeVisible();
      await expect(page.getByText("Available on request", { exact: true })).toBeVisible();
      const testState = () => page.evaluate(() => {
        const state = (window as unknown as { __assistantTest: { microphoneStarts: number; microphoneStops: number; tools: Map<string, unknown> } }).__assistantTest;
        return { microphoneStarts: state.microphoneStarts, microphoneStops: state.microphoneStops, tools: state.tools.size };
      });
      expect((await testState()).microphoneStarts).toBe(0);
      await page.getByRole("button", { name: "Survey", exact: false }).filter({ hasText: "Survey" }).first().click();
      await expect(page.getByRole("button", { name: "Send message" })).toBeDisabled();
      expect(assistantRequests).toHaveLength(0);
      await page.getByRole("checkbox", { name: /I understand AI requests/ }).check();
      await page.locator("#crm-assistant-heading").scrollIntoViewIfNeeded();
      await page.screenshot({ path: testInfo.outputPath(`crm-assistant-preview-${width}.png`) });
      await page.getByRole("button", { name: "Send message" }).click();
      await expect(page.getByLabel("Draft body", { exact: true })).toBeVisible();
      await page.getByLabel("Draft body", { exact: true }).fill("Locally edited synthetic survey.\nNo provider write.");
      await expect(page.getByText(/Edited locally/)).toBeVisible();
      const download = page.waitForEvent("download");
      await page.getByRole("button", { name: "Download .txt", exact: true }).click();
      expect((await download).suggestedFilename()).toContain("unsaved");
      const beforeRevision = assistantRequests.length;
      await page.getByRole("button", { name: "Revise with Assistant", exact: true }).click();
      await expect(page.getByLabel("Message the CRM Assistant", { exact: true })).toHaveValue(/Locally edited synthetic survey/);
      expect(assistantRequests).toHaveLength(beforeRevision);
      await page.getByRole("tab", { name: "Share cards", exact: true }).click();
      await page.getByRole("tab", { name: "Assistant", exact: true }).click();
      await expect(page.getByLabel("Draft body", { exact: true })).toHaveValue("Locally edited synthetic survey.\nNo provider write.");
      await page.getByRole("button", { name: "Start voice", exact: true }).click();
      await expect(page.getByRole("status").filter({ hasText: /^Listening$/ })).toBeVisible();
      await page.getByRole("button", { name: "Mute microphone", exact: true }).click();
      await expect(page.getByRole("button", { name: "Unmute microphone", exact: true })).toHaveAttribute("aria-pressed", "true");
      // Navigating away must still send owner-bound cleanup despite inactive UI state.
      await page.getByRole("tab", { name: "People", exact: true }).click();
      await expect.poll(() => assistantRequests.filter((r) => r.path.endsWith("/voice/stop")).length).toBe(1);
      expect((await testState()).microphoneStops).toBe(1);
      await page.getByRole("tab", { name: "Assistant", exact: true }).click();
      await page.getByRole("checkbox", { name: /Enable site tools/ }).check();
      await expect.poll(async () => (await testState()).tools).toBe(4);
      await page.evaluate(async () => {
        const state = (window as unknown as { __assistantTest: { tools: Map<string, { execute: (args: unknown) => Promise<unknown> }> } }).__assistantTest;
        await state.tools.get("get_crm_summary")!.execute({});
      });
      await expect(page.getByRole("heading", { name: "Synthetic totals", exact: true })).toBeVisible();
      await page.getByRole("checkbox", { name: /Site tools active/ }).uncheck();
      await expect.poll(async () => (await testState()).tools).toBe(0);
      await page.evaluate(() => { (window as unknown as { __assistantTest: { permissionDenied: boolean } }).__assistantTest.permissionDenied = true; });
      await page.getByRole("button", { name: "Start voice", exact: true }).click();
      await expect(page.getByRole("alert").filter({ hasText: "Microphone permission" })).toBeVisible();
      await expect(page.getByRole("status").filter({ hasText: /^Microphone off$/ })).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(1);
      expect(apiWrites.filter((path) => path !== "/api/telemetry/error" && !path.startsWith("/api/crm/assistant/"))).toEqual([]);
      expect(errors).toEqual([]);
      await page.screenshot({ path: testInfo.outputPath(`crm-assistant-${width}.png`), fullPage: true });
      // Cleanup must remain reachable after a lost connection, even when all new AI use is disabled.
      health = { ...capabilities, textEnabled: false, voiceEnabled: false, toolsEnabled: false,
        voiceSession: { sessionId: "00000000-0000-4000-8000-000000000002", state: "uncertain", canStop: true } };
      await page.getByRole("checkbox", { name: /I understand AI requests/ }).uncheck();
      await page.getByRole("button", { name: "Check availability again", exact: true }).click();
      await expect(page.getByText("Previous voice session needs attention", { exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Start voice", exact: true })).toBeDisabled();
      await expect(page.getByRole("button", { name: "Send message" })).toBeDisabled();
      await page.getByRole("button", { name: "End previous voice session", exact: true }).click();
      await expect(page.getByText("Previous voice session needs attention", { exact: true })).toBeHidden();
      expect(assistantRequests.filter((r) => r.path.endsWith("/voice/stop"))).toHaveLength(2);
      await page.context().setOffline(true);
      await expect(page.getByText("Offline · drafts stay here", { exact: true })).toBeVisible();
      await expect(page.getByLabel("Draft body", { exact: true })).toHaveValue("Locally edited synthetic survey.\nNo provider write.");
      await page.context().setOffline(false);
      await testInfo.attach("local-mocked-authority-evidence", { body: JSON.stringify({ width, writes: apiWrites, assistantCalls: assistantRequests.map((r) => r.path), ...await testState(), pageErrors: errors, horizontalOverflow: overflow }), contentType: "application/json" });
    });
  }
});
