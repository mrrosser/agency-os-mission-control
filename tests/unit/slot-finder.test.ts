import { describe, expect, it } from "vitest";
import { buildCandidateMeetingSlots } from "@/lib/calendar/slot-finder";

function getDateForWeekday(targetWeekday: number): Date {
  const date = new Date(2026, 0, 1, 10, 0, 0, 0);
  while (date.getDay() !== targetWeekday) {
    date.setDate(date.getDate() + 1);
  }
  return date;
}

describe("buildCandidateMeetingSlots", () => {
  it("starts at 2pm by default on the anchor day", () => {
    const now = getDateForWeekday(1); // Monday
    const slots = buildCandidateMeetingSlots({
      now,
      leadTimeDays: 2,
      searchDays: 1,
      maxSlots: 4,
    });

    expect(slots.length).toBeGreaterThan(0);
    expect(slots[0].getDay()).toBe(3); // Wednesday
    expect(slots[0].getHours()).toBe(14);
    expect(slots[0].getMinutes()).toBe(0);
  });

  it("skips weekends and returns the next business day slot", () => {
    const now = getDateForWeekday(6); // Saturday
    now.setHours(8, 0, 0, 0);

    const slots = buildCandidateMeetingSlots({
      now,
      leadTimeDays: 0,
      searchDays: 3,
      maxSlots: 6,
    });

    expect(slots.length).toBeGreaterThan(0);
    expect(slots[0].getDay()).toBe(1); // Monday
    expect(slots[0].getHours()).toBe(14);
  });

  it("respects maxSlots and business-hour boundaries", () => {
    const now = getDateForWeekday(2); // Tuesday
    now.setHours(8, 0, 0, 0);

    const slots = buildCandidateMeetingSlots({
      now,
      leadTimeDays: 0,
      searchDays: 7,
      maxSlots: 5,
      businessStartHour: 9,
      businessEndHour: 17,
      slotMinutes: 30,
    });

    expect(slots).toHaveLength(5);
    for (const slot of slots) {
      expect(slot.getHours()).toBeGreaterThanOrEqual(9);
      expect(slot.getHours()).toBeLessThanOrEqual(16);
      expect([0, 30]).toContain(slot.getMinutes());
    }
  });
});

