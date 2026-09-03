import assert from 'node:assert/strict';
import test from 'node:test';
import { createExpiringCache } from '../lib/expiring-cache.mjs';

test('Given a dashboard cache, When its TTL has not elapsed, Then repeated reads reuse the same snapshot', () => {
  let time = 1_000;
  const cache = createExpiringCache({ ttlMs: 60_000, now: () => time });
  const dashboard = { generatedAt: '2026-09-03T00:00:00.000Z' };

  assert.equal(cache.get(), null);
  assert.equal(cache.set(dashboard), dashboard);
  time += 59_999;
  assert.equal(cache.get(), dashboard);
  time += 1;
  assert.equal(cache.get(), null);
});
