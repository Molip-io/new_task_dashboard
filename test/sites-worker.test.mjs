import test from 'node:test';
import assert from 'node:assert/strict';
import { applyRuntimeEnv } from '../sites/worker.mjs';

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
