import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { LeadFlowBackdrop } from "@/components/visuals/LeadFlowBackdrop";

describe("LeadFlowBackdrop", () => {
  it("renders a full-screen canvas wrapper", () => {
    const markup = renderToStaticMarkup(<LeadFlowBackdrop />);
    expect(markup).toContain("data-testid=\"lead-flow-backdrop\"");
    expect(markup).toContain("<canvas");
  });
});
