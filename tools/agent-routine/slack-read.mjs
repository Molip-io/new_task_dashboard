#!/usr/bin/env node
// Read-only Slack access for the analysis agent.
//   node tools/agent-routine/slack-read.mjs history <channel-name> [--days 7]
//   node tools/agent-routine/slack-read.mjs thread <channel-name> <thread_ts>
// Only use channels listed in the input's slackScope.channels.
import { loadEnv } from '../../lib/env.mjs';
import { getChannelId, slackMessageUrl } from '../../lib/slack.mjs';

loadEnv();
const [mode, channelName, threadTs] = process.argv.slice(2);
const daysIndex = process.argv.indexOf('--days');
const days = daysIndex >= 0 ? Number(process.argv[daysIndex + 1]) : 7;

async function call(method, params) {
  const response = await fetch(`https://slack.com/api/${method}?${new URLSearchParams(params)}`, {
    headers: { Authorization: `Bearer ${process.env.SLACK_TOKEN}` },
  });
  const json = await response.json();
  if (!json.ok) throw new Error(`Slack ${method}: ${json.error}`);
  return json;
}

async function paged(method, params, key) {
  const items = [];
  let cursor;
  do {
    const json = await call(method, { ...params, limit: 200, ...(cursor ? { cursor } : {}) });
    items.push(...json[key]);
    cursor = json.response_metadata?.next_cursor || null;
  } while (cursor);
  return items;
}

const line = (channelId, message) => ({
  ts: message.ts,
  at: new Date(Number(message.ts) * 1000).toISOString(),
  user: message.user || message.bot_id || null,
  replies: message.reply_count || 0,
  text: message.text || '',
  url: slackMessageUrl(channelId, message.ts, message.thread_ts && message.thread_ts !== message.ts ? message.thread_ts : null),
});

try {
  if (!process.env.SLACK_TOKEN) throw new Error('SLACK_TOKEN 환경변수가 없습니다.');
  if (!['history', 'thread'].includes(mode) || !channelName) throw new Error('사용법: history <채널명> [--days N] | thread <채널명> <thread_ts>');
  const channelId = /^[CG][A-Z0-9]+$/.test(channelName) ? channelName : await getChannelId(channelName.replace(/^#/, ''));
  if (!channelId) throw new Error(`채널을 찾을 수 없습니다: ${channelName}`);
  const messages = mode === 'history'
    ? await paged('conversations.history', { channel: channelId, oldest: String(Date.now() / 1000 - days * 86400) }, 'messages')
    : await paged('conversations.replies', { channel: channelId, ts: threadTs }, 'messages');
  console.log(JSON.stringify(messages.map(message => line(channelId, message)), null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
