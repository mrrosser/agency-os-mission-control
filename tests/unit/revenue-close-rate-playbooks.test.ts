import { describe, expect, it } from "vitest";
import {
  buildFollowupMessagePlan,
  resolveFollowupBranch,
} from "@/lib/revenue/close-rate-playbooks";

describe("revenue close-rate playbooks", () => {
  it("routes sequence-4 followups to no_response branch by default", () => {
    const branch = resolveFollowupBranch({
      sequence: 4,
    });

    expect(branch.branch).toBe("no_response");
  });

  it("honors not_now disposition with a future date", () => {
    const notNowDate = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();
    const branch = resolveFollowupBranch({
      sequence: 2,
      disposition: "not_now",
      notNowUntil: notNowDate,
    });

    expect(branch.branch).toBe("not_now");
    expect(branch.notNowUntilMs).toBeTypeOf("number");
  });

  it("builds stage-aware booking guidance in message output", () => {
    const plan = buildFollowupMessagePlan({
      branch: "standard",
      sequence: 2,
      businessUnit: "rt_solutions",
      offerCode: "RTS-QUICK-WEBSITE-SPRINT",
      pipelineStage: "proposal",
      companyName: "Acme Co",
      leadName: "Jordan",
      founderName: "Marcus",
      businessName: "RT Solutions",
      primaryService: "rapid web launches",
    });

    expect(plan.subject).toContain("proof point");
    expect(plan.html).toContain("Offer CTA");
    expect(plan.nextStep.toLowerCase()).toContain("deposit");
  });
});
