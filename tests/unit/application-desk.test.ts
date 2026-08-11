import { describe, expect, it } from "vitest";
import {
  applicationDeskWorkspaceDisplayName,
  isApplicationDeskWorkspace,
  isApplicationReviewVisibleForStatus,
  normalizeApplicationDeskWorkspaces,
  type ApplicationReviewItem,
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

  it("uses friendly display labels without changing canonical IDs, slugs, or names", () => {
    const marcus = workspace({
      id: "ws_cd43331c4b1648d0",
      slug: "marcus-rosser-artist-career-autopilot",
      name: "Marcus Rosser Artist Career Autopilot",
    });
    const rt = workspace({
      id: "ws_ee1735c095774325",
      slug: "rt-solutions",
      name: "RT Solutions Autopilot",
    });

    expect(applicationDeskWorkspaceDisplayName(marcus)).toBe(
      "Marcus Rosser Artist Career",
    );
    expect(applicationDeskWorkspaceDisplayName(rt)).toBe("RT Solutions");
    expect(marcus.name).toBe("Marcus Rosser Artist Career Autopilot");
    expect(rt.name).toBe("RT Solutions Autopilot");
  });
});

function reviewItem(
  state: ApplicationReviewItem["deadlineLifecycle"]["state"],
  status: ApplicationReviewItem["status"] =
    state === "open" ? "needs_review" : "expired",
): ApplicationReviewItem {
  return {
    status,
    deadlineLifecycle: {
      state,
      overdueDays:
        state === "open"
          ? null
          : state === "recently_overdue"
            ? 5
            : state === "expired_filter_only"
              ? 14
              : 15,
      evaluatedAt: "2026-08-16T00:00:00.001Z",
    },
  } as ApplicationReviewItem;
}

describe("Application Desk lifecycle projection", () => {
  it("keeps recent overdue work in All and days 6-14 in Expired only", () => {
    expect(isApplicationReviewVisibleForStatus(reviewItem("recently_overdue"), "all")).toBe(true);
    expect(isApplicationReviewVisibleForStatus(reviewItem("expired_filter_only"), "all")).toBe(false);
    expect(
      isApplicationReviewVisibleForStatus(reviewItem("expired_filter_only"), "expired"),
    ).toBe(true);
    expect(isApplicationReviewVisibleForStatus(reviewItem("soft_archived"), "expired")).toBe(false);
    expect(
      isApplicationReviewVisibleForStatus(
        reviewItem("recently_overdue", "rejected"),
        "expired",
      ),
    ).toBe(true);
  });

  it("groups operator filters while keeping decision history available in All", () => {
    for (const status of [
      "needs_review",
      "stale",
      "changes_requested",
    ] satisfies ApplicationReviewItem["status"][]) {
      const actionable = reviewItem("open", status);
      expect(isApplicationReviewVisibleForStatus(actionable, "needs_review")).toBe(true);
      expect(isApplicationReviewVisibleForStatus(actionable, "all")).toBe(true);
    }

    for (const status of [
      "approved_for_preparation",
      "deferred",
      "rejected",
    ] satisfies ApplicationReviewItem["status"][]) {
      const historical = reviewItem("open", status);
      expect(isApplicationReviewVisibleForStatus(historical, "needs_review")).toBe(false);
      expect(isApplicationReviewVisibleForStatus(historical, "all")).toBe(true);
    }
  });

  it("fails closed during a staggered deployment instead of using the browser clock", () => {
    const legacyExpired = {
      ...reviewItem("recently_overdue"),
      deadlineLifecycle: undefined,
    } as unknown as ApplicationReviewItem;

    expect(isApplicationReviewVisibleForStatus(legacyExpired, "all")).toBe(false);
    expect(isApplicationReviewVisibleForStatus(legacyExpired, "expired")).toBe(true);
  });
});
