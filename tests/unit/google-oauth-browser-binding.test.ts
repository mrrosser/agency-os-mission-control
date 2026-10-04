import { describe, expect, it } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import {
  clearGoogleOAuthPkceCookie,
  createGoogleOAuthBrowserBinding,
  createGoogleOAuthPkceBinding,
  GOOGLE_OAUTH_STATE_MAX_AGE_SECONDS,
  googleOAuthStateCookieName,
  readGoogleOAuthPkceCookie,
  setGoogleOAuthBrowserCookie,
  setGoogleOAuthPkceCookie,
  verifyGoogleOAuthPkceBinding,
} from "@/lib/google/oauth-state";

const STATE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const STATE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const STATE_C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const PREFIX = "mc-google-oauth-v1.";
const ROOT_AUTH_COOKIE = "__session=synthetic.firebase.jwt";

function request(cookie = "") {
  return new NextRequest("https://leadflow-review.web.app/api/google/callback", {
    headers: cookie ? { cookie } : {},
  });
}

function browserCookie(secret: string) {
  const response = NextResponse.json({ ok: true });
  setGoogleOAuthBrowserCookie(response, secret);
  const cookie = response.cookies.get("__session")!;
  return `${cookie.name}=${cookie.value}`;
}

// Model Hosting's documented name filter. Actual CDN duplicate-cookie forwarding
// still requires deployment verification; this is deliberately a local transport test.
function hostingCookieHeader(cookie: string) {
  return cookie.split(";").map((part) => part.trim())
    .filter((part) => part.startsWith("__session=")).join("; ");
}

