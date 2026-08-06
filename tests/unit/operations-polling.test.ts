import { describe, expect, it } from "vitest";
import {
  isTerminalLeadRunStatus,
  shouldRefreshRunReceipts,
  type LeadRunPollSnapshot,
} from "@/lib/operations/polling";

const running: LeadRunPollSnapshot = {
  runId: "run-1",
  status: "running",
  nextIndex: 2,
};

describe("operations polling", () => {
  it("refreshes receipts only when a run first appears or makes progress", () => {
    expect(shouldRefreshRunReceipts(null, running)).toBe(true);
    expect(shouldRefreshRunReceipts(running, { ...running })).toBe(false);
    expect(shouldRefreshRunReceipts(running, { ...running, nextIndex: 3 })).toBe(true);
  });

  it("refreshes when status or run identity changes", () => {
    expect(shouldRefreshRunReceipts(running, { ...running, status: "completed" })).toBe(true);
    expect(shouldRefreshRunReceipts(running, { ...running, runId: "run-2" })).toBe(true);
  });

  it("recognizes terminal statuses without treating paused jobs as terminal", () => {
    expect(isTerminalLeadRunStatus("completed")).toBe(true);
    expect(isTerminalLeadRunStatus("FAILED")).toBe(true);
    expect(isTerminalLeadRunStatus("paused")).toBe(false);
  });
});
