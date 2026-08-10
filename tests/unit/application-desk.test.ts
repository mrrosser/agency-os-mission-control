import { describe, expect, it } from "vitest";
import {
  canRecordApplicationDeskDecisions,
  isApplicationDeskWorkspace,
  normalizeApplicationDeskWorkspaces,
  type ApplicationDeskWorkspace,
} from "@/lib/application-desk";

function workspace(
  overrides: Partial<ApplicationDeskWorkspace> = {},
): ApplicationDeskWorkspace {
  return {
    id: "ws_artist",
    slug: "marcus-rosser-artist",
    name: "Marcus Rosser Artist",
    status: "active",
    defaultProfileVersion: "artist-manager-default@v1",
    ...overrides,
  };
}

describe("Application Desk workspace projection", () => {
  it("keeps the canonical RT workspace visible but locally read-only", () => {
    expect(canRecordApplicationDeskDecisions("ws_ee1735c095774325")).toBe(false);
    expect(canRecordApplicationDeskDecisions("ws_cd43331c4b1648d0")).toBe(true);
  });

  it("accepts active artist workspaces and only the exact RT compatibility identity", () => {
    expect(isApplicationDeskWorkspace(workspace())).toBe(true);
    expect(
      isApplicationDeskWorkspace(
        workspace({
          id: "ws_ee1735c095774325",
          slug: "rt-solutions",
          defaultProfileVersion: "mission-control-default@v1",
        }),
      ),
    ).toBe(true);

    expect(
      isApplicationDeskWorkspace(
        workspace({
          id: "ws_duplicate_rt",
          slug: "rt-solutions",
          defaultProfileVersion: "mission-control-default@v1",
        }),
      ),
    ).toBe(false);
    expect(isApplicationDeskWorkspace(workspace({ status: "archived" }))).toBe(false);
  });

  it("normalizes bounded workspace metadata and drops malformed or duplicate records", () => {
    const normalized = normalizeApplicationDeskWorkspaces([
      workspace(),
      workspace({ name: "Duplicate should be ignored" }),
      workspace({ id: "ws_rt", slug: "RT Solutions" }),
      { ...workspace({ id: "ws_missing_name" }), name: "" },
      null,
      "not-an-object",
    ]);

    expect(normalized).toEqual([workspace()]);
  });
});
