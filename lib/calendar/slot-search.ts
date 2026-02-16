export interface SlotSearchOptions {
  now?: Date;
  timeZone: string;
  leadTimeDays?: number;
  slotMinutes?: number;
  businessStartHour?: number;
  businessEndHour?: number;
  searchDays?: number;
  maxSlots?: number;
  anchorHour?: number;
  includeWeekends?: boolean;
}

interface DateParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function cloneDate(date: Date): Date {
  return new Date(date.getTime());
}

function parseIntPart(value: string): number {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : 0;
}

function getTimeZoneDateParts(date: Date, timeZone: string): DateParts {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const parts = formatter.formatToParts(date);
  const map = new Map(parts.map((p) => [p.type, p.value]));
  return {
    year: parseIntPart(map.get("year") || ""),
    month: parseIntPart(map.get("month") || ""),
    day: parseIntPart(map.get("day") || ""),
    hour: parseIntPart(map.get("hour") || ""),
    minute: parseIntPart(map.get("minute") || ""),
    second: parseIntPart(map.get("second") || ""),
  };
}

function timeZoneOffsetMs(date: Date, timeZone: string): number {
  const parts = getTimeZoneDateParts(date, timeZone);
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );
  return asUtc - date.getTime();
}

function zonedDateTimeToUtc(parts: DateParts, timeZone: string): Date {
  const utcGuess = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );
  const offsetFirst = timeZoneOffsetMs(new Date(utcGuess), timeZone);
  const firstPass = utcGuess - offsetFirst;
  const offsetSecond = timeZoneOffsetMs(new Date(firstPass), timeZone);
  const finalMs = utcGuess - offsetSecond;
  return new Date(finalMs);
}

function dayOfWeekFromYmd(year: number, month: number, day: number): number {
  // Weekday from Gregorian date (0=Sunday..6=Saturday).
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function isWeekend(year: number, month: number, day: number): boolean {
  const dow = dayOfWeekFromYmd(year, month, day);
  return dow === 0 || dow === 6;
}

function addDays(year: number, month: number, day: number, days: number): {
  year: number;
  month: number;
  day: number;
} {
  const dt = new Date(Date.UTC(year, month - 1, day));
  dt.setUTCDate(dt.getUTCDate() + days);
  return {
    year: dt.getUTCFullYear(),
    month: dt.getUTCMonth() + 1,
    day: dt.getUTCDate(),
  };
}

function roundUpToSlot(minutes: number, slotMinutes: number): number {
  const remainder = minutes % slotMinutes;
  if (remainder === 0) return minutes;
  return minutes + (slotMinutes - remainder);
}

/**
 * Server-safe slot generation using an explicit IANA timezone.
 * Returns UTC Dates suitable for Google Calendar API calls.
 */
export function buildCandidateMeetingSlotsInTimeZone(
  options: SlotSearchOptions
): Date[] {
  const now = options.now ? cloneDate(options.now) : new Date();
  const timeZone = options.timeZone;
  const leadTimeDays = options.leadTimeDays ?? 2;
  const slotMinutes = options.slotMinutes ?? 30;
  const businessStartHour = options.businessStartHour ?? 9;
  const businessEndHour = options.businessEndHour ?? 17;
  const searchDays = options.searchDays ?? 7;
  const maxSlots = options.maxSlots ?? 40;
  const anchorHour = options.anchorHour ?? 14;
  const includeWeekends = options.includeWeekends ?? false;

  // Validate timezone up-front with Intl.
  // Throws a RangeError for invalid IANA values.
  Intl.DateTimeFormat("en-US", { timeZone });

  const nowParts = getTimeZoneDateParts(now, timeZone);
  let anchor = addDays(nowParts.year, nowParts.month, nowParts.day, leadTimeDays);
  while (!includeWeekends && isWeekend(anchor.year, anchor.month, anchor.day)) {
    anchor = addDays(anchor.year, anchor.month, anchor.day, 1);
  }

  const slots: Date[] = [];
  const startMinuteBase = businessStartHour * 60;
  const lastStartMinute = businessEndHour * 60 - slotMinutes;
  const anchorMinute = anchorHour * 60;

  for (let dayOffset = 0; dayOffset <= searchDays && slots.length < maxSlots; dayOffset++) {
    const ymd = addDays(anchor.year, anchor.month, anchor.day, dayOffset);
    if (!includeWeekends && isWeekend(ymd.year, ymd.month, ymd.day)) continue;

    let firstMinute = startMinuteBase;
    if (dayOffset === 0) {
      firstMinute = Math.max(firstMinute, roundUpToSlot(anchorMinute, slotMinutes));
    }

    if (firstMinute > lastStartMinute) continue;

    for (
      let minuteOfDay = firstMinute;
      minuteOfDay <= lastStartMinute && slots.length < maxSlots;
      minuteOfDay += slotMinutes
    ) {
      const slot = zonedDateTimeToUtc(
        {
          year: ymd.year,
          month: ymd.month,
          day: ymd.day,
          hour: Math.floor(minuteOfDay / 60),
          minute: minuteOfDay % 60,
          second: 0,
        },
        timeZone
      );

      if (slot > now) {
        slots.push(slot);
      }
    }
  }

  slots.sort((a, b) => a.getTime() - b.getTime());
  return slots.slice(0, maxSlots);
}
