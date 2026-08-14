import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("GoogleWorkspaceConnect UI contract", () => {
  const source = readFileSync(
    join(process.cwd(), "components", "integrations", "GoogleWorkspaceConnect.tsx"),
    "utf8"
  );

  it("requires explicit confirmation for a profile-specific disconnect", () => {
    expect(source).toContain("Disconnect {profile.label}");
    expect(source).toContain("Confirm disconnect");
    expect(source).toContain("The other organization&apos;s Google connection will not be changed, and this");
    expect(source).toContain("does not revoke the Google account&apos;s project-wide grant.");
  });

  it("posts both business and profile context to disconnect", () => {
    expect(source).toContain('fetch("/api/google/disconnect"');
    expect(source).toMatch(
      /body:\s*JSON\.stringify\(\{[\s\S]*?businessId:\s*profile\.businessId,[\s\S]*?profileId:\s*profile\.profileId,?[\s\S]*?\}\)/
    );
    expect(source).toContain("result.businessId !== profile.businessId");
    expect(source).toContain("result.profileId !== profile.profileId");
    expect(source).toContain('result.disconnectScope !== "local_profile_only"');
    expect(source).toContain("result.providerRevocationAttempted !== false");
  });

  it("describes reconnect consent as a replacement instead of an additive enable", () => {
    expect(source).toContain("Replace with Drive + Calendar");
    expect(source).toContain("Replace with Full + Gmail");
    expect(source).toContain("replaces its current");
    expect(source).not.toMatch(/Enable \{capability\}/);
  });

  it("clears all prior-user connection metadata on logout or status failure", () => {
    expect(source).toContain("const resetConnectionStatus = useCallback");
    expect(source).toContain("setDefaultProfileId(null)");
    expect(source).toContain("setLegacyConnected(false)");
    expect(source.match(/resetConnectionStatus\(\)/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("invalidates stale status responses when the authenticated user changes", () => {
    expect(source).toContain("createLatestRequestGate");
    expect(source).toContain("const requestId = statusRequestGate.begin()");
    expect(source).toContain("statusRequestGate.isCurrent(requestId)");
    expect(source).toContain("return () => statusRequestGate.invalidate()");
  });
});
