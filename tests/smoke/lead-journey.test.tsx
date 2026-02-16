import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { LeadJourney } from "@/components/operations/LeadJourney";

describe("LeadJourney", () => {
  it("renders journey entries without crashing", () => {
    const markup = renderToStaticMarkup(
      <LeadJourney
        journeys={[
          {
            leadId: "lead-1",
            companyName: "Nova Electric",
            founderName: "Sam",
            email: "sam@nova.example",
            phone: "+15125550100",
            score: 78,
            source: "googlePlaces",
            website: "https://nova.example",
            steps: {
              source: "complete",
              score: "complete",
              enrich: "complete",
              script: "pending",
              outreach: "pending",
              followup: "pending",
              booking: "pending",
            },
          },
        ]}
      />
    );

    expect(markup).toContain("Lead Journey");
    expect(markup).toContain("Nova Electric");
    expect(markup).toContain("Call");
  });
});
