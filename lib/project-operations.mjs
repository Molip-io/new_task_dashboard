import { classifyExecutionAttention } from './execution-attention.mjs';

const PATTERNS = Object.freeze({
  release: /(배포|릴리즈|출시|서밋|스토어|마켓\s*업로드|자동\s*출시|롤아웃|release|submit)/i,
  qa: /(qa|fun\s*qa|funqa|디렉터\s*리뷰|품질\s*검증)/i,
  build: /(빌드|apk|aab|testflight|aos|ios|빌드버전|빌드코드|build)/i,
  data: /(데이터|지표|cpi|리텐션|retention|퍼널|funnel|d1|d7|roas|ltv|arpu|분석|tracking\s*plan|통계)/i,
});

const CATEGORY_LABELS = Object.freeze({ build: '빌드', qa: 'QA/리뷰', release: '배포/출시', data: '데이터' });

function stripSlack(value) {
  return String(value || '')
    .replace(/<https?:\/\/[^>|]+\|([^>]+)>/g, '$1')
    .replace(/<https?:\/\/[^>]+>/g, '')
    .replace(/<@[^>]+>/g, '담당자')
    .replace(/<![^>|]+\|([^>]+)>/g, '$1')
    .replace(/[*_~`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function excerpt(value, limit = 280) {
  const text = stripSlack(value);
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

function categoriesFor(text) {
  return Object.entries(PATTERNS).filter(([, pattern]) => pattern.test(text)).map(([category]) => category);
}

function eventKey(event) { return event.url || `${event.timestamp || ''}|${event.channel || ''}|${event.excerpt}`; }
function latest(events, category) { return events.find(event => event.categories.includes(category)) || null; }

function evidenceFromEvent(event) {
  if (!event) return null;
  return {
    source: 'slack', evidenceRole: 'project_operation', timestamp: event.timestamp,
    title: `#${event.channel} · ${event.categories.map(category => CATEGORY_LABELS[category]).join(' · ')}`,
    excerpt: event.excerpt, url: event.url,
    attention: event.attention, attentionType: event.attentionType, attentionAction: event.attentionAction,
  };
}

export function buildProjectOperations(slackChannels = []) {
  const collected = [];
  for (const channel of slackChannels || []) {
    for (const message of channel.messages || []) {
      const text = stripSlack([message.parentText || '', message.text || ''].filter(Boolean).join(' · '));
      if (!text) continue;
      const categories = categoriesFor(text);
      if (!categories.length) continue;
      const attention = classifyExecutionAttention(text);
      collected.push({
        timestamp: message.time || null, channel: channel.channel || 'unknown', url: message.url || null,
        excerpt: excerpt(text), categories,
        attention: Boolean(attention), attentionType: attention?.type || null, attentionAction: attention?.action || null,
      });
    }
  }

  const deduped = new Map();
  for (const event of collected.sort((left, right) => String(right.timestamp || '').localeCompare(String(left.timestamp || '')))) {
    const key = eventKey(event);
    if (!deduped.has(key)) deduped.set(key, event);
  }
  const events = [...deduped.values()]
    .sort((left, right) => String(right.timestamp || '').localeCompare(String(left.timestamp || '')))
    .slice(0, 12);

  const latestBuild = latest(events, 'build');
  const latestQa = latest(events, 'qa');
  const latestRelease = latest(events, 'release');
  const latestData = latest(events, 'data');
  const lifecycle = [latestBuild, latestQa, latestRelease].filter(Boolean)
    .sort((left, right) => String(right.timestamp || '').localeCompare(String(left.timestamp || '')))[0] || null;
  const evidence = [latestBuild, latestQa, latestRelease, latestData]
    .filter(Boolean)
    .filter((event, index, rows) => rows.findIndex(candidate => eventKey(candidate) === eventKey(event)) === index)
    .sort((left, right) => String(right.timestamp || '').localeCompare(String(left.timestamp || '')))
    .map(evidenceFromEvent);

  return {
    latestLifecycleSignal: lifecycle ? {
      category: lifecycle.categories.includes('release') ? 'release' : lifecycle.categories.includes('qa') ? 'qa' : 'build',
      timestamp: lifecycle.timestamp, channel: lifecycle.channel, excerpt: lifecycle.excerpt, url: lifecycle.url,
    } : null,
    latestBuild, latestQa, latestRelease, latestData, events, evidence,
    source: 'slack', evidenceCount: events.length,
  };
}
