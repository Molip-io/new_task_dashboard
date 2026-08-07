const API = 'https://slack.com/api';
import { extractPersistentContexts, hasPersistentContextHint } from './slack-context.mjs';

export function slackMessageUrl(channelId, ts, threadTs = null) {
  const messageTs = String(ts || '').replace('.', '');
  if (!channelId || !messageTs) return null;
  const base = `https://slack.com/archives/${encodeURIComponent(channelId)}/p${messageTs}`;
  return threadTs
    ? `${base}?thread_ts=${encodeURIComponent(threadTs)}&cid=${encodeURIComponent(channelId)}`
    : base;
}

async function call(method, params = {}) {
  const qs = new URLSearchParams(params);
  const res = await fetch(`${API}/${method}?${qs}`, {
    headers: { Authorization: `Bearer ${process.env.SLACK_TOKEN}` },
  });
  const json = await res.json();
  if (!json.ok) {
    if (json.error === 'ratelimited') {
      await new Promise(r => setTimeout(r, 30_000));
      return call(method, params);
    }
    throw new Error(`Slack ${method}: ${json.error}`);
  }
  return json;
}

let channelMap = null; // name → id
export async function getChannelId(name) {
  if (!channelMap) {
    channelMap = new Map();
    let cursor;
    do {
      const res = await call('conversations.list', {
        types: 'public_channel,private_channel', limit: 200,
        ...(cursor ? { cursor } : {}),
      });
      for (const c of res.channels) channelMap.set(c.name, c.id);
      cursor = res.response_metadata?.next_cursor || null;
    } while (cursor);
  }
  return channelMap.get(name) || null;
}

let userMap = null; // id → display name
async function userName(id) {
  if (!userMap) {
    userMap = new Map();
    let cursor;
    do {
      const res = await call('users.list', { limit: 200, ...(cursor ? { cursor } : {}) });
      for (const u of res.members) userMap.set(u.id, u.profile?.display_name || u.real_name || u.name);
      cursor = res.response_metadata?.next_cursor || null;
    } while (cursor);
  }
  return userMap.get(id) || id;
}

async function threadReplies(channelId, parent) {
  const replies = [];
  let cursor;
  do {
    const res = await call('conversations.replies', {
      channel: channelId, ts: parent.ts, limit: 200, ...(cursor ? { cursor } : {}),
    });
    for (const message of res.messages || []) {
      if (message.ts === parent.ts || message.subtype || !message.text) continue;
      replies.push({
        ts: message.ts,
        time: new Date(Number(message.ts) * 1000).toISOString(),
        user: await userName(message.user),
        text: message.text.slice(0, 600),
        parentText: parent.text,
        threadTs: parent.ts,
        url: slackMessageUrl(channelId, message.ts, parent.ts),
        replies: 0,
        reactions: (message.reactions || []).reduce((total, reaction) => total + reaction.count, 0),
      });
    }
    cursor = res.response_metadata?.next_cursor || null;
  } while (cursor);
  return replies;
}

async function channelParents(channelId, oldest) {
  const messages = [];
  let cursor;
  do {
    const res = await call('conversations.history', {
      channel: channelId, oldest, limit: 200, ...(cursor ? { cursor } : {}),
    });
    for (const m of res.messages) {
      if (m.subtype || !m.text) continue;
      messages.push({
        ts: m.ts,
        time: new Date(Number(m.ts) * 1000).toISOString(),
        user: await userName(m.user),
        text: m.text.slice(0, 600),
        url: slackMessageUrl(channelId, m.ts),
        replies: m.reply_count || 0,
        reactions: (m.reactions || []).reduce((a, r) => a + r.count, 0),
      });
    }
    cursor = res.response_metadata?.next_cursor || null;
  } while (cursor);
  return messages;
}

// Fetches the normal recent window and a separate, small historical context set.
// Historical replies are loaded only for parents that contain workflow signals.
export async function channelHistoryWithContext(channelName, recentDays, historicalDays = 45, projectName = null) {
  const id = await getChannelId(channelName);
  if (!id) return { channel: channelName, error: 'channel_not_found', messages: [], persistentContexts: [] };
  const now = Date.now();
  const recentCutoff = now - Number(recentDays || 0) * 86400_000;
  const historicalCutoff = now - Number(historicalDays || 45) * 86400_000;
  const parents = await channelParents(id, (historicalCutoff / 1000).toFixed(0));
  const recentParents = parents.filter(message => Date.parse(message.time) >= recentCutoff);
  const historicalParents = parents.filter(message => Date.parse(message.time) < recentCutoff && hasPersistentContextHint(message.text));
  const recentReplies = [];
  for (const message of recentParents.filter(item => item.replies > 0)) recentReplies.push(...await threadReplies(id, message));
  const historicalReplies = [];
  const historicalWarnings = [];
  for (const message of historicalParents.filter(item => item.replies > 0)) {
    try { historicalReplies.push(...await threadReplies(id, message)); }
    catch (error) { historicalWarnings.push(error.message); }
  }
  const recentMessages = [...recentParents, ...recentReplies].sort((a, b) => a.ts.localeCompare(b.ts));
  const historicalMessages = [...historicalParents, ...historicalReplies].sort((a, b) => a.ts.localeCompare(b.ts));
  return {
    channel: channelName,
    messages: recentMessages,
    persistentContexts: extractPersistentContexts({
      channel: channelName,
      messages: historicalMessages,
      recentDays: 0,
      projectName,
      now: Date.now() + 1,
    }),
    historicalWarnings,
  };
}

// 최근 N일 채널 메시지 (스레드 원문만, 봇/시스템 메시지 제외)
export async function channelHistory(channelName, days) {
  const id = await getChannelId(channelName);
  if (!id) return { channel: channelName, error: 'channel_not_found', messages: [] };
  const oldest = (Date.now() / 1000 - days * 86400).toFixed(0);
  const messages = [];
  let cursor;
  do {
    const res = await call('conversations.history', {
      channel: id, oldest, limit: 200, ...(cursor ? { cursor } : {}),
    });
    for (const m of res.messages) {
      if (m.subtype || !m.text) continue;
      messages.push({
        ts: m.ts,
        time: new Date(Number(m.ts) * 1000).toISOString(),
        user: await userName(m.user),
        text: m.text.slice(0, 600),
        url: slackMessageUrl(id, m.ts),
        replies: m.reply_count || 0,
        reactions: (m.reactions || []).reduce((a, r) => a + r.count, 0),
      });
    }
    cursor = res.response_metadata?.next_cursor || null;
  } while (cursor);
  const replies = [];
  for (const message of messages.filter(item => item.replies > 0)) {
    replies.push(...await threadReplies(id, message));
  }
  messages.push(...replies);
  messages.sort((a, b) => a.ts.localeCompare(b.ts));
  return { channel: channelName, messages };
}
