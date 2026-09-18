import { analysisPresentation, formatKst as fmt } from './dashboard-analysis.js';
import { briefingDetailItems, gitRepositoryStatus, gitTrustSummary, issuePresentation, primaryActionSummary } from './dashboard-management.js';
import { groupIssuesByProjectItem } from './dashboard-view-model.js';

const SEVERITY_RANK = { error: 0, warning: 1, check: 2, info: 3 };
const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
const safeUrl = value => /^(https?:\/\/|#)/.test(String(value || '')) ? value : '#';

function filterOptions(values, current) {
  return `<option value="">전체</option>${[...new Set(values.filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), 'ko')).map(value => `<option value="${esc(value)}" ${value === current ? 'selected' : ''}>${esc(value)}</option>`).join('')}`;
}

function briefingFilterHtml(items, filters) {
  const teams = items.map(item => item.team);
  const assignees = items.flatMap(item => item.assignees || []);
  return `<div class="toolbar briefing-filters"><label>프로젝트<select data-briefing-filter="project">${filterOptions(items.map(item => item.project), filters.project)}</select></label><label>팀<select data-briefing-filter="team">${filterOptions(teams, filters.team)}</select></label><label>담당자<select data-briefing-filter="assignee">${filterOptions(assignees, filters.assignee)}</select></label><button type="button" class="reset" data-action="reset-briefing-filters">필터 초기화</button></div>`;
}

export function managementActionHtml(issue, fallbackUrl) {
  const presentation = issuePresentation(issue);
  const targetLabels = { 'work-item': '작업항목', spec: '상위 작업', project: '프로젝트', 'git-repository': 'Git 저장소' };
  const targetUrl = issue.metadata?.remote || issue.metadata?.url || issue.metadata?.representativeCommit?.url || fallbackUrl;
  return `<div class="management-action"><strong>${esc(presentation.categoryLabel)} · ${esc(presentation.label)}</strong><small>현재 확인 사항: ${esc(issue.message || '세부 내용을 확인하세요.')}</small><small>수정 방법: ${esc(presentation.recommendedAction)}</small><small>권장 처리: ${esc(presentation.responsibleRole)} · ${esc(targetLabels[presentation.actionTarget] || 'Notion')}</small>${targetUrl ? `<div class="inline-actions"><a href="${esc(safeUrl(targetUrl))}" target="_blank" rel="noreferrer">수정할 항목 열기</a><button type="button" class="link-copy" data-copy-link="${esc(safeUrl(targetUrl))}">링크 복사</button></div>` : ''}</div>`;
}

export function issueGroupRowHtml(group, dashboard) {
  const issues = [...group.issues].sort((left, right) => (SEVERITY_RANK[left.severity] ?? 9) - (SEVERITY_RANK[right.severity] ?? 9));
  const primary = issues[0];
  const item = dashboard.workItems.find(work => work.id === primary.workItemId);
  const spec = dashboard.projects.flatMap(project => project.specs || []).find(row => row.id === primary.specId);
  const commit = dashboard.git?.commits?.find(row => row.hash === primary.metadata?.commitHash);
  const title = item?.title || spec?.title || (primary.metadata?.commitHash ? `커밋 ${primary.metadata.commitHash.slice(0, 8)}` : '프로젝트 관리 항목');
  const context = item ? `${item.spec || '상위 작업 미지정'} · ${item.team || '팀 미지정'}` : spec ? '상위 작업' : group.project;
  const summary = primaryActionSummary(issues);
  const categories = [...new Set(issues.map(issue => issuePresentation(issue).categoryLabel))];
  const detectedAt = issues.map(issue => issue.detectedAt).filter(Boolean).sort().at(-1);
  return `<details class="issue-row ${esc(group.severity)}"><summary><strong><span class="dot ${esc(group.severity)}"></span>${esc(title)} · ${esc(summary.label)}</strong><small>${esc(context)} · ${esc(categories.join(' · '))}${detectedAt ? ` · 감지 ${fmt(detectedAt)}` : ''}</small></summary><div class="management-actions">${issues.map(issue => managementActionHtml(issue, item?.url || spec?.url || commit?.url)).join('')}</div></details>`;
}

function kpi(key, value, label, tone, selectedDetail) {
  return `<button type="button" class="kpi ${tone} ${selectedDetail === key ? 'selected' : ''}" data-briefing-detail="${esc(key)}" aria-expanded="${selectedDetail === key}"><span class="value">${value ?? 0}</span><span class="label">${esc(label)}</span></button>`;
}

function briefingDetailHtml(dashboard, detail, taskRows, filters = {}) {
  if (!detail) return '';
  if (detail === 'git') {
    const rows = dashboard.projects.map(project => {
      const projectGitUrl = project.gitUrl || project.config?.gitUrl;
      const repository = dashboard.git.repositories.find(item => item.project === project.name || item.projectName === project.name)
        || (projectGitUrl && dashboard.git.repositories.find(item => item.remote === projectGitUrl || item.url === projectGitUrl))
        || { project: project.name, remote: projectGitUrl, status: projectGitUrl ? 'connected' : 'missing-url' };
      const mapping = repository.commitCount ? ` · 작업 연결 ${repository.mappedCommitCount || 0}/${repository.commitCount}` : '';
      const collectedBranches = repository.matchedBranches?.length ? repository.matchedBranches.join(', ') : repository.defaultBranch || '-';
      const unmatched = repository.unmatchedBranches?.length ? ` · 미확인 ${repository.unmatchedBranches.join(', ')}` : '';
      return `<div class="briefing-row"><strong>${esc(project.name)} · ${esc(gitRepositoryStatus(repository))}</strong><small>${esc(repository.remote || repository.url || projectGitUrl || 'Git URL 없음')} · 브랜치 ${esc(collectedBranches)}${esc(unmatched)} · 최근 활동 ${fmt(repository.latestCommitAt || repository.lastActivityAt || repository.recentGitAt)}${mapping}</small><small>마지막 수집 ${fmt(repository.lastFetchedAt)} · 출처 ${esc(repository.source || 'notion')}</small></div>`;
    });
    return `<section id="briefing-detail" class="card briefing-detail" tabindex="-1" aria-live="polite"><h3>Git 저장소 수집 상세</h3>${rows.join('') || '<div class="summary">표시할 프로젝트가 없습니다.</div>'}</section>`;
  }
  const labels = {
    projects: '진행 중 프로젝트',
    'work-items': '진행 중 작업항목',
    overdue: '기한 초과 작업항목',
    guide: '가이드 위반 작업항목',
    setup: '진행 준비 필요 항목',
  };
  const allItems = briefingDetailItems(dashboard, detail);
  const items = briefingDetailItems(dashboard, detail, filters);
  if (detail === 'projects') return `<section id="briefing-detail" class="card briefing-detail" tabindex="-1" aria-live="polite"><h3>${labels[detail]} ${items.length}개</h3>${items.map(project => `<div class="briefing-row"><strong>${esc(project.name)}</strong><small>진행 ${project.stats.inProgress}건 · 기한 초과 ${project.stats.overdue}건 · 관리 확인 ${project.stats.issueCount}건</small></div>`).join('') || '<div class="summary">해당 프로젝트가 없습니다.</div>'}</section>`;
  const shareActions = ['overdue', 'guide', 'setup'].includes(detail)
    ? `<div class="share-actions"><button type="button" class="share-primary" data-copy-slack data-share-detail="${esc(detail)}">복사</button></div>`
    : '';
  const filterToolbar = ['overdue', 'guide', 'setup'].includes(detail) ? briefingFilterHtml(allItems, filters) : '';
  return `<section id="briefing-detail" class="card briefing-detail" tabindex="-1" aria-live="polite"><div class="detail-heading"><div><h3>${labels[detail]} ${items.length}개</h3>${detail === 'setup' ? '<p>현재 스프린트에서 아직 시작 전인 항목입니다. 실행 병목·가이드 위반과는 별도 분류입니다.</p>' : shareActions ? '<p>현재 목록의 담당자·기한·확인사항·Notion 링크를 공유합니다.</p>' : ''}</div>${shareActions}</div>${filterToolbar}${taskRows(items, detail === 'overdue' ? 'overdue' : 'risk')}</section>`;
}

function disclosureRows(items, render, limit = 5) {
  return items.slice(0, limit).map(render).join('') + (items.length > limit
    ? `<details class="more-rows"><summary>나머지 ${items.length - limit}건 보기</summary>${items.slice(limit).map(render).join('')}</details>` : '');
}

function deltaValue(value) {
  if (value === null || value === undefined || value === '') return '미입력';
  return Array.isArray(value) ? value.join(', ') || '미배정' : String(value);
}

function compactText(value, fallback = '') {
  return String(value || fallback).replace(/\s+/g, ' ').trim();
}

function firstAction(value) {
  return compactText(value).split(/\s*;\s*/)[0];
}

function projectAgentSummary(dashboard, project, analysis) {
  const agent = dashboard.ai?.projects?.find(item => item.name === project.name);
  const summary = analysis.canShowNarrative && agent?.summary ? agent.summary : project.notionSummary?.summary;
  return { agent, summary: compactText(summary, '현재 진행 요약이 없습니다.') };
}

function projectProgressRows(dashboard, analysis) {
  return [...(dashboard.projects || [])]
    .sort((left, right) => (right.stats?.inProgress || 0) - (left.stats?.inProgress || 0) || (right.stats?.issueCount || 0) - (left.stats?.issueCount || 0))
    .map(project => {
      const stats = project.stats || {};
      const narrative = projectAgentSummary(dashboard, project, analysis);
      const counts = stats.total
        ? `완료 ${stats.done || 0}/${stats.total} · 진행 ${stats.inProgress || 0} · 예정 ${stats.planned || 0} · 검토 ${stats.review || 0}`
        : `진행 ${stats.inProgress || 0} · 예정 ${stats.planned || 0} · 검토 ${stats.review || 0}`;
      return { project, text: `${counts} · ${narrative.summary}` };
    });
}

function buildReleaseRows(dashboard) {
  const rows = [];
  for (const project of dashboard.projects || []) {
    for (const insight of project.specInsights || []) {
      for (const item of insight.evidence || []) {
        if (/빌드|출시|배포|릴리즈|릴리스|핫픽스|롤백|QA/i.test(`${insight.title || ''} ${item.excerpt || ''}`)) {
          rows.push({ project: project.name, ...item });
        }
      }
    }
  }
  rows.sort((left, right) => String(right.timestamp || '').localeCompare(String(left.timestamp || '')));
  const seen = new Set();
  return rows.filter(row => {
    const key = `${row.project}:${row.excerpt}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 4);
}

function sourceStatusRows(dashboard, analysis) {
  const labels = { notion: 'Notion', slack: 'Slack', meetings: '회의록', 'agent-analysis': '통합 분석', 'rule-input': '규칙 입력' };
  const sources = (dashboard.sourceHealth?.sources || []).map(source => {
    const state = source.id === 'agent-analysis' ? analysis.label : ({ ok: '정상', partial: '부분 수집', failed: '수집 실패' }[source.status] || '상태 미정');
    const count = source.expected > 1 ? ` · ${source.successful || 0}/${source.expected}` : '';
    return `${labels[source.id] || source.id} ${state}${count} · ${fmt(source.lastSuccessAt)}`;
  });
  return sources.length ? sources : ['데이터 수집 상태를 확인할 수 없습니다.'];
}

function executionBlockers(dashboard, analysis) {
  if (!analysis.canShowNarrative) return [];
  const projects = dashboard.ai?.projects || [];
  const blockers = projects.flatMap(project => [
    ...(project.blockers || []).map(item => `[${project.name}] ${item}`),
    ...(project.specSummaries || []).flatMap(spec => (spec.blockers || []).map(item => `[${project.name}] ${item}`)),
  ]);
  return [...new Set([...blockers, ...(dashboard.ai?.overall?.topRisks || [])].map(compactText).filter(Boolean))].slice(0, 5);
}

function nextMajorActions(dashboard, analysis) {
  const actions = (dashboard.projects || []).flatMap(project => {
    const { agent } = projectAgentSummary(dashboard, project, analysis);
    const candidate = analysis.canShowNarrative ? agent?.nextActions?.[0] : null;
    return [{ project: project.name, action: firstAction(candidate || project.notionSummary?.nextAction) }];
  });
  return actions.filter(item => item.action).slice(0, 5);
}

function analysisFactHtml(title, content, empty = '현재 스냅샷에 표시할 정보가 없습니다.') {
  return `<article class="analysis-fact"><h4>${esc(title)}</h4>${content || `<p class="analysis-fact-empty">${esc(empty)}</p>`}</article>`;
}

function integratedAnalysisFactsHtml(dashboard, analysis) {
  const progress = disclosureRows(projectProgressRows(dashboard, analysis), row => `<div class="analysis-fact-row"><strong>${esc(row.project.name)}</strong><span>${esc(row.text)}</span></div>`, 4);
  const buildRows = buildReleaseRows(dashboard);
  const build = buildRows.map(row => `<div class="analysis-fact-row"><strong>${esc(row.project)}</strong><span>${esc(row.excerpt)} · ${esc(row.source || '출처')} ${fmt(row.timestamp)}</span></div>`).join('');
  const data = sourceStatusRows(dashboard, analysis).map(row => `<div class="analysis-fact-row"><span>${esc(row)}</span></div>`).join('');
  const blockers = executionBlockers(dashboard, analysis).map(row => `<div class="analysis-fact-row"><span>${esc(row)}</span></div>`).join('');
  const metrics = dashboard.metrics || {};
  const checks = [
    `기한 초과 ${metrics.overdueWorkItems ?? 0}건`,
    `가이드 위반 ${metrics.guideViolationWorkItems ?? 0}건`,
    `진행 준비 ${metrics.progressSetupRequiredItems ?? 0}건`,
    `확인 필요 프로젝트 ${metrics.needsCheckProjects ?? 0}개`,
  ].map(row => `<div class="analysis-fact-row"><span>${esc(row)}</span></div>`).join('');
  const actions = nextMajorActions(dashboard, analysis).map(row => `<div class="analysis-fact-row"><strong>${esc(row.project)}</strong><span>${esc(row.action)}</span></div>`).join('');
  return `<div class="analysis-facts">${analysisFactHtml('현재 진행', progress)}${analysisFactHtml('빌드·출시 현황', build, '직접 연결된 빌드·출시 근거가 없습니다.')}${analysisFactHtml('데이터 현황', data)}${analysisFactHtml('실행 병목', blockers, analysis.canShowNarrative ? '통합 분석에 기록된 실행 병목이 없습니다.' : '분석 결과를 확인할 수 없어 실행 병목을 판단할 수 없습니다.')}${analysisFactHtml('확인 필요', checks)}${analysisFactHtml('다음 주요 행동', actions, '확인된 다음 행동이 없습니다.')}</div>`;
}

function trustBriefingHtml(dashboard, analysis) {
  const git = gitTrustSummary(dashboard.git || {}, dashboard.projects || []);
  const sources = [...sourceStatusRows(dashboard, analysis), git.label];
  const sourceRows = sources.map(row => `<div class="trust-source-row"><span>${esc(row)}</span></div>`).join('');
  const limits = dashboard.ai?.overall?.confidenceLimits || [];
  return `<section class="card briefing-section trust-section" aria-labelledby="trust-title"><div class="briefing-heading"><h3 id="trust-title">2. 데이터 신뢰 확인</h3><span class="section-note">수집 상태·분석 최신성·판단 제한</span></div><div class="trust-grid"><div class="trust-item"><span>분석 최신성</span><strong>${esc(analysis.label)}</strong><small>${esc(analysis.notice || `분석 ${fmt(dashboard.ai?.generatedAt)} · 한국 시간`)}</small></div><div class="trust-item trust-sources"><span>출처별 수집 상태</span>${sourceRows}</div><div class="trust-item"><span>해석 기준</span><small>규칙 사실, 에이전트 해석, 출처 확인 후보를 서로 다른 확실성으로 표시합니다.</small></div></div>${limits.length ? `<details class="analysis-limits"><summary>분석 범위의 제한 ${limits.length}건</summary><ul>${limits.map(limit => `<li>${esc(limit)}</li>`).join('')}</ul></details>` : ''}</section>`;
}

function managementBlockersHtml(dashboard) {
  const groups = groupIssuesByProjectItem(dashboard.validationIssues || [])
    .flatMap(group => group.items)
    .sort((left, right) => (SEVERITY_RANK[left.severity] ?? 9) - (SEVERITY_RANK[right.severity] ?? 9))
    .slice(0, 5);
  return `<section class="card briefing-section management-blockers top-level" aria-labelledby="blockers-title"><div class="briefing-heading"><h3 id="blockers-title">3. 현재 관리상 막힌 것</h3><span class="section-note">규칙 엔진이 확인한 수정 필요 항목</span></div><div class="issue-list">${groups.map(group => issueGroupRowHtml(group, dashboard)).join('') || '<p class="empty-note">즉시 확인할 관리 병목이 없습니다.</p>'}</div></section>`;
}

function projectJumpButton(projectName, knownProjects) {
  if (!projectName || !knownProjects.has(projectName)) return '';
  return `<button type="button" class="context-link" data-project-jump="${esc(projectName)}">관련 프로젝트·근거 보기</button>`;
}

function projectManagementStatus(project) {
  const labels = { error: '관리 오류', warning: '관리 주의', check: '관리 확인', normal: '관리 정상' };
  const tone = ['error', 'warning', 'check', 'normal'].includes(project.managementStatus) ? project.managementStatus : 'gray';
  return { label: labels[project.managementStatus] || '관리 확인', tone };
}

function projectCurrentStatus(project) {
  const value = project.notionSummary?.status || '';
  const tone = value === '정상' ? 'normal' : value === '주의' ? 'warning' : 'gray';
  return { label: value || '상태 미정', tone };
}

function projectStatusBriefingHtml(dashboard, knownProjects, analysis, riskHtml, riskCount) {
  const projects = [...(dashboard.projects || [])].sort((left, right) => {
    const issueDelta = (right.stats?.issueCount || 0) - (left.stats?.issueCount || 0);
    return issueDelta || String(left.name || '').localeCompare(String(right.name || ''), 'ko');
  });
  const rows = projects.map(project => {
    const stats = project.stats || {};
    const current = projectCurrentStatus(project);
    const management = projectManagementStatus(project);
    const activity = stats.total
      ? `완료 ${stats.done || 0}/${stats.total} · 진행 ${stats.inProgress || 0} · 예정 ${stats.planned || 0} · 검토 ${stats.review || 0}`
      : `진행 ${stats.inProgress || 0} · 예정 ${stats.planned || 0} · 검토 ${stats.review || 0}`;
    const attention = [
      stats.overdue ? `기한 초과 ${stats.overdue}` : '',
      stats.issueCount ? `관리 확인 ${stats.issueCount}` : '',
    ].filter(Boolean).join(' · ') || '확인 항목 없음';
    const summary = project.notionSummary?.summary || '프로젝트 현황 요약이 없습니다.';
    return `<article class="project-status-row"><div class="project-status-main"><div class="project-status-name"><strong>${esc(project.name)}</strong><span class="status"><span class="dot ${current.tone}"></span>${esc(current.label)}</span><span class="status"><span class="dot ${management.tone}"></span>${esc(management.label)}</span></div><p class="project-status-summary">${esc(summary)}</p></div><div class="project-status-meta"><div class="project-status-metrics"><span>${esc(activity)}</span><span>${esc(attention)}</span></div>${projectJumpButton(project.name, knownProjects)}</div></article>`;
  }).join('');
  const riskSection = `<section class="card analysis-risks" aria-labelledby="risk-title"><div class="briefing-heading"><h4 id="risk-title">분석에서 짚은 위험 신호 <span class="section-count">${riskCount}건</span></h4></div><p class="section-note">현재 프로젝트 진행에 영향을 줄 수 있다고 에이전트가 표시한 확인 신호입니다. 확정 장애나 관리 데이터 오류와는 구분합니다.</p>${riskHtml ? `<div class="risk-list">${riskHtml}</div>` : `<p class="empty-note">${analysis.status === 'success' ? '이번 분석에 기록된 위험 신호가 없습니다.' : '표시할 위험 신호가 없습니다. 위험이 없다는 뜻은 아닙니다.'}</p>`}</section>`;
  return `<section class="project-status-briefing" aria-labelledby="project-status-title"><div class="briefing-heading"><h4 id="project-status-title">프로젝트 현황 브리핑 <span class="section-count">${projects.length}개</span></h4><span class="section-note">통합 분석의 근거가 되는 프로젝트 진행·출시·실행 현황</span></div>${integratedAnalysisFactsHtml(dashboard, analysis)}${riskSection}<div class="project-status-list"><div class="project-status-list-heading"><strong>프로젝트별 최신 상태</strong><span class="section-note">상태·진척·관리 확인 항목</span></div>${rows || '<p class="empty-note">표시할 프로젝트가 없습니다.</p>'}</div></section>`;
}

export function briefingHtml(dashboard, selectedDetail, taskRows, briefingFilters = {}) {
  const metrics = dashboard.metrics;
  const analysis = analysisPresentation(dashboard);
  const overall = analysis.canShowNarrative ? dashboard.ai?.overall || {} : {};
  const decisions = (overall.decisionsForCEO || []).filter(item => item.question);
  const risks = overall.topRisks || [];
  const candidates = (dashboard.projects || []).flatMap(project => {
    const evidence = (project.specInsights || []).flatMap(insight => (insight.evidence || [])
      .filter(item => item.attention)
      .map(item => ({ ...item, project: project.name, title: insight.title })))
      .sort((left, right) => String(right.timestamp || '').localeCompare(String(left.timestamp || '')));
    return evidence.length ? [evidence[0]] : [];
  });
  const noDecisions = analysis.status === 'success'
    ? '이번 분석에 기록된 대표 결정 요청이 없습니다.'
    : '표시할 결정 요청이 없습니다. 분석 범위와 최신성을 먼저 확인하세요.';
  const knownProjects = new Set((dashboard.projects || []).map(project => project.name));
  const decisionHtml = disclosureRows(decisions, item => `<article class="decision-row"><span class="project-label">${esc(item.project || '전체')}</span><div><h4>${esc(item.question)}</h4>${item.context ? `<p>${esc(item.context)}</p>` : ''}${projectJumpButton(item.project, knownProjects)}</div></article>`);
  const riskHtml = disclosureRows(risks, risk => {
    const projectName = [...knownProjects].find(name => String(risk).startsWith(`[${name}]`));
    return `<article class="risk-row"><p>${esc(risk)}</p>${projectJumpButton(projectName, knownProjects)}</article>`;
  });
  const fields = { 'task.status': '작업 상태', 'task.due': '마감일', 'task.assignees': '담당자', 'project.status': '프로젝트 상태', 'project.completionRate': '완료율' };
  const deltas = dashboard.deltas || [];
  const deltaHtml = disclosureRows(deltas, delta => `<div class="change-row"><div><span class="project-label">${esc(delta.project)}</span><strong>${esc(delta.taskTitle || '프로젝트')}</strong></div><div class="change-values"><span>${esc(fields[delta.field] || delta.field)}</span><span class="previous-value">${esc(deltaValue(delta.from))}</span><span aria-label="변경 후">→</span><strong>${esc(deltaValue(delta.to))}</strong></div></div>`);
  const summary = overall.summary || '표시할 통합 분석이 없습니다. 수집 상태와 분석 실행 여부를 확인하세요.';
  const integratedAnalysisHtml = `<div class="integrated-analysis-summary"><div class="briefing-heading"><h4 id="analysis-title">에이전트 통합 분석</h4><span class="badge gray">${esc(analysis.label)}</span></div><p class="summary analysis-summary">${esc(summary)}</p>${projectStatusBriefingHtml(dashboard, knownProjects, analysis, riskHtml, risks.length)}</div>`;
  return `<div class="section-head"><div><h2>업무 브리핑</h2><p>대표 판단·통합 분석 → 데이터 신뢰 → 관리상 막힌 것 → 전일 변화 순서입니다. 이 화면은 읽기 전용입니다.</p></div></div>
    <div class="analysis-state ${analysis.status === 'success' ? '' : 'limited'}" role="status"><strong>${esc(analysis.label)}</strong><span>${esc(analysis.notice)}</span><span class="analysis-time">분석 ${fmt(dashboard.ai?.generatedAt)} · 한국 시간</span></div>
    <section class="card briefing-section decision-section" aria-labelledby="decision-title"><div class="briefing-heading"><h3 id="decision-title">1. 대표가 확인할 판단 <span class="section-count">${decisions.length}건</span></h3><span class="section-note">분석에 명시된 선택·승인 요청만 표시</span></div>${decisionHtml || `<p class="empty-note">${noDecisions}</p>`}${integratedAnalysisHtml}</section>
    ${trustBriefingHtml(dashboard, analysis)}
    ${managementBlockersHtml(dashboard)}
    <section class="card briefing-section briefing-changes" aria-labelledby="changes-title"><div class="briefing-heading"><h3 id="changes-title">4. 어제와 달라진 것 <span class="section-count">${deltas.length}건</span></h3><span class="section-note">작업 정보의 변화 · ${dashboard.snapshotComparison?.previousGeneratedAt ? `${fmt(dashboard.snapshotComparison.previousGeneratedAt)} 수집 대비` : '이전 수집 결과와 비교'}</span></div>${deltaHtml || `<p class="empty-note">${esc(dashboard.snapshotComparison?.reason || '비교한 작업 정보에서 변화가 감지되지 않았습니다.')}</p>`}</section>
    <details class="candidate-section"><summary>출처에서 찾은 확인 후보 <span class="section-count">${candidates.length}개 프로젝트</span><span class="section-note">분석상 위험으로 확정되지 않은 신호</span></summary><p class="section-note">프로젝트별 최신 신호입니다. 이미 해결된 내용인지 원문에서 확인하세요.</p>${candidates.map(item => `<article class="candidate-row"><span class="project-label">${esc(item.project)}</span><strong>${esc(item.title)}</strong><p>${esc(item.excerpt)}</p><small>${fmt(item.timestamp)}${safeUrl(item.url) !== '#' ? ` · <a href="${esc(safeUrl(item.url))}" target="_blank" rel="noreferrer">근거 원문 열기</a>` : ' · 원문 링크 없음'}</small></article>`).join('') || '<p class="empty-note">수집된 확인 후보가 없습니다.</p>'}</details>
    <section class="management-section" aria-labelledby="management-title"><div class="section-head"><div><h3 id="management-title">관리 점검</h3><p>숫자를 선택하면 상세 목록을 볼 수 있습니다. 항목 간 중복이 있어 합산하지 않습니다.</p></div></div>
    <div class="kpis">${kpi('projects', metrics.activeProjects, '진행 중 프로젝트', 'info', selectedDetail)}${kpi('work-items', metrics.inProgressWorkItems, '진행 중 작업항목', 'normal', selectedDetail)}${kpi('overdue', metrics.overdueWorkItems, '기한 초과 작업항목', metrics.overdueWorkItems ? 'error' : '', selectedDetail)}${kpi('guide', metrics.guideViolationWorkItems, '가이드 위반 작업항목', '', selectedDetail)}${kpi('setup', metrics.progressSetupRequiredItems, '진행 준비 필요 항목', '', selectedDetail)}</div>
    ${briefingDetailHtml(dashboard, selectedDetail, taskRows, briefingFilters)}
    </section>`;
}
