import { classifyExecutionAttention } from './execution-attention.mjs';
import {
  matchedExcerpt, matches, meetingSourceTerms, norm, sourceTerms, tokenFrequencies,
} from './spec-source-matcher.mjs';

const CLOSED = new Set(['완료', '일시 정지', '정지', '중단']);

function excerpt(value, limit = 220) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

function slackPlainText(value) {
  return String(value || '')
    .replace(/<https?:\/\/[^>|]+\|([^>]+)>/g, '$1')
    .replace(/<https?:\/\/[^>]+>/g, '')
    .replace(/<@[^>]+>/g, '담당자')
    .replace(/<![^>|]+\|([^>]+)>/g, '$1')
    .replace(/[*_~`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function meetingExcerpt(meeting, terms) {
  const content = String(meeting.content || meeting.title || '');
  const segments = content
    .split(/\r?\n|(?<=[.!?])\s+/)
    .map(segment => segment.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const attention = segments
    .map((segment, index) => ({ segment, index, classification: classifyExecutionAttention(segment) }))
    .filter(({ segment, classification }) => classification
      && (matches(meeting.title, terms) || matches(segment, terms)))
    .sort((left, right) => Number(matches(right.segment, terms)) - Number(matches(left.segment, terms)) || left.index - right.index)[0];
  if (attention) {
    const context = `${attention.segment} · 회의: ${meeting.title}`;
    return {
      excerpt: excerpt(context, 260),
      attention: true,
      attentionType: attention.classification.type,
      attentionAction: attention.classification.action,
    };
  }
  return { excerpt: excerpt(matchedExcerpt(content, terms)), attention: false, attentionType: null, attentionAction: null };
}

function statusSummary(tasks) {
  const ordered = ['진행 중', '확인 요청', '검토중', '추가 진행', '진행 예정', '시작 전'];
  const counts = new Map();
  for (const task of tasks) counts.set(task.status || '상태 미정', (counts.get(task.status || '상태 미정') || 0) + 1);
  return [...counts.entries()]
    .sort((left, right) => {
      const leftOrder = ordered.indexOf(left[0]);
      const rightOrder = ordered.indexOf(right[0]);
      return (leftOrder < 0 ? 99 : leftOrder) - (rightOrder < 0 ? 99 : rightOrder);
    })
    .map(([status, count]) => `${status} ${count}건`)
    .join(' · ');
}

function teamSummary(tasks) {
  const counts = new Map();
  for (const task of tasks) counts.set(task.team || '팀 미지정', (counts.get(task.team || '팀 미지정') || 0) + 1);
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], 'ko'))
    .map(([team, count]) => `${team} ${count}`)
    .join(' · ');
}

function fallbackSummary(spec) {
  const tasks = (spec.tasks || []).filter(task => !CLOSED.has(task.status));
  if (!tasks.length) return '현재 표시할 활성 작업항목이 없습니다.';
  const states = statusSummary(tasks);
  const teams = teamSummary(tasks);
  return `활성 작업 ${tasks.length}건은 ${states || '상태 미정'}입니다.${teams ? ` 파트별로는 ${teams}입니다.` : ''}`;
}

function fallbackBlockers(spec) {
  const overdue = (spec.tasks || []).filter(task => task.overdueDays > 0);
  const review = (spec.tasks || []).filter(task => ['확인 요청', '검토중'].includes(task.status));
  const blockers = [];
  if (overdue.length) blockers.push(`기한 초과 ${overdue.length}건: ${overdue.slice(0, 2).map(task => task.title).join(', ')}`);
  if (review.length) blockers.push(`확인 대기 ${review.length}건: ${review.slice(0, 2).map(task => task.title).join(', ')}`);
  return blockers;
}

function fallbackNextAction(spec) {
  const tasks = spec.tasks || [];
  if (tasks.some(task => task.overdueDays > 0)) return '기한 초과 작업의 지연 사유와 변경 일정을 먼저 확인합니다.';
  if (tasks.some(task => ['확인 요청', '검토중'].includes(task.status))) return '확인 요청과 검토중 작업의 승인·수정 여부를 정리합니다.';
  if (tasks.some(task => task.status === '진행 중')) return '진행 중 작업의 다음 완료 지점과 필요한 지원을 확인합니다.';
  if (tasks.some(task => ['시작 전', '진행 예정'].includes(task.status))) return '시작 전·진행 예정 작업의 착수 조건과 담당 일정을 확인합니다.';
  return null;
}

function notionEvidence(spec) {
  const latest = [...(spec.tasks || [])]
    .filter(task => task.notionUpdatedAt)
    .sort((left, right) => String(right.notionUpdatedAt).localeCompare(String(left.notionUpdatedAt)))[0];
  if (latest) {
    return {
      source: 'notion',
      timestamp: latest.notionUpdatedAt,
      title: latest.title,
      excerpt: `${latest.status || '상태 미정'} · 담당 ${(latest.assignees || []).join(', ') || '미지정'}`,
      url: latest.url || spec.url || null,
    };
  }
  return spec.url ? {
    source: 'notion', timestamp: null, title: spec.title,
    excerpt: `상위 작업 상태 ${spec.status || '미정'}`, url: spec.url,
  } : null;
}

function slackEvidence(channels, terms) {
  const candidates = (channels || []).flatMap(channel => (channel.messages || [])
    .filter(message => matches(`${message.parentText || ''}\n${message.text || ''}`, terms))
    .map(message => {
      const reply = slackPlainText(message.text);
      const parent = message.parentText ? slackPlainText(matchedExcerpt(message.parentText, terms)) : '';
      const classification = classifyExecutionAttention([reply, parent].filter(Boolean).join(' · '));
      return {
        source: 'slack', evidenceRole: 'recent_execution', timestamp: message.time || null,
        title: `#${channel.channel}${message.user ? ` · ${message.user}` : ''}`,
        // Replies carry the newest execution state. Keep them before parent
        // context so the remote excerpt budget is not consumed by Notion URLs.
        excerpt: excerpt([reply, parent && parent !== reply ? `맥락: ${parent}` : ''].filter(Boolean).join(' · ')),
        url: message.url || null,
        attention: Boolean(classification),
        attentionType: classification?.type || null,
        attentionAction: classification?.action || null,
        threadKey: norm(message.parentText || message.text),
      };
    }));
  const latestByThread = new Map();
  for (const candidate of candidates) {
    const key = candidate.threadKey || candidate.url || `${candidate.timestamp}|${candidate.excerpt}`;
    const previous = latestByThread.get(key);
    if (!previous || String(candidate.timestamp || '') > String(previous.timestamp || '')) latestByThread.set(key, candidate);
  }
  return [...latestByThread.values()]
    .map(({ threadKey, ...item }) => item)
    .sort((left, right) => Number(right.attention) - Number(left.attention)
      || String(right.timestamp || '').localeCompare(String(left.timestamp || '')))
    .slice(0, 2);
}

