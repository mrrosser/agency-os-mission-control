import { describe, expect, it } from "vitest";
import { parseRequestedStart } from "@/lib/voice/action-worker";

describe("voice action worker date parsing", () => {
  it("parses ISO-like date and time", () => {
    const parsed = parseRequestedStart("Please schedule 2026-03-18 3:30pm", new Date("2026-03-10T12:00:00Z"));
    expect(parsed?.toISOString()).toBe("2026-03-18T15:30:00.000Z");
  });

  it("parses US date format", () => {
    const parsed = parseRequestedStart("Book 03/20/2026 11:15 am");
    expect(parsed?.toISOString()).toBe("2026-03-20T11:15:00.000Z");
  });

  it("handles tomorrow with meridiem time", () => {
    const parsed = parseRequestedStart("Can we do tomorrow at 2pm?", new Date("2026-03-10T08:00:00Z"));
    expect(parsed?.toISOString()).toBe("2026-03-11T14:00:00.000Z");
  });

  it("returns null for unstructured transcript", () => {
    expect(parseRequestedStart("Sometime next week maybe")).toBeNull();
  });

  it("interprets explicit date/time in requested business timezone", () => {
    const parsed = parseRequestedStart("Please schedule 2026-03-18 3:30pm", {
      now: new Date("2026-03-10T12:00:00Z"),
      timeZone: "America/Chicago",
    });
    expect(parsed?.toISOString()).toBe("2026-03-18T20:30:00.000Z");
  });

  it("interprets tomorrow relative to business-local date", () => {
    const parsed = parseRequestedStart("Can we do tomorrow at 2pm?", {
      now: new Date("2026-03-10T23:30:00.000Z"),
      timeZone: "America/Chicago",
    });
    expect(parsed?.toISOString()).toBe("2026-03-11T19:00:00.000Z");
  });
});
