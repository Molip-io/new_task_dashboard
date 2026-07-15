import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldRunDaily, zonedClock } from '../lib/scheduler.mjs';

test('Given a UTC server clock, When converted for scheduling, Then Seoul time controls the collection day', () => {
  assert.deepEqual(zonedClock(new Date('2026-07-15T22:45:00Z')), { day: '2026-07-16', time: '07:45' });
});

test('Given the server starts after the morning time, When today has not run, Then collection catches up once', () => {
  const first = shouldRunDaily({ now: new Date('2026-07-15T00:40:00Z'), scheduleTime: '07:30', lastRunDay: '2026-07-14' });
  const second = shouldRunDaily({ now: new Date('2026-07-15T01:00:00Z'), scheduleTime: '07:30', lastRunDay: '2026-07-15' });
  assert.equal(first.shouldRun, true);
  assert.equal(second.shouldRun, false);
});
