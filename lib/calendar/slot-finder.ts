export interface MeetingSlotOptions {
  now?: Date;
  leadTimeDays?: number;
  slotMinutes?: number;
  businessStartHour?: number;
  businessEndHour?: number;
  searchDays?: number;
  maxSlots?: number;
}

function isWeekend(date: Date): boolean {
  const day = date.getDay();
  return day === 0 || day === 6;
}

function cloneDate(date: Date): Date {
  return new Date(date.getTime());
}

function roundUpToSlot(date: Date, slotMinutes: number): Date {
  const rounded = cloneDate(date);
  const minute = rounded.getMinutes();
  const remainder = minute % slotMinutes;
  if (remainder !== 0) {
    rounded.setMinutes(minute + (slotMinutes - remainder), 0, 0);
  } else {
    rounded.setSeconds(0, 0);
  }
  return rounded;
}

/**
 * Build candidate meeting starts during business hours, starting ~2 days out at 2pm.
 * The caller can test each candidate against calendar availability and pick the first match.
 */
export function buildCandidateMeetingSlots(options: MeetingSlotOptions = {}): Date[] {
  const now = options.now ? cloneDate(options.now) : new Date();
  const leadTimeDays = options.leadTimeDays ?? 2;
  const slotMinutes = options.slotMinutes ?? 30;
  const businessStartHour = options.businessStartHour ?? 9;
  const businessEndHour = options.businessEndHour ?? 17;
  const searchDays = options.searchDays ?? 7;
  const maxSlots = options.maxSlots ?? 40;

  const anchor = cloneDate(now);
  anchor.setDate(anchor.getDate() + leadTimeDays);
  anchor.setHours(14, 0, 0, 0);

  while (isWeekend(anchor)) {
    anchor.setDate(anchor.getDate() + 1);
  }

  const slots: Date[] = [];

  for (let dayOffset = 0; dayOffset <= searchDays && slots.length < maxSlots; dayOffset++) {
    const day = cloneDate(anchor);
    day.setDate(anchor.getDate() + dayOffset);

    if (isWeekend(day)) continue;

    const dayStart = cloneDate(day);
    dayStart.setHours(businessStartHour, 0, 0, 0);

    const dayLastStart = cloneDate(day);
    dayLastStart.setHours(businessEndHour, 0, 0, 0);
    dayLastStart.setMinutes(dayLastStart.getMinutes() - slotMinutes);

    let firstSlot = dayStart;
    if (dayOffset === 0 && anchor > dayStart) {
      firstSlot = roundUpToSlot(anchor, slotMinutes);
    }

    if (firstSlot > dayLastStart) {
      continue;
    }

    for (
      let slot = cloneDate(firstSlot);
      slot <= dayLastStart && slots.length < maxSlots;
      slot = new Date(slot.getTime() + slotMinutes * 60 * 1000)
    ) {
      if (slot > now) {
        slots.push(cloneDate(slot));
      }
    }
  }

  return slots;
}

