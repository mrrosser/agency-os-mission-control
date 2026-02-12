export interface BusyRange {
  start: Date;
  end: Date;
}

function isValidDate(date: Date): boolean {
  return !Number.isNaN(date.valueOf());
}

export function rangesOverlap(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  if (!isValidDate(aStart) || !isValidDate(aEnd) || !isValidDate(bStart) || !isValidDate(bEnd)) {
    throw new Error("Invalid date provided to rangesOverlap");
  }

  // Overlap if ranges intersect with non-zero length.
  return aStart < bEnd && aEnd > bStart;
}

export function pickFirstAvailableStart(
  candidateStarts: Date[],
  durationMinutes: number,
  busy: BusyRange[]
): { start: Date; end: Date; checked: number } | null {
  if (!Number.isInteger(durationMinutes) || durationMinutes <= 0) {
    throw new Error("durationMinutes must be a positive integer");
  }

  const durationMs = durationMinutes * 60 * 1000;
  let checked = 0;

  for (const start of candidateStarts) {
    checked += 1;
    if (!isValidDate(start)) continue;

    const end = new Date(start.getTime() + durationMs);
    if (!isValidDate(end)) continue;

    const conflicts = busy.some((range) => rangesOverlap(start, end, range.start, range.end));
    if (!conflicts) {
      return { start, end, checked };
    }
  }

  return null;
}

