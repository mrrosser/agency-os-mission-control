import { describe, expect, it } from "vitest";
import { pickFirstAvailableStart, rangesOverlap, type BusyRange } from "@/lib/calendar/availability";

describe("rangesOverlap", () => {
  it("returns true when ranges overlap", () => {
    const aStart = new Date("2026-02-12T10:00:00Z");
    const aEnd = new Date("2026-02-12T10:30:00Z");
    const bStart = new Date("2026-02-12T10:15:00Z");
    const bEnd = new Date("2026-02-12T10:45:00Z");
    expect(rangesOverlap(aStart, aEnd, bStart, bEnd)).toBe(true);
  });

  it("returns false when ranges only touch at edges", () => {
    const aStart = new Date("2026-02-12T10:00:00Z");
    const aEnd = new Date("2026-02-12T10:30:00Z");
    const bStart = new Date("2026-02-12T10:30:00Z");
    const bEnd = new Date("2026-02-12T11:00:00Z");
    expect(rangesOverlap(aStart, aEnd, bStart, bEnd)).toBe(false);
  });
});

describe("pickFirstAvailableStart", () => {
  it("returns the first candidate that does not overlap busy ranges", () => {
    const busy: BusyRange[] = [
      { start: new Date("2026-02-12T10:00:00Z"), end: new Date("2026-02-12T11:00:00Z") },
    ];

    const candidates = [
      new Date("2026-02-12T10:30:00Z"), // overlaps
      new Date("2026-02-12T11:00:00Z"), // ok (touching edge)
      new Date("2026-02-12T11:30:00Z"), // ok
    ];

    const picked = pickFirstAvailableStart(candidates, 30, busy);
    expect(picked?.start.toISOString()).toBe("2026-02-12T11:00:00.000Z");
    expect(picked?.end.toISOString()).toBe("2026-02-12T11:30:00.000Z");
    expect(picked?.checked).toBe(2);
  });

  it("returns null when all candidates overlap busy ranges", () => {
    const busy: BusyRange[] = [
      { start: new Date("2026-02-12T10:00:00Z"), end: new Date("2026-02-12T12:00:00Z") },
    ];
    const candidates = [
      new Date("2026-02-12T10:00:00Z"),
      new Date("2026-02-12T11:00:00Z"),
    ];

    expect(pickFirstAvailableStart(candidates, 30, busy)).toBeNull();
  });
});

