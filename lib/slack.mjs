const API = 'https://slack.com/api';

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
        replies: m.reply_count || 0,
        reactions: (m.reactions || []).reduce((a, r) => a + r.count, 0),
      });
    }
    cursor = res.response_metadata?.next_cursor || null;
  } while (cursor);
  messages.sort((a, b) => a.ts.localeCompare(b.ts));
  return { channel: channelName, messages };
}
