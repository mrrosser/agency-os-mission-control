import { describe, expect, it } from "vitest";
import nextConfig from "@/next.config";

describe("Google Cloud production packaging", () => {
  it("keeps JSON-asset clients external so their runtime assets are traced", () => {
    expect(nextConfig.serverExternalPackages).toContain("@google-cloud/tasks");
    expect(nextConfig.serverExternalPackages).toContain(
      "@google-cloud/secret-manager"
    );
  });
});
