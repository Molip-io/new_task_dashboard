import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const config = JSON.parse(fs.readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));

test('Given the legacy Next.js project, When this dashboard deploys, Then the framework is explicitly overridden', () => {
  assert.equal(config.framework, null);
  assert.equal(config.routes.at(-1).dest, '/api/app.mjs');
});

test('Given the local long-running scheduler, When deployed to Vercel, Then collection uses a platform cron', () => {
  assert.deepEqual(config.crons, [{ path: '/api/cron/collect', schedule: '30 22 * * *' }]);
  assert.equal(config.functions['api/app.mjs'].maxDuration, 300);
});
