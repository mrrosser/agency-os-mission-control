import { afterEach, describe, expect, it, vi } from "vitest";
import { getRuntimeFirebaseClientConfig } from "@/lib/firebase-runtime-config";

describe("server Firebase runtime config", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("reads current runtime values on every request and exposes only the public allowlist", () => {
    vi.stubEnv("NEXT_PUBLIC_FIREBASE_PROJECT_ID", "first-project");
    vi.stubEnv("SERVER_PRIVATE_KEY", "not-public");
    expect(getRuntimeFirebaseClientConfig().projectId).toBe("first-project");
    vi.stubEnv("NEXT_PUBLIC_FIREBASE_PROJECT_ID", "second-project");
    expect(getRuntimeFirebaseClientConfig().projectId).toBe("second-project");
    expect(JSON.stringify(getRuntimeFirebaseClientConfig())).not.toContain("not-public");
  });
});
