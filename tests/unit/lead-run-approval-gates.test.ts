import { describe, expect, it } from "vitest";
import {
  enforceLeadRunApprovalGates,
  hasUngatedLeadRunActions,
  type LeadRunJobConfig,
} from "@/lib/lead-runs/jobs";

describe("lead-run approval gates", () => {
  it("forces legacy unsafe provider flags to draft-only", () => {
    const requested: LeadRunJobConfig = {
      dryRun: false,
      draftFirst: false,
      requireBookingConfirmation: false,
      timeZone: "America/Chicago",
      useSMS: true,
      useAvatar: true,
      useOutboundCall: true,
      businessKey: "rng",
      businessUnit: "rosser_nft_gallery",
    };

    expect(hasUngatedLeadRunActions(requested)).toBe(true);
    expect(enforceLeadRunApprovalGates(requested)).toMatchObject({
      dryRun: false,
      draftFirst: true,
      requireBookingConfirmation: true,
      useSMS: false,
      useAvatar: false,
      useOutboundCall: false,
    });
  });
});
