import { describe, expect, it, vi } from "vitest";

// Avoid firebase-admin initialization in this unit test.
vi.mock("@/lib/firebase-admin", () => ({
  getAdminDb: () => {
    throw new Error("getAdminDb should not be called in expandDomainCandidates tests");
  },
}));

describe("outreach DNC domain candidates", () => {
  it("expands subdomains to include parent domains", async () => {
    const { expandDomainCandidates } = await import("@/lib/outreach/dnc");

    expect(expandDomainCandidates("a.b.example.com")).toEqual([
      "a.b.example.com",
      "b.example.com",
      "example.com",
    ]);
  });

  it("normalizes URLs and www prefixes", async () => {
    const { expandDomainCandidates } = await import("@/lib/outreach/dnc");

    expect(expandDomainCandidates("https://www.Sub.Example.com/path?q=1")).toEqual([
      "sub.example.com",
      "example.com",
    ]);
  });

  it("returns a single candidate when no subdomain is present", async () => {
    const { expandDomainCandidates } = await import("@/lib/outreach/dnc");

    expect(expandDomainCandidates("example.com")).toEqual(["example.com"]);
    expect(expandDomainCandidates("localhost")).toEqual(["localhost"]);
  });

  it("returns empty list for empty values", async () => {
    const { expandDomainCandidates } = await import("@/lib/outreach/dnc");

    expect(expandDomainCandidates("")).toEqual([]);
    expect(expandDomainCandidates("   ")).toEqual([]);
  });
});

