import { describe, expect, it } from "vitest";
import { buildCandidateMeetingSlotsInTimeZone } from "@/lib/calendar/slot-search";

function getLocalParts(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const map = new Map(parts.map((p) => [p.type, p.value]));
  return {
    weekday: map.get("weekday") || "",
    hour: Number.parseInt(map.get("hour") || "0", 10),
    minute: Number.parseInt(map.get("minute") || "0", 10),
  };
}

describe("buildCandidateMeetingSlotsInTimeZone", () => {
  it("generates sorted business-hour slots in the target timezone", () => {
    const timeZone = "America/Chicago";
    const slots = buildCandidateMeetingSlotsInTimeZone({
      now: new Date("2026-03-06T16:00:00Z"),
      timeZone,
      leadTimeDays: 2,
      slotMinutes: 30,
      businessStartHour: 9,
      businessEndHour: 17,
      searchDays: 4,
      maxSlots: 20,
      anchorHour: 14,
    });

    expect(slots.length).toBeGreaterThan(0);

    for (let i = 1; i < slots.length; i++) {
      expect(slots[i]!.getTime()).toBeGreaterThanOrEqual(slots[i - 1]!.getTime());
    }

    for (const slot of slots) {
      const local = getLocalParts(slot, timeZone);
      expect(local.weekday).not.toBe("Sat");
      expect(local.weekday).not.toBe("Sun");
      const minutes = local.hour * 60 + local.minute;
      expect(minutes).toBeGreaterThanOrEqual(9 * 60);
      expect(minutes).toBeLessThanOrEqual(16 * 60 + 30);
    }
  });

  it("throws for invalid IANA time zone", () => {
    expect(() =>
      buildCandidateMeetingSlotsInTimeZone({
        timeZone: "Invalid/Zone",
      })
    ).toThrow();
  });

  it("can include weekend slots when explicitly enabled", () => {
    const timeZone = "America/Chicago";
    const slots = buildCandidateMeetingSlotsInTimeZone({
      now: new Date("2026-03-06T16:00:00Z"), // Friday morning local
      timeZone,
      leadTimeDays: 1,
      slotMinutes: 30,
      businessStartHour: 9,
      businessEndHour: 17,
      searchDays: 2,
      maxSlots: 12,
      anchorHour: 10,
      includeWeekends: true,
    });

    expect(slots.length).toBeGreaterThan(0);
    const weekdays = new Set(slots.map((slot) => getLocalParts(slot, timeZone).weekday));
    expect(weekdays.has("Sat") || weekdays.has("Sun")).toBe(true);
  });
});
