import { describe, expect, it } from "vitest";
import { isPublicProviderPath } from "@/lib/public-provider-paths";

describe("public provider bypass allowlist", () => {
  it.each(["/preferences", "/preferences/", "/connect/rosser-gallery", "/connect/rosser-gallery/", "/connect/rt-solutions", "/connect/rt-solutions/"])("allows exact public path %s", path => {
    expect(isPublicProviderPath(path)).toBe(true);
  });
  it.each(["/dashboard", "/dashboard/crm", "/connect", "/connect/unknown", "/connect/rosser-gallery/admin", "/preferences/admin", "/login"])("keeps private or unrecognized path %s within the normal workspace providers", path => {
    expect(isPublicProviderPath(path)).toBe(false);
  });
});
