import { describe, expect, it } from "vitest";
import {
  buildFirebaseClientConfigScript,
  buildFirebaseClientConfigFromDefaults,
  buildFirebaseClientConfigFromEnv,
  findMissingFirebaseClientConfig,
  resolveFirebaseClientConfig,
} from "@/lib/firebase-client-config";

describe("firebase client config resolution", () => {
  it("builds config from NEXT_PUBLIC env vars", () => {
    const config = buildFirebaseClientConfigFromEnv({
      NEXT_PUBLIC_FIREBASE_API_KEY: "api-key",
      NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: "leadflow-review.firebaseapp.com",
      NEXT_PUBLIC_FIREBASE_PROJECT_ID: "leadflow-review",
      NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: "leadflow-review.firebasestorage.app",
      NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: "450880825453",
      NEXT_PUBLIC_FIREBASE_APP_ID: "1:450880825453:web:b715cdd482f122b9667764",
    });

    expect(findMissingFirebaseClientConfig(config)).toEqual([]);
  });

  it("falls back to __FIREBASE_DEFAULTS__ when NEXT_PUBLIC env vars are absent", () => {
    const defaults = JSON.stringify({
      config: {
        apiKey: "api-key",
        authDomain: "leadflow-review.firebaseapp.com",
        projectId: "leadflow-review",
        storageBucket: "leadflow-review.firebasestorage.app",
        messagingSenderId: "450880825453",
        appId: "1:450880825453:web:b715cdd482f122b9667764",
      },
    });

    const config = buildFirebaseClientConfigFromDefaults(defaults);
    expect(findMissingFirebaseClientConfig(config)).toEqual([]);
  });

  it("prefers injected runtime config over missing env values", () => {
    const config = resolveFirebaseClientConfig({
      env: {
        NEXT_PUBLIC_FIREBASE_API_KEY: "",
      },
      injected: {
        apiKey: "api-key",
        authDomain: "leadflow-review.firebaseapp.com",
        projectId: "leadflow-review",
        storageBucket: "leadflow-review.firebasestorage.app",
        messagingSenderId: "450880825453",
        appId: "1:450880825453:web:b715cdd482f122b9667764",
      },
    });

    expect(findMissingFirebaseClientConfig(config)).toEqual([]);
  });

  it("preserves defaults through the real resolver when env is absent", () => {
    const defaults = {
      apiKey: "public-test-key", authDomain: "example.firebaseapp.com", projectId: "example",
      storageBucket: "example.appspot.com", messagingSenderId: "123", appId: "1:123:web:abc",
    };
    expect(resolveFirebaseClientConfig({ defaultsJson: JSON.stringify({ config: defaults }), env: {} })).toEqual(defaults);
  });

  it("merges only nonempty public values with injected then env then defaults precedence", () => {
    const config = resolveFirebaseClientConfig({
      defaultsJson: JSON.stringify({ config: { apiKey: "default-key", projectId: "default-project", storageBucket: "default-bucket" } }),
      env: { NEXT_PUBLIC_FIREBASE_API_KEY: "env-key", NEXT_PUBLIC_FIREBASE_PROJECT_ID: "  ", DATABASE_PASSWORD: "must-not-leak" },
      injected: { apiKey: " injected-key ", projectId: "", storageBucket: undefined },
    });
    expect(config).toEqual({ apiKey: "injected-key", projectId: "default-project", storageBucket: "default-bucket" });
    expect(JSON.stringify(config)).not.toContain("must-not-leak");
  });

  it("ignores invalid defaults and unknown injected keys", () => {
    expect(resolveFirebaseClientConfig({ defaultsJson: "not-json" })).toEqual({});
    const extra = { apiKey: "public-key", privateToken: "must-not-leak" };
    expect(buildFirebaseClientConfigScript({ injected: extra })).not.toContain("must-not-leak");
  });

  it("accepts Hosting defaults without optional appId while retaining required identity checks", () => {
    expect(findMissingFirebaseClientConfig({ apiKey: "public-key", authDomain: "test.firebaseapp.com", projectId: "test", storageBucket: "test.appspot.com", messagingSenderId: "123" })).toEqual([]);
    expect(findMissingFirebaseClientConfig({ appId: "1:123:web:abc" })).toEqual(["apiKey", "authDomain", "projectId"]);
  });

  it("serializes a browser-safe runtime script", () => {
    const script = buildFirebaseClientConfigScript({
      injected: {
        apiKey: "<api-key>",
        authDomain: "leadflow-review.firebaseapp.com",
        projectId: "leadflow-review",
        storageBucket: "leadflow-review.firebasestorage.app",
        messagingSenderId: "450880825453",
        appId: "1:450880825453:web:b715cdd482f122b9667764",
      },
    });

    expect(script).toContain("window.__LEADFLOW_FIREBASE_CONFIG__=");
    expect(script).toContain("\\u003capi-key>");
  });
});