function meetingEvidence(meetings, terms) {
  return (meetings || [])
    .filter(meeting => matches(`${meeting.title || ''}\n${meeting.content || ''}`, terms))
    .map(meeting => {
      const extracted = meetingExcerpt(meeting, terms);
      return {
        source: 'meeting', evidenceRole: 'recent_execution', timestamp: meeting.date || null, title: meeting.title,
        excerpt: extracted.excerpt, url: meeting.url || null, attention: extracted.attention,
        attentionType: extracted.attentionType, attentionAction: extracted.attentionAction,
      };
    })
    .sort((left, right) => Number(right.attention) - Number(left.attention)
      || String(right.timestamp || '').localeCompare(String(left.timestamp || '')))
    .slice(0, 2);
}

function attentionNextAction(evidence) {
  return evidence.find(item => item.attention)?.attentionAction || null;
}

function gitEvidence(commits, spec, terms) {
  const taskIds = new Set((spec.tasks || []).map(task => task.id));
  return (commits || [])
    .filter(commit => (commit.workItemId && taskIds.has(commit.workItemId)) || matches(commit.message, terms))
    .map(commit => ({
      source: 'git', evidenceRole: 'recent_execution', timestamp: commit.committedAt || null,
      title: `${commit.shortHash || String(commit.hash || '').slice(0, 8)} · ${commit.author || '작성자 미상'}`,
      excerpt: excerpt(commit.message), url: commit.url || null,
    }))
    .sort((left, right) => String(right.timestamp || '').localeCompare(String(left.timestamp || '')))
    .slice(0, 2);
}

function roleTerms(spec) {
  const roles = new Set();
  for (const task of spec.tasks || []) {
    const source = `${task.team || ''} ${task.title || ''}`;
    for (const role of ['아트', '디자인', 'UI', 'UX', '개발', '기획', 'QA', '테크', '리소스', '클라이언트']) {
      if (source.toLowerCase().includes(role.toLowerCase())) roles.add(norm(role));
    }
  }
  return roles;
}

