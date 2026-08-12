import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET as preferencesGet, POST as preferencesPost } from "@/app/api/crm/warm-reconnect/preferences/route";
import { GET as unsubscribeGet, POST as unsubscribePost } from "@/app/api/crm/warm-reconnect/unsubscribe/route";
import { GET as oneClickGet, POST as oneClickPost } from "@/app/api/crm/warm-reconnect/unsubscribe/[token]/route";
import {
  globallyUnsubscribeWarmReconnectCapability,
  processWarmReconnectPreferenceMutation,
} from "@/lib/crm/warm-reconnect-preferences";

vi.mock("@/lib/crm/warm-reconnect-preferences", () => ({
  globallyUnsubscribeWarmReconnectCapability: vi.fn(),
  processWarmReconnectPreferenceMutation: vi.fn(),
}));

const processMock = vi.mocked(processWarmReconnectPreferenceMutation);
const unsubscribeMock = vi.mocked(globallyUnsubscribeWarmReconnectCapability);
const token = "t".repeat(43);

function expectedResult(overrides: Record<string, unknown> = {}) {
  return {
    ok: true as const,
    message: "Saved.",
    available: true,
    expired: false,
    canUpdatePreferences: true,
    canUnsubscribe: true,
    globallyUnsubscribed: false,
    topics: {
      marcus_rosser_art: true,
      rosser_gallery: false,
      rt_solutions: false,
    },
    ...overrides,
  };
}

function expectPrivacyHeaders(response: Response) {
  expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
  expect(response.headers.get("pragma")).toBe("no-cache");
  expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  expect(response.headers.get("content-security-policy")).toContain("default-src 'none'");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  expect(response.headers.get("x-frame-options")).toBe("DENY");
  expect(response.headers.get("set-cookie")).toBeNull();
  expect(response.headers.get("location")).toBeNull();
}

describe("public warm reconnect preference routes", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    processMock.mockResolvedValue(expectedResult());
    unsubscribeMock.mockResolvedValue(expectedResult({ globallyUnsubscribed: true }));
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("keeps every GET inert and returns privacy headers", async () => {
    const responses = await Promise.all([
      preferencesGet(),
      unsubscribeGet(),
      oneClickGet(),
    ]);
    for (const response of responses) {
      expect(response.status).toBe(200);
      expectPrivacyHeaders(response);
      expect(JSON.stringify(await response.json())).not.toContain(token);
    }
    expect(processMock).not.toHaveBeenCalled();
    expect(unsubscribeMock).not.toHaveBeenCalled();
  });

  it("accepts a fragment-derived preference token only in a bounded JSON POST body", async () => {
    const response = await preferencesPost(
      new Request("http://localhost/api/crm/warm-reconnect/preferences", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "inspect", token }),
      }) as never
    );
    expect(response.status).toBe(200);
    expectPrivacyHeaders(response);
    expect(processMock).toHaveBeenCalledWith({ action: "inspect", token });
    expect(await response.json()).toMatchObject({ available: true });
    expect(JSON.stringify(vi.mocked(console.info).mock.calls)).not.toContain(token);
  });

  it("returns the same generic envelope for malformed and unknown requests", async () => {
    processMock.mockResolvedValue(expectedResult({ available: false }));
    const malformed = await preferencesPost(
      new Request("http://localhost/api/crm/warm-reconnect/preferences", {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: token,
      }) as never
    );
    const unknown = await preferencesPost(
      new Request("http://localhost/api/crm/warm-reconnect/preferences", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "inspect", token }),
      }) as never
    );
    expect(malformed.status).toBe(unknown.status);
    expect(await malformed.json()).toMatchObject({ ok: true, available: false });
    expect(await unknown.json()).toMatchObject({ ok: true, available: false });
  });

  it("processes human unsubscribe tokens from POST bodies without reflecting capability data", async () => {
    const response = await unsubscribePost(
      new Request("http://localhost/api/crm/warm-reconnect/unsubscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      }) as never
    );
    expect(unsubscribeMock).toHaveBeenCalledWith(token);
    expect(JSON.stringify(await response.json())).not.toContain(token);
    expect(JSON.stringify(vi.mocked(console.info).mock.calls)).not.toContain(token);
    expectPrivacyHeaders(response);
  });

  it("implements RFC 8058 one-click as exact form POST with unsubscribe-only scope", async () => {
    const request = new Request(
      `http://localhost/api/crm/warm-reconnect/unsubscribe/${token}`,
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "List-Unsubscribe=One-Click",
      }
    );
    const response = await oneClickPost(request as never, {
      params: Promise.resolve({ token }),
    });

    expect(response.status).toBe(200);
    expectPrivacyHeaders(response);
    expect(unsubscribeMock).toHaveBeenCalledWith(token, {
      requiredScope: "unsubscribe_only",
    });
    expect(JSON.stringify(await response.json())).not.toContain(token);
    expect(JSON.stringify(vi.mocked(console.info).mock.calls)).not.toContain(token);
  });

  it("accepts charset parameters but does not mutate for a non-exact or oversized form", async () => {
    const wrongBody = await oneClickPost(
      new Request(`http://localhost/api/crm/warm-reconnect/unsubscribe/${token}`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "List-Unsubscribe=One-Click&extra=true",
      }) as never,
      { params: Promise.resolve({ token }) }
    );
    const charsetType = await oneClickPost(
      new Request(`http://localhost/api/crm/warm-reconnect/unsubscribe/${token}`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded; charset=UTF-8" },
        body: "List-Unsubscribe=One-Click",
      }) as never,
      { params: Promise.resolve({ token }) }
    );
    expect(wrongBody.status).toBe(200);
    const oversized = await oneClickPost(
      new Request(`http://localhost/api/crm/warm-reconnect/unsubscribe/${token}`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "content-length": "1025",
        },
        body: "List-Unsubscribe=One-Click",
      }) as never,
      { params: Promise.resolve({ token }) }
    );
    expect(charsetType.status).toBe(200);
    expect(oversized.status).toBe(200);
    expect(unsubscribeMock).toHaveBeenCalledTimes(1);
  });
});
