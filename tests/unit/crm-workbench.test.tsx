import React from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OperatorWorkbench } from "@/components/crm/operator-workbench";
import { filterCrmPeople, nextCrmWorkspace } from "@/lib/crm/workbench";

const people = [
  { companyName: "Gallery Friend", founderName: "Zoë", email: "zoe@example.test", businessUnit: "rosser_nft_gallery" },
  { companyName: "Builder", founderName: "Ari", phone: "5550100", businessUnit: "rt_solutions" },
];

describe("CRM daily workbench", () => {
  it("filters the same dataset by business and normalized search without mutation", () => {
    expect(filterCrmPeople(people, "  ZOË ", "all")).toEqual([people[0]]);
    expect(filterCrmPeople(people, "example.test", "rt_solutions")).toEqual([]);
    expect(filterCrmPeople(people, "555", "rt_solutions")).toEqual([people[1]]);
    expect(filterCrmPeople(people, "", "all")).toEqual(people);
    expect(people).toHaveLength(2);
  });
  it("supports keyboard tab wrapping and endpoints", () => {
    expect(nextCrmWorkspace("people", "ArrowLeft")).toBe("activity");
    expect(nextCrmWorkspace("activity", "ArrowRight")).toBe("people");
    expect(nextCrmWorkspace("share", "Home")).toBe("people");
    expect(nextCrmWorkspace("people", "End")).toBe("activity");
    expect(nextCrmWorkspace("share", "Enter")).toBe("share");
  });
  it("renders one-step operator actions, accessible tabs, and honest missing data", () => {
    const html = renderToStaticMarkup(<OperatorWorkbench active="people" onChange={() => {}} onAdd={() => {}} registry={null} loading={false} />);
    expect(html).toContain("Your next conversation.");
    expect(html).toContain("Add a contact");
    expect(html).toContain("Review outreach");
    expect(html).toContain("Share my card");
    expect(html.match(/role="tab"/g)).toHaveLength(4);
    expect(html).toContain('aria-controls="crm-panel-people"');
    expect(html).toContain("Readiness unavailable");
    expect(html).toContain("Registry totals are not newsletter recipient counts");
    expect(html).not.toContain("8 subscribers");
  });
  it("retains existing server actions and isolates navigation from provider execution", () => {
    const page = readFileSync("app/dashboard/crm/page.tsx", "utf8");
    expect(page).toContain("<WarmReconnectActivation campaign={warmReconnectCampaign}");
    expect(page).toContain("<PortfolioRegistrySummary");
    expect(page).toContain("<GoogleOAuthCallbackFeedback");
    expect(page).toContain("Adding a contact does not subscribe them");
    expect(page).toContain("visibleLeads.map");
    const ui = readFileSync("components/crm/operator-workbench.tsx", "utf8");
    expect(ui).not.toContain("fetch(");
    expect(ui).not.toContain("localStorage");
    expect(readFileSync("app/dashboard/crm/workbench.css", "utf8")).toContain("prefers-reduced-motion:reduce");
  });
});