function persistentContextRelevant(context, project, spec, frequencies) {
  const content = `${context.title || ''}\n${context.excerpt || ''}`;
  const terms = sourceTerms(spec, frequencies);
  if (matches(content, terms)) return true;
  if (!context.projectMatch || !/(절차|프로세스|리뷰|피드백|협업|전달|handoff|역할|완료 기준|작업 방식|운영 원칙|재작업|취합|승인)/i.test(content)) return false;
  const roles = roleTerms(spec);
  return [...roles].some(role => content.toLowerCase().includes(role));
}

function persistentContextSuperseded(context, newerEvidence = []) {
  const topicPattern = {
    review_feedback: /리뷰|피드백|시안|정합성/i,
    handoff: /전달|handoff|취합|모아서|한번에/i,
    approval: /승인|go|재작업/i,
    quality: /완료 기준|검증|qa|품질/i,
    roles: /역할|담당 범위|협업/i,
    process: /절차|프로세스|업무 흐름|작업 방식|운영 원칙/i,
    workflow: /방식|업무|프로세스/i,
  }[context.topicKey] || /방식|변경|프로세스/i;
  return newerEvidence.some(item => {
    const newer = Date.parse(item.timestamp || '') > Date.parse(context.timestamp || '');
    return newer && topicPattern.test(item.excerpt || '') && /(변경|새로운|대체|현재는|이후|폐기|다시 정리)/i.test(item.excerpt || '');
  });
}

function persistentContextEvidence(contexts, project, spec, frequencies, newerEvidence = []) {
  const relevant = (contexts || []).filter(context => persistentContextRelevant(context, project, spec, frequencies));
  const latestByTopic = new Map();
  for (const context of relevant) {
    if (persistentContextSuperseded(context, newerEvidence)) continue;
    const key = context.topicKey || context.url || context.excerpt;
    const previous = latestByTopic.get(key);
    if (!previous || String(context.timestamp || '') > String(previous.timestamp || '')) latestByTopic.set(key, context);
  }
  return [...latestByTopic.values()]
    .sort((left, right) => String(right.timestamp || '').localeCompare(String(left.timestamp || '')))
    .slice(0, 2)
    .map(context => ({
      source: 'slack', evidenceRole: 'persistent_context', timestamp: context.timestamp || null,
      title: context.title || 'Slack · 현재 업무 방식 맥락', excerpt: context.excerpt || '',
      url: context.url || null, attention: false, attentionType: null,
    }));
}

export function buildSpecInsights({ project, slackChannels = [], persistentContexts = [], meetings = [], commits = [] }) {
  const specs = (project.specs || []).filter(spec => (spec.tasks || []).length > 0);
  const frequencies = tokenFrequencies(specs);
  return specs.map(spec => {
    const terms = sourceTerms(spec, frequencies);
    const meetingTerms = meetingSourceTerms(spec, frequencies);
    const notion = notionEvidence(spec);
    const slackForSpec = slackEvidence(slackChannels, terms);
    const meetingsForSpec = meetingEvidence(meetings, meetingTerms);
    const currentContextEvidence = [...slackForSpec, ...meetingsForSpec];
    const currentPersistentForSpec = persistentContextEvidence(persistentContexts, project, spec, frequencies, currentContextEvidence);
    const evidence = [
      ...(notion ? [notion] : []),
      ...slackForSpec,
      ...currentPersistentForSpec,
      ...meetingsForSpec,
      ...gitEvidence(commits, spec, terms),
    ].sort((left, right) => String(right.timestamp || '').localeCompare(String(left.timestamp || '')));
    const stateBlockers = fallbackBlockers(spec);
    const sourceAttention = [...slackForSpec, ...meetingsForSpec].filter(item => item.attention);
    const blockers = [...stateBlockers, ...sourceAttention.map(item => item.excerpt)]
      .filter((item, index, rows) => rows.indexOf(item) === index)
      .slice(0, 3);
    const stateNextAction = fallbackNextAction(spec);
    const sourceNextAction = attentionNextAction(sourceAttention);
    return {
      specId: spec.id,
      title: spec.title,
      summary: fallbackSummary(spec),
      blockers,
      nextAction: sourceNextAction || stateNextAction,
      evidence,
    };
  });
}
