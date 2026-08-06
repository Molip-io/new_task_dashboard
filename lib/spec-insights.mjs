const CLOSED = new Set(['완료', '일시 정지', '정지', '중단']);
const GENERIC_TERMS = new Set([
  '버그', '버그수정', '개발', '기획', '아트', '확인', '작업', '작업들', '수정', '개선',
  '대응', '적용', '테스트', '시스템', '추가', '기능', '일감', '관련', '진행', '완료',
  '요청', '제안', '현상', '대한', '버전', '방법', '변경', '아이디어', '검토',
  '라이브', '이벤트', '리소스', '소스', '컨셉', '팝업', '리뷰', '피드백', '제안서', 'ui', 'ux',
  '스테이지', '신규', '정리',
]);
const NUMBERED_TOPIC_TERMS = new Set(['스테이지', 'stage', '챕터', 'chapter', '월드', 'world', '레벨', 'level']);

function norm(value) {
  return String(value || '').toLowerCase().replace(/<[^>]+>/g, '').replace(/[^\p{L}\p{N}]+/gu, '');
}

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

function titleTokens(value) {
  const rawTokens = String(value || '').toLowerCase().match(/[\p{L}\p{N}]+/gu)?.map(norm) || [];
  const numberedTopics = rawTokens.flatMap((token, index) =>
    NUMBERED_TOPIC_TERMS.has(token) && /^\d+$/.test(rawTokens[index + 1] || '') ? [`${token}${rawTokens[index + 1]}`] : []);
  const descriptiveTokens = rawTokens.filter(token => token.length >= 2
      && !GENERIC_TERMS.has(token)
      && !/^(?:sprint|sp|스프린트)\d+$/i.test(token)
      && !/^\d+$/.test(token));
  return [...new Set([...numberedTopics, ...descriptiveTokens])];
}

function tokenFrequencies(specs) {
  const frequencies = new Map();
  for (const spec of specs) {
    const tokens = new Set([spec.title, ...(spec.tasks || []).map(task => task.title)].flatMap(titleTokens));
    for (const token of tokens) frequencies.set(token, (frequencies.get(token) || 0) + 1);
  }
  return frequencies;
}

function sourceTerms(spec, frequencies) {
  const titleTerms = [spec.title, ...(spec.tasks || []).map(task => task.title)]
    .map(value => {
      const full = norm(value);
      const candidates = [...new Set(titleTokens(value).filter(token => (frequencies.get(token) || 0) <= 1))];
      const tokens = candidates.filter(token => !candidates.some(other => other !== token && other.includes(token)));
      return {
        full: full.length >= 4 && !GENERIC_TERMS.has(full) ? full : null,
        tokens,
      };
    })
    .filter(term => term.full || term.tokens.length);
  const identityTerms = [spec.id, ...(spec.tasks || []).map(task => task.id)]
    .map(value => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, ''))
    .filter(value => value.length >= 16)
    .map(identifier => ({ full: null, tokens: [], identifier }));
  return [...titleTerms, ...identityTerms];
}

function matches(text, terms) {
  const normalized = norm(text);
  const identifiers = String(text || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return terms.some(term => {
    if (term.identifier && identifiers.includes(term.identifier)) return true;
    if (term.full && normalized.includes(term.full)) return true;
    const hits = term.tokens.filter(token => normalized.includes(token));
    return hits.length >= 2 || hits.some(token => token.length >= 4);
  });
}

function matchedExcerpt(value, terms) {
  const text = String(value || '');
  const matchedLine = text.split(/\r?\n/).map(line => line.trim()).find(line => line && matches(line, terms));
  return excerpt(matchedLine || text);
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
      return {
        source: 'slack', timestamp: message.time || null,
        title: `#${channel.channel}${message.user ? ` · ${message.user}` : ''}`,
        // Replies carry the newest execution state. Keep them before parent
        // context so the remote excerpt budget is not consumed by Notion URLs.
        excerpt: excerpt([reply, parent && parent !== reply ? `맥락: ${parent}` : ''].filter(Boolean).join(' · ')),
        url: message.url || null,
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
    .sort((left, right) => String(right.timestamp || '').localeCompare(String(left.timestamp || '')))
    .slice(0, 2);
}

function meetingEvidence(meetings, terms) {
  return (meetings || [])
    .filter(meeting => matches(`${meeting.title || ''}\n${meeting.content || ''}`, terms))
    .map(meeting => ({
      source: 'meeting', timestamp: meeting.date || null, title: meeting.title,
      excerpt: matchedExcerpt(meeting.content || meeting.title, terms), url: meeting.url || null,
    }))
    .sort((left, right) => String(right.timestamp || '').localeCompare(String(left.timestamp || '')))
    .slice(0, 1);
}

function gitEvidence(commits, spec, terms) {
  const taskIds = new Set((spec.tasks || []).map(task => task.id));
  return (commits || [])
    .filter(commit => (commit.workItemId && taskIds.has(commit.workItemId)) || matches(commit.message, terms))
    .map(commit => ({
      source: 'git', timestamp: commit.committedAt || null,
      title: `${commit.shortHash || String(commit.hash || '').slice(0, 8)} · ${commit.author || '작성자 미상'}`,
      excerpt: excerpt(commit.message), url: commit.url || null,
    }))
    .sort((left, right) => String(right.timestamp || '').localeCompare(String(left.timestamp || '')))
    .slice(0, 2);
}

export function buildSpecInsights({ project, slackChannels = [], meetings = [], commits = [] }) {
  const specs = (project.specs || []).filter(spec => (spec.tasks || []).length > 0);
  const frequencies = tokenFrequencies(specs);
  return specs.map(spec => {
    const terms = sourceTerms(spec, frequencies);
    const notion = notionEvidence(spec);
    const evidence = [
      ...(notion ? [notion] : []),
      ...slackEvidence(slackChannels, terms),
      ...meetingEvidence(meetings, terms),
      ...gitEvidence(commits, spec, terms),
    ].sort((left, right) => String(right.timestamp || '').localeCompare(String(left.timestamp || '')));
    return {
      specId: spec.id,
      title: spec.title,
      summary: fallbackSummary(spec),
      blockers: fallbackBlockers(spec),
      nextAction: fallbackNextAction(spec),
      evidence,
    };
  });
}