describe("Google OAuth browser binding transport", () => {
  it("survives Hosting's __session-only filter while legacy state cookies do not", () => {
    const binding = createGoogleOAuthBrowserBinding(request(), STATE_A);
    const legacy = createGoogleOAuthPkceBinding();
    const legacyCookie = `${googleOAuthStateCookieName(STATE_A)}=${legacy.verifier}`;
    const incoming = hostingCookieHeader(
      `unrelated=value; ${legacyCookie}; ${browserCookie(binding.browserSecret)}`
    );

    expect(incoming).toBe(browserCookie(binding.browserSecret));
    expect(readGoogleOAuthPkceCookie(request(incoming), STATE_A)).toBe(binding.verifier);
    expect(verifyGoogleOAuthPkceBinding(
      readGoogleOAuthPkceCookie(request(incoming), STATE_A), binding.challenge
    )).toBe(true);
    expect(readGoogleOAuthPkceCookie(request(hostingCookieHeader(legacyCookie)), STATE_A)).toBeNull();
  });

  it("sets an expiring host-only binding scoped away from Firebase's root auth cookie", () => {
    const binding = createGoogleOAuthBrowserBinding(request(), STATE_A);
    const response = NextResponse.json({ ok: true });
    setGoogleOAuthBrowserCookie(response, binding.browserSecret);

    expect(response.cookies.get("__session")).toMatchObject({
      name: "__session", value: PREFIX + binding.browserSecret,
      path: "/api/google", httpOnly: true, secure: true, sameSite: "lax",
      maxAge: GOOGLE_OAUTH_STATE_MAX_AGE_SECONDS,
    });
    expect(response.cookies.get("__session")?.domain).toBeUndefined();
    expect(response.headers.get("set-cookie")).not.toContain(STATE_A);
    expect(response.headers.get("set-cookie")).not.toContain(binding.verifier);
    expect(response.headers.get("set-cookie")).not.toContain(binding.challenge);
  });

  it.each(["scoped-first", "root-first"])(
    "uses the owned binding when a root Firebase cookie coexists (%s)", (order) => {
      const binding = createGoogleOAuthBrowserBinding(request(), STATE_A);
      const scoped = browserCookie(binding.browserSecret);
      const cookies = order === "scoped-first" ? [scoped, ROOT_AUTH_COOKIE] : [ROOT_AUTH_COOKIE, scoped];
      const incoming = request(hostingCookieHeader(cookies.join("; ")));

      expect(readGoogleOAuthPkceCookie(incoming, STATE_A)).toBe(binding.verifier);
      expect(createGoogleOAuthBrowserBinding(incoming, STATE_B).browserSecret).toBe(binding.browserSecret);
    }
  );

  it("does not interpret a framework JWT as a PKCE secret", () => {
    expect(readGoogleOAuthPkceCookie(request(ROOT_AUTH_COOKIE), STATE_A)).toBeNull();
    const binding = createGoogleOAuthBrowserBinding(request(ROOT_AUTH_COOKIE), STATE_A);
    expect(binding.browserSecret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(binding.browserSecret).not.toBe("synthetic.firebase.jwt");
  });

  it.each([
    ["empty", ""],
    ["short", "a".repeat(42)],
    ["long", "a".repeat(44)],
    ["invalid alphabet", "a".repeat(42) + "+"],
    ["encoded value", "%41".repeat(43)],
  ])("rejects a malformed owned cookie (%s) without falling back to a legacy verifier", (_name, secret) => {
    const legacy = createGoogleOAuthPkceBinding();
    const incoming = request(
      `__session=${PREFIX}${secret}; ${googleOAuthStateCookieName(STATE_A)}=${legacy.verifier}`
    );
    expect(() => createGoogleOAuthBrowserBinding(incoming, STATE_A)).toThrow();
    expect(readGoogleOAuthPkceCookie(incoming, STATE_A)).toBeNull();
  });

  it.each(["identical", "different"])("rejects duplicate owned cookie values (%s)", (kind) => {
    const first = browserCookie("a".repeat(43));
    const second = browserCookie((kind === "identical" ? "a" : "b").repeat(43));
    const incoming = request(`${ROOT_AUTH_COOKIE}; ${first}; ${second}`);
    expect(() => createGoogleOAuthBrowserBinding(incoming, STATE_A)).toThrow();
    expect(readGoogleOAuthPkceCookie(incoming, STATE_A)).toBeNull();
  });

  it("rejects oversized headers before accepting any browser binding", () => {
    const incoming = request(`${browserCookie("a".repeat(43))}; extra=${"x".repeat(16_384)}`);
    expect(() => createGoogleOAuthBrowserBinding(incoming, STATE_A)).toThrow();
    expect(readGoogleOAuthPkceCookie(incoming, STATE_A)).toBeNull();
  });

  it("binds the verifier to both the browser secret and the individual state", () => {
    const first = createGoogleOAuthBrowserBinding(request(browserCookie("a".repeat(43))), STATE_A);
    const otherBrowser = request(browserCookie("b".repeat(43)));
    const sameBrowser = request(browserCookie(first.browserSecret));

    expect(verifyGoogleOAuthPkceBinding(readGoogleOAuthPkceCookie(otherBrowser, STATE_A), first.challenge)).toBe(false);
    expect(verifyGoogleOAuthPkceBinding(readGoogleOAuthPkceCookie(sameBrowser, STATE_B), first.challenge)).toBe(false);
    expect(verifyGoogleOAuthPkceBinding(readGoogleOAuthPkceCookie(sameBrowser, STATE_A), first.challenge)).toBe(true);
    expect(readGoogleOAuthPkceCookie(sameBrowser, "not-a-state")).toBeNull();
    expect(() => createGoogleOAuthBrowserBinding(sameBrowser, "not-a-state")).toThrow();
  });

  it("retains independently derived pending bindings across repeated profile connects", () => {
    const first = createGoogleOAuthBrowserBinding(request(), STATE_A);
    const incoming = request(`${ROOT_AUTH_COOKIE}; ${browserCookie(first.browserSecret)}`);
    const second = createGoogleOAuthBrowserBinding(incoming, STATE_B);
    const retry = createGoogleOAuthBrowserBinding(incoming, STATE_C);

    expect(second.browserSecret).toBe(first.browserSecret);
    expect(retry.browserSecret).toBe(first.browserSecret);
    expect(new Set([first.verifier, second.verifier, retry.verifier]).size).toBe(3);
    for (const [state, binding] of [[STATE_A, first], [STATE_B, second], [STATE_C, retry]] as const) {
      expect(verifyGoogleOAuthPkceBinding(readGoogleOAuthPkceCookie(incoming, state), binding.challenge)).toBe(true);
      const response = NextResponse.json({ ok: true });
      setGoogleOAuthBrowserCookie(response, binding.browserSecret);
      expect(response.cookies.get("__session")?.maxAge).toBe(600);
    }
  });

  it("does not erase the shared browser binding when callbacks finish out of order", () => {
    const first = createGoogleOAuthBrowserBinding(request(), STATE_A);
    const incoming = request(browserCookie(first.browserSecret));
    const second = createGoogleOAuthBrowserBinding(incoming, STATE_B);

    for (const state of [STATE_B, STATE_A]) {
      const response = NextResponse.redirect("https://leadflow-review.web.app/dashboard/crm");
      clearGoogleOAuthPkceCookie(response, state);
      expect(response.cookies.get("__session")).toBeUndefined();
      expect(response.cookies.get(googleOAuthStateCookieName(state))?.maxAge).toBe(0);
      expect(readGoogleOAuthPkceCookie(incoming, STATE_B)).toBe(second.verifier);
    }
  });

  it("fails closed for the losing initial parallel bootstrap and permits an explicit retry", () => {
    const first = createGoogleOAuthBrowserBinding(request(), STATE_A);
    const second = createGoogleOAuthBrowserBinding(request(), STATE_B);
    expect(first.browserSecret).not.toBe(second.browserSecret);
    // The later connect response wins the browser's scoped cookie slot.
    const incoming = request(browserCookie(second.browserSecret));
    expect(verifyGoogleOAuthPkceBinding(readGoogleOAuthPkceCookie(incoming, STATE_A), first.challenge)).toBe(false);
    expect(verifyGoogleOAuthPkceBinding(readGoogleOAuthPkceCookie(incoming, STATE_B), second.challenge)).toBe(true);
    const retry = createGoogleOAuthBrowserBinding(incoming, STATE_C);
    expect(retry.browserSecret).toBe(second.browserSecret);
    expect(verifyGoogleOAuthPkceBinding(readGoogleOAuthPkceCookie(incoming, STATE_C), retry.challenge)).toBe(true);
  });

  it("preserves pending legacy attempts when their original cookie is forwarded", () => {
    const legacy = createGoogleOAuthPkceBinding();
    const response = NextResponse.json({ ok: true });
    setGoogleOAuthPkceCookie(response, STATE_A, legacy.verifier);
    const cookie = response.cookies.get(googleOAuthStateCookieName(STATE_A))!;
    expect(verifyGoogleOAuthPkceBinding(
      readGoogleOAuthPkceCookie(request(`${cookie.name}=${cookie.value}`), STATE_A), legacy.challenge
    )).toBe(true);
  });

  it("keeps an older exact-state verifier when another profile creates the new browser anchor", () => {
    const legacy = createGoogleOAuthPkceBinding();
    const current = createGoogleOAuthBrowserBinding(request(), STATE_B);
    const incoming = request(`${browserCookie(current.browserSecret)}; ${googleOAuthStateCookieName(STATE_A)}=${legacy.verifier}`);
    expect(readGoogleOAuthPkceCookie(incoming, STATE_A)).toBe(legacy.verifier);
    expect(verifyGoogleOAuthPkceBinding(readGoogleOAuthPkceCookie(incoming, STATE_A), legacy.challenge)).toBe(true);
    expect(readGoogleOAuthPkceCookie(incoming, STATE_B)).toBe(current.verifier);
  });
});
