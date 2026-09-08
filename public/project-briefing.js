// Project narrative comes from the Agent, never from keyword-matched Slack excerpts.
// Pure resolver/presenter shared by browser rendering and regression tests.
const text = value => typeof value === 'string' ? value.trim() : '';
const rows = value => Array.isArray(value) ? value : [];
const strings = value => rows(value).map(text).filter(Boolean);
const unique = values => [...new Set(values.filter(Boolean))];
const SOURCES = { notion: 'Notion', slack: 'Slack', meeting: '회의록', git: 'GitHub' };
const USABLE = new Set(['success', 'partial', 'stale', 'legacy']);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const stamp = value => { const n = Date.parse(value || ''); return Number.isFinite(n) ? n : null; };
const safeUrl = value => {
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null; }
  catch { return null; }
};
export function briefingTime(value) {
  if (stamp(value) === null) return '시각 미확인';
  return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(value)) + ' KST';
}
function evidenceRows(values) {
  const seen = new Set();
  return rows(values).filter(e => e && typeof e === 'object' && Object.hasOwn(SOURCES, e.source) && text(e.excerpt))
    .map(e => ({ source: e.source, timestamp: e.timestamp || null, url: safeUrl(e.url), excerpt: text(e.excerpt), title: text(e.title) }))
    .filter(e => { const key = JSON.stringify([e.source, e.url, e.timestamp, e.excerpt]); if (seen.has(key)) return false; seen.add(key); return true; });
}
function collectedEvidence(project) {
  const ops = project.projectOperations || {};
  const signals = [ops.latestBuild, ops.latestQa, ops.latestRelease, ops.latestData].filter(Boolean)
    .map(e => ({ ...e, source: e.source || 'slack' }));
  return evidenceRows([ ...rows(ops.evidence), ...signals, ...rows(project.specInsights).flatMap(s => rows(s.evidence)) ]);
}

export function resolveProjectBriefing(dashboard, project) {
  const ai = dashboard.ai || {};
  // Exact names only. Never attach a similarly named project's narrative.
  const matches = rows(ai.projects).filter(p => p && p.name === project.name);
  const duplicate = matches.length > 1;
  const agent = !duplicate && USABLE.has(ai.analysisStatus) ? matches[0] : null;
  const brief = agent?.projectBriefing;
  const structured = Boolean(brief && typeof brief === 'object' && text(brief.currentProgress));
  const summary = text(agent?.summary);
  const hasNarrative = Boolean(structured || summary);
  const generatedAt = agent?.generatedAt || ai.generatedAt || null;
  const inputAt = dashboard.agentHandoff?.generatedAt || dashboard.generatedAt || null;
  const generatedTime = stamp(generatedAt), inputTime = stamp(inputAt);
  const changedRun = Boolean(ai.runId && dashboard.agentHandoff?.runId && ai.runId !== dashboard.agentHandoff.runId);
  const outdated = Boolean(hasNarrative && (ai.analysisStatus === 'stale' || changedRun || dashboard.sprintSettings?.pendingInput || dashboard.sprintSettings?.pendingAnalysis ||
    (generatedTime !== null && inputTime !== null && generatedTime < inputTime)));
  const limits = unique([...strings(agent?.confidenceLimits), ...strings(brief?.confidenceLimits), ...strings(ai.overall?.confidenceLimits)]);
  if (duplicate) limits.push('같은 프로젝트의 분석 결과가 중복되어 임의로 선택하지 않았습니다.');
  if (outdated) limits.push('최신 규칙 입력 또는 스프린트 기준 이전의 분석입니다. 현재 상태로 확정하지 마세요.');
  if (hasNarrative && (generatedTime === null || inputTime === null)) limits.push('분석 또는 규칙 입력 시각이 없어 최신성을 확인할 수 없습니다.');
  if (hasNarrative && !structured) limits.push('기존 통합 요약을 표시합니다. 세 영역으로 구분된 브리핑은 새 분석에서 생성됩니다.');
  if (hasNarrative && ai.analysisStatus === 'legacy') limits.push('이전 형식의 저장 요약입니다. 출처 대조 완료 여부를 확인할 수 없습니다.');
  const comparison = agent?.sourceComparison?.status || ai.sourceComparison?.status || 'not_run';
  if (hasNarrative && !['complete'].includes(comparison)) limits.push('일부 출처의 대조가 완료되지 않았거나 대조 상태가 제공되지 않았습니다.');
  const sourceStatus = agent?.sourceStatus || ai.sourceStatus || {};
  const unavailable = Object.entries(sourceStatus).filter(([key, value]) => Object.hasOwn(SOURCES, key) && ['partial', 'failed', 'not_available'].includes(value));
  if (hasNarrative && unavailable.length) limits.push(`출처 확인 제한: ${unavailable.map(([key, value]) => `${SOURCES[key]} ${value}`).join(' · ')}`);
  const analysisEvidence = hasNarrative ? evidenceRows([...rows(brief?.evidence), ...rows(agent?.evidence)]) : [];
  // These references belong to the exact project's spec analyses, not an invented
  // project synthesis. Keep the distinction visible, including on legacy data.
  const specEvidence = hasNarrative ? evidenceRows(rows(agent?.specSummaries).flatMap(s => rows(s.evidence))) : [];
  const rawEvidence = collectedEvidence(project);
  const evidence = evidenceRows([...analysisEvidence, ...specEvidence]);
  const validActions = rows(brief?.nextActions).filter(a => a && text(a.text) && ['agreed', 'suggested_check'].includes(a.kind))
    .map(a => ({ text: text(a.text), kind: a.kind }));
  const nextActions = structured ? validActions : strings(agent?.nextActions).map(t => ({ text: t, kind: 'legacy' }));
  const status = !hasNarrative ? 'not_run' : outdated ? 'stale' : ai.analysisStatus === 'legacy' ? 'legacy' : ai.analysisStatus === 'partial' || unavailable.length || comparison !== 'complete' || generatedTime === null || inputTime === null ? 'partial' : 'success';
  return {
    name: project.name, status, hasNarrative, structured, generatedAt, inputAt,
    currentProgress: structured ? text(brief.currentProgress) : summary,
    buildRelease: structured ? text(brief.buildRelease) : '',
    data: structured ? text(brief.data) : '',
    blockers: hasNarrative ? strings(agent?.blockers) : [],
    confirmationRequired: hasNarrative ? strings(brief?.confirmationRequired) : [],
    nextActions, limits: unique(limits), analysisEvidence, specEvidence, rawEvidence,
    evidence, sources: unique(evidence.map(e => e.source)), sourceStatus,
  };
}

