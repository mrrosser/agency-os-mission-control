import { describe, expect, it } from "vitest";
import {
  buildInitialLeadStageProgress,
  updateLeadStageProgress,
} from "@/lib/lead-runs/stages";

describe("lead run stages", () => {
  it("builds initial stage progress with source/enrich/score complete", () => {
    const progress = buildInitialLeadStageProgress({ includeEnrichment: true });

    expect(progress.currentStage).toBe("outreach");
    expect(progress.stages.source.status).toBe("complete");
    expect(progress.stages.enrich.status).toBe("complete");
    expect(progress.stages.score.status).toBe("complete");
    expect(progress.stages.outreach.status).toBe("pending");
    expect(progress.stages.booking.status).toBe("pending");
  });

  it("marks progress complete after all stages are complete or skipped", () => {
    let progress = buildInitialLeadStageProgress({ includeEnrichment: false });
    progress = updateLeadStageProgress(progress, "outreach", "complete");
    progress = updateLeadStageProgress(progress, "booking", "complete");

    expect(progress.currentStage).toBe("complete");
    expect(progress.stages.enrich.status).toBe("skipped");
  });
});

