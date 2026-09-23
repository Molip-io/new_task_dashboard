import { classifyExecutionAttention } from './execution-attention.mjs';

const PATTERNS = Object.freeze({
  release: /(배포|릴리즈|출시|서밋|스토어|마켓\s*업로드|업로드\s*완료|자동\s*출시|심사|검수\s*제출|롤아웃|release|submit|publish)/i,
  qa: /(qa|fun\s*qa|funqa|테스트|검수|디렉터\s*리뷰|리뷰\s*완료|품질\s*검증|app\s*tester|testflight)/i,
  build: /(빌드|빌드\s*공유|업로드\s*빌드|hotfix|핫픽스|apk|aab|testflight|aos|ios|빌드버전|빌드코드|build)/i,
  data: /(데이터|지표|cpi|리텐션|retention|퍼널|funnel|d1|d7|roas|ltv|arpu|arpdau|\brv\b|rewarded\s*video|보상형\s*광고|a\s*[/／]\s*b|승리\s*그룹|분석|테스트\s*결과|이벤트\s*로그|로그\s*확인|tracking\s*plan|통계)/i,
});

const CATEGORY_LABELS = Object.freeze({ build: '빌드', qa: 'QA/리뷰', release: '배포/출시', data: '데이터' });

// Customer-feedback reports are operational input, but they do not prove a
// build, release, or build KPI.  Their body often contains words such as
// 광고/이슈/출시, so classify them before the broad lifecycle patterns.
const CUSTOMER_FEEDBACK_REPORT = /(일일\s*피드백\s*리포트|daily\s*feedback\s*report|overall\s*summary|총\s*인입수|부정\s*감정\s*비율|critical\s*(?:이슈|issue).*?(?:비중|비율|ratio))/i;

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
  if (CUSTOMER_FEEDBACK_REPORT.test(text)) return [];
  return Object.entries(PATTERNS).filter(([, pattern]) => pattern.test(text)).map(([category]) => category);
}

function eventKey(event) {
  if (event.source === 'meeting') return `meeting|${event.url || event.title}|${event.timestamp || ''}|${event.excerpt}`;
  return event.url || `${event.timestamp || ''}|${event.channel || ''}|${event.excerpt}`;
}
function latest(events, category) { return events.find(event => event.categories.includes(category)) || null; }

function evidenceFromEvent(event) {
  if (!event) return null;
  return {
    source: event.source || 'slack', evidenceRole: 'project_operation', timestamp: event.timestamp,
    title: event.title || `#${event.channel} · ${event.categories.map(category => CATEGORY_LABELS[category]).join(' · ')}`,
    excerpt: event.excerpt, url: event.url, parentContext: event.parentContext,
    attention: event.attention, attentionType: event.attentionType, attentionAction: event.attentionAction,
  };
}