function evidenceHtml(items) {
  if (!items.length) return '<p class="project-briefing-muted">연결된 원문 근거가 제공되지 않았습니다.</p>';
  return items.map(e => {
    const title = `${SOURCES[e.source]} · ${briefingTime(e.timestamp)}`;
    const heading = e.url ? `<a href="${esc(e.url)}" target="_blank" rel="noopener noreferrer">${esc(title)} · 원문 열기</a>` : `<strong>${esc(title)}</strong>`;
    return `<article class="project-briefing-evidence-item">${heading}${e.title ? `<small>${esc(e.title)}</small>` : ''}<p>${esc(e.excerpt)}</p></article>`;
  }).join('');
}
function listHtml(values, empty) {
  return values.length ? values.map(v => `<p>${esc(v)}</p>`).join('') : `<p class="project-briefing-muted">${esc(empty)}</p>`;
}
export function projectBriefingHtml(dashboard, project) {
  const view = resolveProjectBriefing(dashboard, project);
  const stateLabels = { success: 'Agent 통합 분석', partial: 'Agent 통합 분석 · 확인 제한', stale: '이전 통합 분석 · 갱신 필요', legacy: '기존 저장 요약', not_run: '프로젝트 통합 분석 미생성' };
  const preview = view.currentProgress || '여러 출처를 종합한 프로젝트 브리핑이 아직 없습니다.';
  const sourceChips = view.sources.map(source => `<span class="project-briefing-source">${esc(SOURCES[source])}</span>`).join('');
  const axis = (label, content, empty) => `<section class="project-briefing-axis"><h4>${esc(label)}</h4><p>${esc(content || empty)}</p></section>`;
  const emptyAxis = view.structured ? '현재 분석에서 직접 확인된 내용이 없습니다. 확인 제한과 원문 근거를 함께 보세요.' : '영역별 통합 분석 미생성 · 기존 요약에서 이 영역만 임의 추출하지 않습니다.';
  const narrative = view.hasNarrative ? `${axis(view.structured ? '현재 진행 요약' : '기존 통합 요약', view.currentProgress, '')}<div class="project-briefing-grid">${axis('빌드·출시 현황', view.buildRelease, emptyAxis)}${axis('데이터 현황', view.data, emptyAxis)}</div>
    <div class="project-briefing-grid"><section class="project-briefing-axis"><h4>실행 병목</h4>${listHtml(view.blockers, '분석에 명시된 실행 병목이 없습니다. 출처 확인 제한이 있으면 위험 없음으로 단정하지 않습니다.')}</section><section class="project-briefing-axis"><h4>확인 필요</h4>${listHtml(view.confirmationRequired, view.structured ? '별도 확인 항목이 기록되지 않았습니다.' : '기존 요약에는 별도 확인 항목 구분이 없습니다.')}</section></div>
    <section class="project-briefing-axis"><h4>다음 주요 행동</h4>${view.nextActions.length ? view.nextActions.map(a => `<p><span class="project-briefing-action-kind">${a.kind === 'agreed' ? '합의된 행동' : a.kind === 'suggested_check' ? 'AI 확인 제안' : '기존 분석 · 합의 여부 구분 미제공'}</span>${esc(a.text)}</p>`).join('') : '<p class="project-briefing-muted">근거로 확인되는 다음 행동이 제공되지 않았습니다.</p>'}</section>`
    : '<p class="project-briefing-empty">프로젝트별 Agent 통합 분석이 필요합니다. 수집된 Slack 발췌를 프로젝트 전체의 결론으로 대신 표시하지 않습니다.</p>';
  const sourceDetails = `<details class="project-briefing-evidence"><summary>근거 보기 · 분석 연결 ${view.evidence.length}건 / 수집 참고 ${view.rawEvidence.length}건</summary><div class="project-briefing-evidence-body"><h5>프로젝트 분석에 연결된 근거</h5>${evidenceHtml(view.analysisEvidence)}${view.specEvidence.length ? `<h5>같은 프로젝트의 스펙별 분석 근거</h5><p class="project-briefing-muted">개별 스펙의 근거이며 모든 프로젝트 결론을 뒷받침한다는 뜻은 아닙니다.</p>${evidenceHtml(view.specEvidence)}` : ''}<details class="project-briefing-raw"><summary>원본 수집 근거 · ${view.rawEvidence.length}건</summary><p class="project-briefing-muted">수집기의 발췌입니다. Agent의 통합 판단이 아닙니다.</p>${evidenceHtml(view.rawEvidence)}</details></div></details>`;
  return `<details class="card span-6 project-operations-card project-briefing-card" data-project-briefing="${esc(project.name)}"><summary><div class="project-operations-summary"><strong>${esc(project.name)} · 프로젝트 현황</strong><small class="project-briefing-preview">${esc(preview)}</small></div><span class="project-operations-toggle"><span class="toggle-open">펼치기</span><span class="toggle-close">접기</span></span></summary><div class="project-operations-body project-briefing-body"><div class="project-briefing-meta"><span class="project-briefing-status ${esc(view.status)}">${stateLabels[view.status]}</span><span>${esc(briefingTime(view.generatedAt))}</span>${sourceChips}</div>${view.status === 'stale' ? '<p class="project-briefing-warning">최신 입력 이전의 분석입니다. 재분석 전까지 아래 내용은 마지막 확인 기록으로만 사용하세요.</p>' : ''}${narrative}${view.limits.length ? `<aside class="project-briefing-limits"><h4>분석 범위·확인 제한</h4>${listHtml(view.limits, '')}</aside>` : ''}${sourceDetails}</div></details>`;
}
export function projectBriefingsHtml(dashboard) {
  const projects = rows(dashboard.projects);
  return projects.length ? `<section class="project-briefings" aria-label="프로젝트 현황"><h3 class="project-briefings-title">프로젝트 현황</h3><p class="project-briefing-muted">진행 상황 · 빌드·출시 · 데이터의 통합 브리핑. 원문은 ‘근거 보기’에서 확인합니다.</p><div class="bento project-operations-bento">${projects.map(project => projectBriefingHtml(dashboard, project)).join('')}</div></section>` : '';
}
