import assert from 'node:assert/strict';
import test from 'node:test';
import { businessDaysBetween, calendarDaysBetween, kstDate } from '../lib/business-days.mjs';

test('Given a Friday update, When checked on Monday in Seoul, Then one business day has elapsed', () => {
  assert.equal(businessDaysBetween('2026-07-10T09:00:00+09:00', '2026-07-13T18:00:00+09:00'), 1);
});

test('Given a UTC instant near midnight, When converted to Seoul, Then the KST calendar date is used', () => {
  assert.equal(kstDate('2026-07-14T16:30:00Z'), '2026-07-15');
});

test('Given an overdue date, When calendar days are counted, Then weekends remain part of the delay', () => {
  assert.equal(calendarDaysBetween('2026-07-10', '2026-07-13'), 3);
});
