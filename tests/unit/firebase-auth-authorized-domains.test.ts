import { describe, expect, it } from "vitest";
import {
  mergeAuthorizedDomains,
  normalizeDomain,
  parseAuthorizedDomainArgs,
} from "@/scripts/firebase-auth-authorized-domains.mjs";

describe("firebase-auth-authorized-domains", () => {
  it("normalizes domains and strips scheme", () => {
    expect(normalizeDomain("https://Example.com")).toBe("example.com");
    expect(normalizeDomain("sub.domain.io")).toBe("sub.domain.io");
  });

  it("rejects path-based values", () => {
    expect(() => normalizeDomain("example.com/login")).toThrow(
      "Provide hostname only (no path/query/hash)."
    );
  });

  it("merges domains without duplicates", () => {
    const merged = mergeAuthorizedDomains(
      ["localhost", "leadflow-review.web.app"],
      ["leadflow-review.web.app", "ai-hell-mary-mission-control-gdyt2qma6a-uc.a.run.app"]
    );
    expect(merged).toEqual([
      "localhost",
      "leadflow-review.web.app",
      "ai-hell-mary-mission-control-gdyt2qma6a-uc.a.run.app",
    ]);
  });

  it("parses CLI args", () => {
    const parsed = parseAuthorizedDomainArgs([
      "--project",
      "leadflow-review",
      "--add-domain",
      "ai-hell-mary-mission-control-gdyt2qma6a-uc.a.run.app",
      "--dry-run",
    ]);
    expect(parsed).toEqual({
      help: false,
      projectId: "leadflow-review",
      dryRun: true,
      domains: ["ai-hell-mary-mission-control-gdyt2qma6a-uc.a.run.app"],
    });
  });

  it("parses positional args for npm-run compatibility", () => {
    const parsed = parseAuthorizedDomainArgs([
      "leadflow-review",
      "ai-hell-mary-mission-control-gdyt2qma6a-uc.a.run.app",
      "dry-run",
    ]);
    expect(parsed).toEqual({
      help: false,
      projectId: "leadflow-review",
      dryRun: true,
      domains: ["ai-hell-mary-mission-control-gdyt2qma6a-uc.a.run.app"],
    });
  });
});
