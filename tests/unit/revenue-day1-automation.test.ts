import { describe, expect, it } from "vitest";
import { buildDay1JobConfig, buildDay1RunId } from "@/lib/revenue/day1-automation";

describe("revenue day1 automation helpers", () => {
  it("builds deterministic day1 run ids", () => {
    const first = buildDay1RunId({
      uid: "user-1",
      templateId: "rt-template",
      dateKey: "2026-02-24",
    });
    const second = buildDay1RunId({
      uid: "user-1",
      templateId: "rt-template",
      dateKey: "2026-02-24",
    });
    const differentDate = buildDay1RunId({
      uid: "user-1",
      templateId: "rt-template",
      dateKey: "2026-02-25",
    });

    expect(first).toBe(second);
    expect(first).toContain("day1-2026-02-24-");
    expect(differentDate).not.toBe(first);
  });

  it("maps outreach config into lead run job config", () => {
    const config = buildDay1JobConfig({
      businessUnit: "rt_solutions",
      offerCode: "RTS-QUICK-WEBSITE-SPRINT",
      dryRun: true,
      timeZone: "America/Chicago",
      outreach: {
        draftFirst: false,
        useAvatar: true,
        useSMS: true,
        useOutboundCall: true,
      },
    });

    expect(config.businessUnit).toBe("rt_solutions");
    expect(config.businessKey).toBe("rts");
    expect(config.offerCode).toBe("RTS-QUICK-WEBSITE-SPRINT");
    expect(config.timeZone).toBe("America/Chicago");
    expect(config.dryRun).toBe(true);
    expect(config.draftFirst).toBe(false);
    expect(config.useAvatar).toBe(true);
    expect(config.useSMS).toBe(true);
    expect(config.useOutboundCall).toBe(true);
  });
});
