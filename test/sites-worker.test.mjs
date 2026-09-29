import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { applyRuntimeEnv } from '../dashboard/api/worker.mjs';

test('applyRuntimeEnv copies only declared string runtime variables', () => {
  delete process.env.NOTION_TOKEN;
  delete process.env.SLACK_TOKEN;
  process.env.UNRELATED_SECRET = 'keep';

  applyRuntimeEnv({
    NOTION_TOKEN: 'notion',
    SLACK_TOKEN: 'slack',
    ASSETS: { fetch() {} },
    EXTRA_BINDING: 'ignore-me',
  });

  assert.equal(process.env.NOTION_TOKEN, 'notion');
  assert.equal(process.env.SLACK_TOKEN, 'slack');
  assert.equal(process.env.EXTRA_BINDING, undefined);
  assert.equal(process.env.ASSETS, undefined);
  assert.equal(process.env.UNRELATED_SECRET, 'keep');
});

test('Given a request to collect from the Site, When the worker handles it, Then it refuses and points to the routine', async () => {
  for (const [path, method] of [['/api/refresh', 'POST'], ['/api/cron/collect', 'GET']]) {
    const response = await worker.fetch(new Request(`https://site.test${path}`, { method }), {});
    assert.equal(response.status, 410, path);
    assert.match((await response.json()).message, /아침 루틴/);
  }
});
