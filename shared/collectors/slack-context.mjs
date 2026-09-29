const CONTEXT_HINTS = [
  '절차', '프로세스', '리뷰 방식', '피드백 방식', '피드백', '전달 방식', '전달',
  '협업 방식', '협업', '작업 방식', '업무 흐름', '역할 분담', '담당 범위',
  '승인 방식', '승인', '완료 기준', '작업 순서', '적용 시점', '운영 원칙',
  '재작업', '반복 피드백', '커뮤니케이션 비용', '커뮤니케이션', '취합', '모아서',
  '한번에 전달', 'handoff', '병목', '방식 변경', '변경', '합의', '하기로',
];

const AGREEMENT_HINTS = [
  '합의했습니다', '합의함', '합의하기로', '결정했습니다', '결정하기로', '결정한다',
  '확정했습니다', '확정하기로', '하기로', '정했습니다', '정리했습니다', '적용합니다',
  '적용하기로', '진행하기로', '변경합니다', '변경하기로', '통일합니다',
  'go', '재작업 여부를 결정',
];

const SUGGESTION_ONLY = /(제안|좋을 것 같|어떨까요|어떻|의견|생각해봅시다|하면 좋겠습니다)/i;
const AGREEMENT = new RegExp(AGREEMENT_HINTS.map(escapeRegExp).join('|'), 'i');
const CONTEXT = new RegExp(CONTEXT_HINTS.map(escapeRegExp).join('|'), 'i');

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function text(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function compact(value) {
  return text(value).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

export function persistentContextSignal(value) {
  const content = text(value);
  if (!content || !CONTEXT.test(content)) return false;
  return AGREEMENT.test(content) && !(SUGGESTION_ONLY.test(content) && !AGREEMENT.test(content));
}

export function hasPersistentContextHint(value) {
  return CONTEXT.test(text(value));
}

export function persistentContextTopic(value) {
  const content = text(value).toLowerCase();
  if (/(리뷰|피드백|시안|정합성)/i.test(content)) return 'review_feedback';
  if (/(전달|handoff|취합|모아서|한번에)/i.test(content)) return 'handoff';
  if (/(승인|go|재작업 여부)/i.test(content)) return 'approval';
  if (/(완료 기준|검증|qa|품질)/i.test(content)) return 'quality';
  if (/(역할|담당 범위|협업)/i.test(content)) return 'roles';
  if (/(절차|프로세스|업무 흐름|작업 방식|운영 원칙)/i.test(content)) return 'process';
  return 'workflow';
}

function threadKey(message) {
  return message?.threadTs || message?.ts || message?.url || null;
}

function latestThreadTimestamp(messages) {
  return [...messages].sort((left, right) => String(right.time || '').localeCompare(String(left.time || '')))[0]?.time || null;
}

export function extractPersistentContexts({ channel, messages = [], recentDays = 7, projectName = null, now = Date.now() }) {
  const recentCutoff = now - Number(recentDays || 0) * 86400_000;
  const threads = new Map();
  for (const message of messages) {
    const timestamp = Date.parse(message.time || '') || 0;
    if (timestamp && timestamp >= recentCutoff) continue;
    const key = threadKey(message);
    if (!key) continue;
    const bucket = threads.get(key) || [];
    bucket.push(message);
    threads.set(key, bucket);
  }

  const contexts = [];
  for (const threadMessages of threads.values()) {
    const ordered = [...threadMessages].sort((left, right) => String(left.time || '').localeCompare(String(right.time || '')));
    const combined = ordered.map(message => [message.parentText, message.text].filter(Boolean).join(' · ')).join(' · ');
    if (!persistentContextSignal(combined)) continue;
    const agreementMessage = [...ordered].reverse().find(message => AGREEMENT.test(text(message.text)));
    const anchor = agreementMessage || ordered.at(-1) || ordered[0];
    const parent = ordered.find(message => !message.parentText) || ordered[0];
    const excerpt = text(ordered.map(message => {
      const body = text(message.text);
      return message.parentText && body !== text(message.parentText) ? body : body;
    }).filter(Boolean).join(' · ')).slice(0, 420);
    const projectMatch = projectName ? compact(combined).includes(compact(projectName)) : false;
    contexts.push({
      source: 'slack',
      evidenceRole: 'persistent_context',
      timestamp: latestThreadTimestamp(ordered),
      title: `#${channel} · 업무 방식 합의`,
      excerpt,
      url: anchor.url || parent.url || null,
      attention: false,
      attentionType: null,
      topicKey: persistentContextTopic(combined),
      projectMatch,
      threadKey: threadKey(parent),
    });
  }

  const unique = new Map();
  for (const context of contexts) {
    const key = `${context.topicKey}|${context.threadKey || context.url || context.excerpt}`;
    if (!unique.has(key)) unique.set(key, context);
  }
  return [...unique.values()]
    .sort((left, right) => String(right.timestamp || '').localeCompare(String(left.timestamp || '')))
    .slice(0, 8);
}

export function persistentContextPatterns() {
  return { hints: [...CONTEXT_HINTS], agreements: [...AGREEMENT_HINTS] };
}
