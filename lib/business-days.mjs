const SEOUL_TIME_ZONE = 'Asia/Seoul';
const DAY_MS = 86_400_000;

export function kstDate(value = new Date()) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: SEOUL_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function dayNumber(value) {
  const date = kstDate(value);
  return date ? Math.floor(Date.parse(`${date}T00:00:00Z`) / DAY_MS) : null;
}

export function calendarDaysBetween(start, end) {
  const from = dayNumber(start);
  const to = dayNumber(end);
  if (from === null || to === null || to <= from) return 0;
  return to - from;
}

export function businessDaysBetween(start, end) {
  const from = dayNumber(start);
  const to = dayNumber(end);
  if (from === null || to === null || to <= from) return 0;
  let count = 0;
  for (let day = from + 1; day <= to; day += 1) {
    const weekday = new Date(day * DAY_MS).getUTCDay();
    if (weekday !== 0 && weekday !== 6) count += 1;
  }
  return count;
}

export function isKoreanBusinessDay(value = new Date()) {
  const day = dayNumber(value);
  if (day === null) return false;
  const weekday = new Date(day * DAY_MS).getUTCDay();
  return weekday !== 0 && weekday !== 6;
}
