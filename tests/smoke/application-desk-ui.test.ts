import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function source(relativePath: string): string {
  return fs.readFileSync(path.resolve(...relativePath.split("/")), "utf8");
}

function compact(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

describe("unified Mission Control Application Desk UI", () => {
  const layout = source("app/dashboard/layout.tsx");
  const page = source("app/dashboard/opportunities/page.tsx");
  const provider = source("components/providers/application-desk-provider.tsx");
  const desk = source("components/application-review-desk.tsx");
  const clientSurface = compact(`${page}\n${provider}\n${desk}`);

  it("adds the native authenticated route to the existing desktop and mobile navigation source", () => {
    expect(layout).toContain('href: "/dashboard/opportunities"');
    expect(layout).toContain('label: "Application Desk"');
    expect(layout).toContain('icon: "receipt"');
    expect(page).toContain("<ApplicationReviewDesk");
    expect(provider).toContain('fetch("/api/application-desk/workspaces"');
    expect(desk).toContain('fetch("/api/application-desk/reviews"');
    expect(clientSurface).not.toContain("ai-hell-mary-mission-control-gdyt2qma6a-uc.a.run.app");
    expect(clientSurface).not.toMatch(/<iframe\b/i);
  });

  it("states the exact preparation-only authority boundary", () => {
    expect(compact(page)).toContain(
      "Approvals here authorize internal preparation only—not browser entry or final submission.",
    );
    expect(compact(desk)).toContain(
      "It does not open, fill, save, or submit a provider form; pay a fee; sign; attest; accept terms; create or update an account; or send a communication.",
    );
    expect(compact(desk)).toContain(
      "A future browser milestone requires a separate reviewed approval before it may even populate fields.",
    );
    expect(desk).toContain('decisionKind === "approve_for_preparation"');
    expect(desk).toContain("No external submission or communication occurred.");
  });

  it("keeps official listing navigation HTTPS-only and credential-free", () => {
    expect(desk).toContain("item.opportunity.sourceOfficial !== true");
    expect(desk).toContain('target.protocol !== "https:"');
    expect(desk).toContain("target.username || target.password");
    expect(desk).toContain("Listing link unavailable");
  });

  it("records a unique decision bound to the reviewed round, artifacts, and prior decision", () => {
    expect(desk).toContain("`decision_${crypto.randomUUID()}`");
    expect(desk).toContain("expectedReviewRoundId: row.item.reviewRoundId");
    expect(desk).toContain("expectedActionFingerprint: row.item.actionFingerprint");
    expect(desk).toContain("expectedArtifactFingerprint: row.item.artifactFingerprint");
    expect(desk).toContain("expectedLatestDecisionId: row.item.latestDecisionId");
    expect(desk).toContain("await loadReviews(\"refresh\")");
  });

  it("uses the server lifecycle for overdue retention and upstream capability for write access", () => {
    expect(desk).toContain("isApplicationReviewVisibleForStatus");
    const statusOptions = desk.match(
      /const statusFilterOptions[\s\S]*?= \[([\s\S]*?)\];/,
    )?.[1];
    expect(statusOptions).toContain('{ value: "needs_review", label: "Needs review" }');
    expect(statusOptions).toContain('{ value: "expired", label: "Expired" }');
    expect(statusOptions).not.toMatch(/approved_for_preparation|changes_requested|deferred|rejected|stale/);
    expect(desk).toContain("item.deadlineLifecycle.overdueDays");
    expect(desk).toContain("Opportunities 6–14 days overdue appear only");
    expect(desk).toContain("applicationDeskWorkspaceDisplayName");
    expect(desk).not.toContain(
      "This workspace is read-only until approval access is reconciled.",
    );
  });

  it("previews, confirms, then applies only the exact three prepared cases", () => {
    for (const title of [
      "SUNO Nursing Building Interior",
      "SUNO Nursing Building Exterior",
      "Water Connects Us",
    ]) {
      expect(page).toContain(`\"${title}\"`);
    }
    expect(page).toContain("requestPreparedImport(user, true)");
    expect(page).toContain("EXPECTED_PREPARED_TITLES.every");
    expect(page).toContain("titles[index] === title");
    expect(page).toContain("window.confirm");
    expect(page).toContain("requestPreparedImport(user, false)");
    expect(page).toContain('action.action !== "upserted"');
    expect(page).toContain("JSON.stringify({ dryRun })");
    expect(compact(page)).toContain(
      "This creates internal review records only. It does not open or submit a form, pay a fee, sign, attest, accept terms, update an account, or send a message.",
    );
  });
});

