import type { Region } from '@prisma/client';

export interface SyncWindowState {
  inWindow: boolean;
  windowStart: string;   // ISO 8601 UTC
  windowEnd: string;     // ISO 8601 UTC
  nextWindowStart: string;
  nextWindowEnd: string;
}

export const REGION_TZ: Record<Region, string> = {
  HK: 'Asia/Hong_Kong',
  BR: 'America/Sao_Paulo',
};

const WINDOW_HOURS = 72;

/**
 * Returns the current and next weekly sync window for a region.
 * Window: Monday 00:00:00 → Wednesday 23:59:59 local time (72 hours).
 */
export function getSyncWindow(region: Region, now?: Date): SyncWindowState {
  const tz = REGION_TZ[region];
  const ref = now ?? new Date();

  const localParts = getLocalParts(ref, tz);

  // dayOfWeek: 0=Sun 1=Mon 2=Tue 3=Wed 4=Thu 5=Fri 6=Sat
  const { year, month, day, dayOfWeek } = localParts;

  // Find this week's Monday (in local time)
  const daysFromMonday = (dayOfWeek + 6) % 7; // Mon=0, Tue=1, ..., Sun=6
  const mondayDay = day - daysFromMonday;

  const windowStart = toUTC(year, month, mondayDay, 0, 0, 0, tz);
  const windowEnd = toUTC(year, month, mondayDay + 2, 23, 59, 59, tz);

  const inWindow = ref >= windowStart && ref <= windowEnd;

  const nextWindowStart = toUTC(year, month, mondayDay + 7, 0, 0, 0, tz);
  const nextWindowEnd = toUTC(year, month, mondayDay + 9, 23, 59, 59, tz);

  return {
    inWindow,
    windowStart: windowStart.toISOString(),
    windowEnd: windowEnd.toISOString(),
    nextWindowStart: nextWindowStart.toISOString(),
    nextWindowEnd: nextWindowEnd.toISOString(),
  };
}

function getLocalParts(date: Date, tz: string) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: false,
  });
  const parts = fmt.formatToParts(date);
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? '';

  const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    year: parseInt(get('year')),
    month: parseInt(get('month')),
    day: parseInt(get('day')),
    dayOfWeek: dayMap[get('weekday')] ?? 0,
    hour: parseInt(get('hour')),
    minute: parseInt(get('minute')),
    second: parseInt(get('second')),
  };
}

/**
 * Build a UTC Date from local date/time components in a given timezone.
 * Handles month/day overflow (e.g. day 34 of January → February 3).
 */
function toUTC(year: number, month: number, day: number, h: number, m: number, s: number, tz: string): Date {
  // Create a rough Date in UTC, then adjust for the timezone offset
  const rough = new Date(Date.UTC(year, month - 1, day, h, m, s));

  // Get the offset at that rough time by comparing UTC representation with local
  const localStr = rough.toLocaleString('en-US', { timeZone: tz, hour12: false });
  const localDate = new Date(localStr + ' UTC');
  const offsetMs = localDate.getTime() - rough.getTime();

  // Subtract the offset to get the true UTC time
  const result = new Date(rough.getTime() - offsetMs);

  // Verify by re-checking (DST transitions can shift by an hour)
  const checkParts = getLocalParts(result, tz);
  if (checkParts.hour !== h) {
    const drift = ((checkParts.hour - h + 24) % 24);
    const correction = drift > 12 ? (drift - 24) : drift;
    return new Date(result.getTime() - correction * 3600_000);
  }

  return result;
}
