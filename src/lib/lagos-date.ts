/** Nigeria business timezone. WAT is UTC+1 year-round (no DST). */
export const DISPLAY_TIME_ZONE = 'Africa/Lagos';

export function calendarDateInZone(
  date: Date,
  timeZone = DISPLAY_TIME_ZONE,
): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/** Midnight today in Lagos, as an absolute Date. */
export function startOfTodayLagos(): Date {
  const ymd = calendarDateInZone(new Date());
  return new Date(`${ymd}T00:00:00+01:00`);
}
