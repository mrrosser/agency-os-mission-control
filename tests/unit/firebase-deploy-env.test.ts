import { describe, expect, it } from "vitest";
import { buildFirebaseDeployEnv } from "@/scripts/firebase-deploy-env.mjs";

describe("buildFirebaseDeployEnv", () => {
  it("uses a bounded discovery timeout and production-only install defaults", () => {
    const env = buildFirebaseDeployEnv({ KEEP_ME: "yes" });

    expect(env).toMatchObject({
      KEEP_ME: "yes",
      NODE_ENV: "production",
      NPM_CONFIG_OMIT: "dev",
      FIREBASE_CLI_EXPERIMENTS: "webframeworks",
      FUNCTIONS_DISCOVERY_TIMEOUT: "60",
    });
  });

  it("honors a valid explicit discovery timeout", () => {
    expect(buildFirebaseDeployEnv({ FUNCTIONS_DISCOVERY_TIMEOUT: " 120 " })).toMatchObject({
      FUNCTIONS_DISCOVERY_TIMEOUT: "120",
    });
  });

  it.each(["nine", "9", "301", "30.5"])("rejects invalid discovery timeout %s", (value) => {
    expect(() => buildFirebaseDeployEnv({ FUNCTIONS_DISCOVERY_TIMEOUT: value })).toThrow(
      /FUNCTIONS_DISCOVERY_TIMEOUT/
    );
  });
});
