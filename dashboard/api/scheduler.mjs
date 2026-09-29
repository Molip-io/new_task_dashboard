export function zonedClock(now = new Date(), timeZone = 'Asia/Seoul') {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return { day: `${values.year}-${values.month}-${values.day}`, time: `${values.hour}:${values.minute}` };
}

export function shouldRunDaily({ now = new Date(), timeZone = 'Asia/Seoul', scheduleTime, lastRunDay }) {
  const clock = zonedClock(now, timeZone);
  return { ...clock, shouldRun: clock.time >= scheduleTime && clock.day !== lastRunDay };
}
