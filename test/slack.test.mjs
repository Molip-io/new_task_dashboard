import assert from 'node:assert/strict';
import test from 'node:test';

import { slackMessageUrl } from '../lib/slack.mjs';

test('Given a Slack message and thread reply, When source URLs are built, Then each link preserves its channel and thread context', () => {
  assert.equal(
    slackMessageUrl('C123', '1720000000.123456'),
    'https://slack.com/archives/C123/p1720000000123456',
  );
  assert.equal(
    slackMessageUrl('C123', '1720000001.654321', '1720000000.123456'),
    'https://slack.com/archives/C123/p1720000001654321?thread_ts=1720000000.123456&cid=C123',
  );
});