export function buildProjectOperations(slackChannels = [], qualifiedMeetings = []) {
  const collected = [];
  for (const channel of slackChannels || []) {
    for (const message of channel.messages || []) {
      const text = stripSlack(message.text);
      // A reply confirms only its own words; the parent keeps its original date.
      const parentMillis = Number(message.threadTs) * 1000;
      const parentContext = message.parentText ? {
        timestamp: Number.isFinite(parentMillis) && parentMillis > 0 ? new Date(parentMillis).toISOString() : null,
        excerpt: excerpt(message.parentText),
      } : null;
      if (!text) continue;
      const directCategories = categoriesFor(text);
      const feedbackReport = CUSTOMER_FEEDBACK_REPORT.test(text);
      const contextualTransition = !feedbackReport && parentContext && /(전달|공유|업로드|배포|출시|취소|보류|연기|준비|진행|완료|실패)/.test(text);
      const categories = directCategories.length ? directCategories : contextualTransition ? categoriesFor(parentContext.excerpt) : [];
      if (!categories.length) continue;
      const attention = classifyExecutionAttention(text);
      collected.push({
        source: 'slack', timestamp: message.time || null, channel: channel.channel || 'unknown', url: message.url || null,
        excerpt: excerpt(text), categories, parentContext,
        attention: Boolean(attention), attentionType: attention?.type || null, attentionAction: attention?.action || null,
      });
    }
  }

  // Callers supply only meetings attributed to this project. Common lifecycle
  // words in an unassigned company meeting cannot establish project ownership.
  for (const meeting of qualifiedMeetings || []) {
    const content = String(meeting.content || '');
    const segments = content.split(/\n+|(?<=[.!?])\s+/).map(stripSlack).filter(Boolean);
    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index];
      const categories = categoriesFor(segment);
      if (!categories.length) continue;
      // Keep a short continuation (e.g. “V1, V2 완료”) with its build heading.
      const continuation = segments[index + 1];
      const text = continuation && !categoriesFor(continuation).length && continuation.length <= 180
        ? `${segment} · ${continuation}` : segment;
      const attention = classifyExecutionAttention(text);
      collected.push({
        source: 'meeting', title: meeting.title || '프로젝트 회의록',
        timestamp: meeting.date || null, channel: null, url: meeting.url || null,
        excerpt: text, categories, parentContext: null,
        contentChecked: meeting.contentChecked,
        attention: Boolean(attention), attentionType: attention?.type || null, attentionAction: attention?.action || null,
      });
    }
  }

  const deduped = new Map();
  for (const event of collected.sort((left, right) => String(right.timestamp || '').localeCompare(String(left.timestamp || '')))) {
    const key = eventKey(event);
    if (!deduped.has(key)) deduped.set(key, event);
  }
  const ordered = [...deduped.values()]
    .sort((left, right) => String(right.timestamp || '').localeCompare(String(left.timestamp || '')));
  // Keep the last known signal per category even when recent traffic crowds it out.
  const anchors = Object.keys(PATTERNS).map(category => latest(ordered, category)).filter(Boolean);
  const sourceAnchors = ['slack', 'meeting'].map(source => ordered.find(event => event.source === source)).filter(Boolean);
  // Preserve direct delivery wording as evidence even when newer plans replace
  // the latest category signal. This is not a computed current release state.
  const deliveryEvidence = ordered.find(event => event.categories.some(category => ['build', 'release'].includes(category))
    && /(전달|배포|출시|업로드)\s*(?:완료|했습니다|됨)/.test(event.excerpt)
    && !/(미완료|미확인|예정|하지\s*않|못했)/.test(event.excerpt));
  const events = [...new Set([...anchors, ...sourceAnchors, deliveryEvidence, ...ordered.slice(0, 8)].filter(Boolean))]
    .sort((left, right) => String(right.timestamp || '').localeCompare(String(left.timestamp || '')));

  const latestBuild = latest(events, 'build');
  const latestQa = latest(events, 'qa');
  const latestRelease = latest(events, 'release');
  const latestData = latest(events, 'data');
  const lifecycle = [latestBuild, latestQa, latestRelease].filter(Boolean)
    .sort((left, right) => String(right.timestamp || '').localeCompare(String(left.timestamp || '')))[0] || null;
  const evidence = events
    .filter(Boolean)
    .filter((event, index, rows) => rows.findIndex(candidate => eventKey(candidate) === eventKey(event)) === index)
    .sort((left, right) => String(right.timestamp || '').localeCompare(String(left.timestamp || '')))
    .map(evidenceFromEvent);

  return {
    latestLifecycleSignal: lifecycle ? {
      category: lifecycle.categories.includes('release') ? 'release' : lifecycle.categories.includes('qa') ? 'qa' : 'build',
      source: lifecycle.source || 'slack',
      timestamp: lifecycle.timestamp, channel: lifecycle.channel, excerpt: lifecycle.excerpt, url: lifecycle.url,
    } : null,
    latestBuild, latestQa, latestRelease, latestData, events, evidence,
    source: new Set(events.map(event => event.source)).size > 1 ? 'mixed' : events[0]?.source || 'slack', evidenceCount: events.length,
  };
}
