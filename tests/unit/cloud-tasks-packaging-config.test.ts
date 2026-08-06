import { describe, expect, it } from "vitest";
import nextConfig from "@/next.config";

describe("Cloud Tasks production packaging", () => {
  it("keeps @google-cloud/tasks external so its JSON runtime assets are traced", () => {
    expect(nextConfig.serverExternalPackages).toContain("@google-cloud/tasks");
  });
});
