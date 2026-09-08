import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/runtime/firebase-client-config/route";

vi.mock("@/lib/telemetry/store", () => ({ storeTelemetryErrorEvent: vi.fn() }));

function createRequest() {
  return new Request("http://localhost/api/runtime/firebase-client-config", { method: "GET" });
}

function createContext() {
  return { params: Promise.resolve({}) };
}

describe("firebase client config route", () => {
  beforeEach(() => {
    for (const key of ["NEXT_PUBLIC_FIREBASE_API_KEY", "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN", "NEXT_PUBLIC_FIREBASE_PROJECT_ID", "NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET", "NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID", "NEXT_PUBLIC_FIREBASE_APP_ID", "__FIREBASE_DEFAULTS__"]) {
      vi.stubEnv(key, undefined);
    }
  });
  afterEach(() => vi.unstubAllEnvs());

  it("returns runtime Firebase config as JavaScript", async () => {
    vi.stubEnv("NEXT_PUBLIC_FIREBASE_API_KEY", "api-key");
    vi.stubEnv("NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN", "leadflow-review.firebaseapp.com");
    vi.stubEnv("NEXT_PUBLIC_FIREBASE_PROJECT_ID", "leadflow-review");
    vi.stubEnv("NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET", "leadflow-review.firebasestorage.app");
    vi.stubEnv("NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID", "450880825453");
    vi.stubEnv("NEXT_PUBLIC_FIREBASE_APP_ID", "1:450880825453:web:b715cdd482f122b9667764");

    const response = await GET(
      createRequest() as unknown as Parameters<typeof GET>[0],
      createContext() as unknown as Parameters<typeof GET>[1]
    );
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/javascript");
    expect(body).toContain("window.__LEADFLOW_FIREBASE_CONFIG__");
    expect(body).toContain("leadflow-review.firebaseapp.com");

  });

  it("recovers config from deployment defaults with no public env variables", async () => {
    vi.stubEnv("__FIREBASE_DEFAULTS__", JSON.stringify({ config: {
      apiKey: "public-test-key", authDomain: "test.firebaseapp.com", projectId: "test",
      storageBucket: "test.appspot.com", messagingSenderId: "123", appId: "1:123:web:test",
    } }));
    const response = await GET(createRequest() as Parameters<typeof GET>[0], createContext());
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("test.firebaseapp.com");
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("reports unavailable config instead of a successful empty bootstrap", async () => {
    const response = await GET(createRequest() as Parameters<typeof GET>[0], createContext());
    expect(response.status).toBe(503);
    expect(await response.text()).toBe("window.__LEADFLOW_FIREBASE_CONFIG__={};");
  });
});
