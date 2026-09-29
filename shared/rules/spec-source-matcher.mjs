const GENERIC_TERMS = new Set([
  '버그', '버그수정', '개발', '기획', '아트', '확인', '작업', '작업들', '수정', '개선',
  '대응', '적용', '테스트', '시스템', '추가', '기능', '일감', '관련', '진행', '완료',
  '요청', '제안', '현상', '대한', '버전', '방법', '변경', '아이디어', '검토',
  '라이브', '이벤트', '리소스', '소스', '컨셉', '팝업', '리뷰', '피드백', '제안서', 'ui', 'ux',
  '스테이지', '신규', '정리', '내용', '반영',
]);
const NUMBERED_TOPIC_TERMS = new Set(['스테이지', 'stage', '챕터', 'chapter', '월드', 'world', '레벨', 'level']);

export function norm(value) {
  return String(value || '').toLowerCase().replace(/<[^>]+>/g, '').replace(/[^\p{L}\p{N}]+/gu, '');
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

export function tokenFrequencies(specs) {
  const frequencies = new Map();
  for (const spec of specs) {
    const tokens = new Set([spec.title, ...(spec.tasks || []).map(task => task.title)].flatMap(titleTokens));
    for (const token of tokens) frequencies.set(token, (frequencies.get(token) || 0) + 1);
  }
  return frequencies;
}

export function sourceTerms(spec, frequencies) {
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

export function meetingSourceTerms(spec, frequencies) {
  const specIdentity = sourceTerms({ id: spec.id, title: spec.title, tasks: [] }, frequencies);
  const taskTokenCounts = new Map();
  for (const task of spec.tasks || []) {
    for (const token of new Set(titleTokens(task.title))) {
      taskTokenCounts.set(token, (taskTokenCounts.get(token) || 0) + 1);
    }
  }
  const recurringCandidates = [...taskTokenCounts.entries()]
    .filter(([token, count]) => count >= 2 && (frequencies.get(token) || 0) <= 1)
    .map(([token]) => token);
  const recurringTokens = recurringCandidates
    .filter(token => !recurringCandidates.some(other => other !== token && other.includes(token)));
  const taskIdentifiers = (spec.tasks || [])
    .map(task => String(task.id || '').toLowerCase().replace(/[^a-z0-9]/g, ''))
    .filter(identifier => identifier.length >= 16)
    .map(identifier => ({ full: null, tokens: [], identifier }));
  return [
    ...specIdentity,
    ...(recurringTokens.length >= 2 ? [{ full: null, tokens: recurringTokens }] : []),
    ...taskIdentifiers,
  ];
}

function includesNearKoreanToken(normalized, token) {
  if (token.length < 3 || !/^[가-힣]+$/.test(token)) return false;
  for (let index = 0; index <= normalized.length - token.length; index += 1) {
    const candidate = normalized.slice(index, index + token.length);
    let differences = 0;
    for (let offset = 0; offset < token.length && differences <= 1; offset += 1) {
      if (candidate[offset] !== token[offset]) differences += 1;
    }
    if (differences <= 1) return true;
  }
  return false;
}

export function matches(text, terms) {
  const normalized = norm(text);
  const identifiers = String(text || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return terms.some(term => {
    if (term.identifier && identifiers.includes(term.identifier)) return true;
    if (term.full && normalized.includes(term.full)) return true;
    const exactHits = term.tokens.filter(token => normalized.includes(token));
    if (exactHits.length >= 2 || exactHits.some(token => token.length >= 4)) return true;
    const fuzzyHits = term.tokens.filter(token => !normalized.includes(token) && includesNearKoreanToken(normalized, token));
    return exactHits.length >= 1 && fuzzyHits.length >= 1;
  });
}

export function matchedExcerpt(value, terms) {
  const text = String(value || '');
  const matchedLine = text.split(/\r?\n/).map(line => line.trim()).find(line => line && matches(line, terms));
  return matchedLine || text;
}
