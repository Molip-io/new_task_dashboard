import { analysisPresentation, formatKst as fmt, projectAnalysisPresentation } from './dashboard-analysis.js';
import {
  filterPeopleWorkload,
  filterSpecsWithWorkItems,
  filterVisibleIssues,
  filterWorkItems,
  groupIssuesByProjectItem,
  groupSpecsBySprint,
  isClosedWorkItem,
  projectShouldBeOpen,
  resolveProjectControls,
  resolveSpecInsight,
  sortPeople,
  sortProjects,
  sortWorkItems,
  visibleWorkItemIssues,
  workStatusTone,
} from './dashboard-view-model.js';
import {
  briefingDetailItems,
  gitTrustSummary,
  dashboardShareUrl,
  ISSUE_CATEGORIES,
  issueMatchesCategory,
  issuePresentation,
  primaryActionSummary,
  slackWorkItemsMessage,
} from './dashboard-management.js';
import { briefingHtml, issueGroupRowHtml, managementActionHtml } from './dashboard-presenters.js';
import { deriveSpecStatus } from './spec-state.js';
import { demoDashboard } from './dashboard-demo.js';
import { scopeBriefing } from './briefing-scope.js';

let D = null;
const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
const safeUrl = value => /^(https?:\/\/|#)/.test(String(value || '')) ? value : '#';
const DONE = new Set(['완료', '일시 정지', '정지', '중단']);
const TONES = new Set(['error', 'warning', 'check', 'info', 'normal', 'gray', 'done', 'review']);

const saved = JSON.parse(localStorage.getItem('dashboard-preferences') || '{}');
const query = new URLSearchParams(location.search);
const queryTab = query.get('tab');
const demoMode = query.get('demo') === '1';
const queryDetail = query.get('detail');
const queryBriefingFilters = {
  project: query.get('briefingProject') || '',
  team: query.get('briefingTeam') || '',
  assignee: query.get('briefingAssignee') || '',
};
const queryCheckFilters = {
  project: query.get('checkProject') || '',
  category: query.get('checkCategory') || '',
  issueType: query.get('checkIssue') || '',
};
const state = {
  tab: queryTab || saved.tab || 'briefing',
  personSort: saved.personSort || 'default',
  peopleFilters: saved.peopleFilters || {},
  personDetails: saved.personDetails || {},
  projectControls: saved.projectControls || {},
  checkFilters: queryTab === 'checks' ? queryCheckFilters : saved.checkFilters || {},
  briefingDetail: queryTab === 'briefing' ? queryDetail : saved.briefingDetail || null,
  briefingFilters: queryTab === 'briefing' && queryDetail ? { ...(saved.briefingFilters || {}), [queryDetail]: queryBriefingFilters } : saved.briefingFilters || {},
  openProject: saved.openProject || null,
  openPerson: saved.openPerson || null,
};

function persist() {
  localStorage.setItem('dashboard-preferences', JSON.stringify(state));
  const shareUrl = new URL(dashboardShareUrl(location.href, state));
  if (demoMode) shareUrl.searchParams.set('demo', '1');
  history.replaceState(null, '', shareUrl.toString());
}

function badge(value, severity = value) {
  const tone = TONES.has(severity) ? severity : 'info';
  return `<span class="status"><span class="dot ${tone}"></span>${esc(value)}</span>`;
}

function normalize(raw) {
  const workItems = raw.workItems?.length ? raw.workItems : (raw.workload || []).flatMap((person, personIndex) => (person.tasks || []).map((task, index) => {
    const id = task.id || `sample-${personIndex}-${index}`;
    const overdue = task.due && task.due < new Date().toISOString().slice(0, 10) && !DONE.has(task.status);
    const issues = overdue ? [{ id: `OVERDUE:${id}`, type: 'OVERDUE', severity: 'warning', message: '기한 초과', project: task.project, workItemId: id, detectedAt: raw.generatedAt, recommendedAction: '지연 사유와 변경 일정을 확인하세요.', metadata: {} }] : [];
    return {
    id, title: task.title, project: task.project, spec: task.spec || '상위 작업 미지정',
    status: task.status, team: person.teams?.[0] || '기타', assignees: [person.name], start: task.start || null,
    due: task.due || null, completedAt: task.completedAt || null, sprint: task.sprint || null, notionUpdatedAt: task.notionUpdatedAt || null,
    latestGitAt: task.latestGitAt || null, overdueDays: overdue ? 1 : 0,
    staleBusinessDays: 0, issues, riskScore: overdue ? 31 : 0, guideStatus: overdue ? 'warning' : 'normal', url: task.url,
  }; }));
  const allValidationIssues = raw.validationIssues || workItems.flatMap(item => item.issues || []);
  for (const item of workItems) {
    item.issues ||= allValidationIssues.filter(issue => issue.workItemId === item.id);
    item.riskScore ||= item.issues.reduce((sum, issue) => sum + ({ error: 100, warning: 30, check: 10, info: 2 }[issue.severity] || 0), 0);
  }
  const projectsWithAllIssues = (raw.projects || []).map(project => {
    const items = workItems.filter(item => item.project === project.name);
    const stats = { ...project.stats, total: items.length, done: items.filter(item => item.status === '완료').length, inProgress: items.filter(item => item.status === '진행 중').length, planned: items.filter(item => ['진행 예정', '시작 전'].includes(item.status)).length, review: items.filter(item => ['확인 요청', '검토중'].includes(item.status)).length, overdue: items.filter(item => item.overdueDays > 0).length };
    stats.completionRate = project.stats?.completionRate ?? (stats.total ? Math.round(stats.done / stats.total * 100) : 0);
    return { ...project, stats, recentGitAt: project.recentGitAt || null, specs: project.specs || [] };
  });
  const validationIssues = filterVisibleIssues(allValidationIssues, workItems, projectsWithAllIssues);
  const projects = projectsWithAllIssues.map(project => {
    const items = workItems.filter(item => item.project === project.name);
    const issues = validationIssues.filter(issue => issue.project === project.name);
    const activeItems = items.filter(item => !isClosedWorkItem(item));
    const missingData = activeItems.filter(item => item.issues.some(issue => ['MISSING_START_DATE', 'MISSING_DUE_DATE', 'MISSING_ASSIGNEE', 'MISSING_PROJECT', 'MISSING_SPEC'].includes(issue.type))).length;
    const managementStatus = issues.some(issue => issue.severity === 'error') ? 'error' : issues.some(issue => issue.severity === 'warning') ? 'warning' : issues.length ? 'check' : 'normal';
    const issueCount = groupIssuesByProjectItem(issues.filter(issue => issue.severity !== 'info')).reduce((sum, group) => sum + group.items.length, 0);
    return { ...project, issues, managementStatus, stats: { ...project.stats, missingData, issueCount } };
  });
  const activeWorkItems = workItems.filter(item => !isClosedWorkItem(item));
  const hasGuideViolationItems = Array.isArray(raw.guideViolationItems);
  const guideViolationItems = (raw.guideViolationItems || []).map(item => ({
    ...item,
    issues: item.issues?.length
      ? item.issues
      : allValidationIssues.filter(issue => issue.workItemId === item.id || (!issue.workItemId && issue.specId === item.id)),
  }));
  const progressSetupItems = (raw.progressSetupItems || []).map(item => ({
    ...item,
    issues: item.issues?.length
      ? item.issues
      : allValidationIssues.filter(issue => issue.workItemId === item.id || (!issue.workItemId && issue.specId === item.id)),
  }));
  const problemIds = new Set(validationIssues.filter(issue => issue.workItemId && issueMatchesCategory(issue, 'guide')).map(issue => issue.workItemId));
  const problemItems = activeWorkItems.filter(item => problemIds.has(item.id));
  const workload = (raw.workload || []).map(person => ({
    ...person,
    tasks: (person.tasks || []).map(task => workItems.find(item => item.id === task.id) || workItems.find(item => item.title === task.title && item.project === task.project && item.assignees.includes(person.name)) || { ...task, assignees: [person.name], issues: [], overdueDays: 0, staleBusinessDays: 0, riskScore: 0 }),
  }));
  const metrics = {
    ...(raw.metrics || {}),
    activeProjects: projects.filter(project => project.stats.inProgress + project.stats.planned + project.stats.review > 0).length,
    inProgressWorkItems: activeWorkItems.filter(item => item.status === '진행 중').length,
    overdueWorkItems: activeWorkItems.filter(item => item.overdueDays > 0).length,
    missingDateWorkItems: activeWorkItems.filter(item => item.issues.some(issue => ['MISSING_START_DATE', 'MISSING_DUE_DATE'].includes(issue.type))).length,
    guideViolationWorkItems: hasGuideViolationItems ? guideViolationItems.length : problemItems.length,
    progressSetupRequiredItems: progressSetupItems.length,
    pastSprintNotStartedItems: raw.metrics?.pastSprintNotStartedItems || 0,
    futureSprintExcludedItems: raw.metrics?.futureSprintExcludedItems || 0,
    ruleNotEvaluatedItems: raw.metrics?.ruleNotEvaluatedItems || 0,
    excludedStatusWorkItems: raw.metrics?.excludedStatusWorkItems || 0,
    needsCheckProjects: projects.filter(project => project.managementStatus !== 'normal').length,
    recentGitProjects: raw.metrics?.recentGitProjects || 0,
    gitNotionMismatchProjects: raw.metrics?.gitNotionMismatchProjects || 0,
    normalWorkItems: activeWorkItems.length - problemItems.length,
    totalWorkItems: raw.metrics?.totalWorkItems ?? activeWorkItems.length,
  };
  return { ...raw, projects, workItems, guideViolationItems, progressSetupItems, workload, validationIssues, metrics, git: raw.git || { repositories: [], commits: [], errors: [] }, notionSetup: raw.notionSetup || { ready: false, databases: [] }, deltas: raw.deltas || [] };
}

function renderTrust() {
  const health = D.sourceHealth;
  const analysis = analysisPresentation(D);
  const sourceLabels = { notion: 'Notion', slack: 'Slack', meetings: '회의록', 'agent-analysis': '통합 분석', 'rule-input': '원격 규칙 입력' };
  const sources = health?.sources?.map(source => {
    const result = source.id === 'agent-analysis'
      ? analysis.label
      : source.status === 'ok' ? '성공' : source.status === 'partial' ? '부분 성공' : '실패';
    const tone = source.id === 'agent-analysis'
      ? analysis.status === 'success' ? 'ok' : analysis.status === 'failed' ? 'unavailable' : 'partial'
      : source.status;
    return `<span class="source ${tone}">${esc(sourceLabels[source.id] || source.id)} ${esc(result)}${source.expected > 1 ? ` ${source.successful}/${source.expected}` : ''}</span>`;
  }).join('') || '<span class="source partial">출처 상태 미측정</span>';
  const setup = D.notionSetup.ready ? '<span class="source ok">Notion 필수 속성 정상</span>' : `<span class="source partial">Notion 설정 확인 ${D.notionSetup.databases?.flatMap(db => db.missingProperties || []).length || 0}건</span>`;
  const git = gitTrustSummary(D.git, D.projects);
  const limited = !health?.sources?.length || health.sources.some(source => source.status !== 'ok')
    || analysis.status !== 'success' || !D.notionSetup.ready || git.tone !== 'ok';
  $('#trustLine').innerHTML = `<details class="source-disclosure"><summary>데이터 수집 상태 <strong>${limited ? '일부 확인 필요' : '수집 완료'}</strong><span>상세 보기</span></summary><div class="source-items">${sources}${setup}<button type="button" class="source ${git.tone}" data-briefing-detail="git" aria-expanded="${state.briefingDetail === 'git'}">${esc(git.label)}</button></div></details>`;
  $('[data-briefing-detail="git"]').onclick = () => openBriefingDetail('git');
}

function openBriefingDetail(detail) {
  state.briefingDetail = state.briefingDetail === detail ? null : detail;
  state.tab = 'briefing';
  persist(); renderTrust(); renderBriefing(); activateTab('briefing');
  if (state.briefingDetail) {
    const detailPanel = $('#briefing-detail');
    detailPanel?.focus({ preventScroll: true });
    detailPanel?.scrollIntoView({ block: 'start' });
  } else {
    document.querySelector(`[data-briefing-detail="${detail}"]`)?.focus();
  }
}

async function writeClipboard(text) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  const field = document.createElement('textarea');
  field.value = text;
  field.setAttribute('readonly', '');
  field.style.position = 'fixed';
  field.style.opacity = '0';
  document.body.appendChild(field);
  field.select();
  const copied = document.execCommand('copy');
  field.remove();
  if (!copied) throw new Error('clipboard_unavailable');
}

async function copyWithFeedback(button, text, successLabel) {
  const original = button.textContent;
  try {
    await writeClipboard(text);
    button.textContent = successLabel;
    button.classList.add('copy-confirmed');
  } catch {
    button.textContent = '복사 실패';
  }
  setTimeout(() => {
    if (!button.isConnected) return;
    button.textContent = original;
    button.classList.remove('copy-confirmed');
  }, 1800);
}

function bindCopyActions(container, shareContext = null) {
  if (!container) return;
  container.querySelectorAll('[data-copy-link]').forEach(button => {
    button.onclick = () => copyWithFeedback(button, button.dataset.copyLink, '링크 복사됨');
  });
  container.querySelectorAll('[data-copy-slack]').forEach(button => {
    if (!shareContext?.items?.length) button.disabled = true;
    button.onclick = () => {
      if (!shareContext?.items?.length) return;
      const dashboardUrl = dashboardShareUrl(location.href, state);
      const message = slackWorkItemsMessage(shareContext.items, {
        title: shareContext.title,
        generatedAt: D.generatedAt,
        dashboardUrl,
        category: shareContext.category,
        issueType: shareContext.issueType,
      });
      copyWithFeedback(button, message, `${shareContext.items.length}건 복사됨`);
    };
  });
}

const briefingView = { project: null, scope: {} };

function renderBriefing() {
  const filters = state.briefingFilters?.[state.briefingDetail] || {};
  $('#tab-briefing').innerHTML = briefingHtml(D, state.briefingDetail, taskRows, filters, briefingView);
  document.querySelectorAll('#tab-briefing [data-briefing-detail]').forEach(button => button.onclick = () => openBriefingDetail(button.dataset.briefingDetail));
  const projectSelect = $('[data-briefing-project]');
  projectSelect.onchange = () => {
    briefingView.project = projectSelect.value;
    renderBriefing();
    $('[data-briefing-project]')?.focus();
  };
  document.querySelectorAll('[data-scope-filter]').forEach(control => control.onchange = () => {
    const key = control.dataset.scopeFilter;
    briefingView.scope[key] = control.value;
    renderBriefing();
    document.querySelector(`[data-scope-filter="${key}"]`)?.focus();
  });
  $('[data-scope-reset]').onclick = () => {
    briefingView.scope = {};
    state.briefingFilters = {};
    renderBriefing();
    $('[data-scope-reset]')?.focus();
  };
  const search = $('[data-sprint-search]');
  const filterSprintOptions = () => {
    const value = search.value.toLowerCase().replace(/\s+/g, '');
    document.querySelectorAll('.sprint-choice').forEach(row => {
      row.hidden = !row.textContent.toLowerCase().replace(/\s+/g, '').includes(value) && !row.querySelector('input').value.includes(value);
    });
  };
  search.oninput = filterSprintOptions;
  document.querySelectorAll('[data-briefing-sprint]').forEach(control => control.onchange = () => {
    const selected = new Set(briefingView.scope.sprints || []);
    if (control.checked) selected.add(control.value); else selected.delete(control.value);
    briefingView.scope.sprints = [...selected];
    const searchValue = search.value;
    const value = control.value;
    renderBriefing();
    $('.sprint-picker').open = true;
    $('[data-sprint-search]').value = searchValue;
    $('[data-sprint-search]').dispatchEvent(new Event('input'));
    [...document.querySelectorAll('[data-briefing-sprint]')].find(item => item.value === value)?.focus();
  });
  $('[data-clear-sprints]').onclick = () => {
    briefingView.scope.sprints = [];
    renderBriefing();
    $('.sprint-picker > summary')?.focus();
  };
  $('.sprint-picker').onkeydown = event => {
    if (event.key !== 'Escape') return;
    $('.sprint-picker').open = false;
    $('.sprint-picker > summary')?.focus();
  };
  document.querySelectorAll('#tab-briefing [data-project-jump]').forEach(button => button.onclick = () => {
    const projectName = button.dataset.projectJump;
    if (!D.projects.some(project => project.name === projectName)) return;
    state.openProject = projectName;
    renderProjects();
    activateTab('projects');
    requestAnimationFrame(() => {
      const card = [...document.querySelectorAll('[data-project-card]')].find(item => item.dataset.projectCard === projectName);
      card?.scrollIntoView({ block: 'start' });
      card?.querySelector(':scope > summary')?.focus();
    });
  });
  const shareDetail = state.briefingDetail;
  const shareContext = ['overdue', 'guide', 'setup'].includes(shareDetail) ? {
    items: briefingDetailItems(scopeBriefing(D, { ...filters, ...briefingView.scope }), shareDetail),
    title: shareDetail === 'overdue' ? '기한 초과 작업항목'
      : shareDetail === 'guide' ? '가이드 위반 작업항목'
        : '진행 준비 필요 항목',
    category: shareDetail === 'overdue' ? 'schedule' : shareDetail === 'guide' ? 'guide' : 'readiness',
  } : null;
  bindCopyActions($('#tab-briefing'), shareContext);
}

function aiProject(name) { return D.ai?.projects?.find(project => project.name === name) || null; }

function projectAnalysis(project) {
  return projectAnalysisPresentation(D, project);
}

function options(values, current, allLabel = '전체') {
  return `<option value="">${allLabel}</option>${[...new Set(values.filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), 'ko')).map(value => `<option value="${esc(value)}" ${value === current ? 'selected' : ''}>${esc(value)}</option>`).join('')}`;
}

function projectSpecs(project, items) {
  const source = project.specs.length ? project.specs : [...new Set(items.map(item => item.spec || '상위 작업 미지정'))].map((title, index) => ({ id: `${project.name}-${index}`, title, status: '', tasks: [] }));
  return filterSpecsWithWorkItems(source.map(spec => {
    const tasksById = new Map((spec.tasks || []).map(item => [item.id, item]));
    for (const item of items.filter(item => item.spec === spec.title || item.specId === spec.id)) tasksById.set(item.id, item);
    const tasks = [...tasksById.values()];
    const taskSprints = [...new Set(tasks.map(item => item.sprint).filter(Boolean))];
    return { ...spec, status: deriveSpecStatus(tasks), tasks, risk: tasks.reduce((sum, item) => sum + item.riskScore, 0), overdue: tasks.filter(item => item.overdueDays).length, progress: tasks.length ? Math.round(tasks.filter(item => DONE.has(item.status)).length / tasks.length * 100) : 0, sprint: spec.sprint || (taskSprints.length === 1 ? taskSprints[0] : null) };
  }));
}

function taskRows(items, sort = 'risk') {
  const rows = sortWorkItems(items, sort);
  if (!rows.length) return '<div class="summary empty-inline">표시할 작업항목이 없습니다.</div>';
  return `<div class="task-row header"><span>작업항목</span><span>상태</span><span>담당자</span><span>기간</span><span title="날짜·담당자·기한 등 Notion 관리 데이터 점검">관리 확인</span></div>${rows.map(item => {
    const closed = isClosedWorkItem(item);
    const issues = visibleWorkItemIssues(item);
    const action = primaryActionSummary(issues);
    const management = closed
      ? `<span data-label="관리 확인">${badge('완료','normal')}</span>`
      : issues.length
        ? `<details class="management-check" data-management-check data-label="관리 확인"><summary>${badge(action.label, action.tone)}</summary><div class="management-actions">${issues.map(issue => managementActionHtml(issue, item.url)).join('')}</div></details>`
        : `<span data-label="관리 확인">${badge('정상','normal')}</span>`;
    const itemUrl = safeUrl(item.url);
    const copyLink = itemUrl !== '#' ? `<button type="button" class="link-copy" data-copy-link="${esc(itemUrl)}">링크 복사</button>` : '';
    return `<div class="task-row"><span class="task-title"><span class="task-title-line"><a href="${esc(itemUrl)}" target="_blank">${esc(item.title)}</a>${copyLink}</span><small>${esc(item.project)} · ${esc(item.spec || '상위 작업 미지정')} · ${esc(item.team || '-')} ${item.sprint ? `· ${esc(item.sprint)}` : ''}</small></span><span data-label="상태">${badge(item.status || '미정', workStatusTone(item))}</span><span data-label="담당자">${esc((item.assignees || []).join(', ') || '미지정')}</span><span data-label="기간" class="${item.overdueDays ? 'overdue':''}">${esc(item.start || '-')} → ${esc(item.due || '-')} ${item.completedAt ? `· 완료 ${esc(item.completedAt)}` : ''} ${item.overdueDays ? `(+${item.overdueDays}일)` : ''}</span>${management}</div>`;
  }).join('')}`;
}

const SPEC_SOURCE = {
  notion: { label: 'Notion', className: 'notion' },
  slack: { label: 'Slack', className: 'slack' },
  meeting: { label: '회의록', className: 'meeting' },
  git: { label: 'Git', className: 'git' },
};

function specSourceStatus(source) {
  const aiKey = { notion: 'notion', slack: 'slack', meeting: 'meetingNotes', git: 'github' }[source];
  const agentStatus = D.ai?.sourceStatus?.[aiKey];
  if (['failed', 'not_available'].includes(agentStatus)) return 'unavailable';
  const healthId = { notion: 'notion', slack: 'slack', meeting: 'meetings' }[source];
  const collected = D.sourceHealth?.sources?.find(item => item.id === healthId);
  if (collected?.status === 'unavailable') return 'unavailable';
  if (agentStatus === 'partial' || collected?.status === 'partial') return 'partial';
  return 'available';
}

function specCoverageHtml(evidence) {
  return Object.entries(SPEC_SOURCE).map(([source, meta]) => {
    const count = evidence.filter(item => item.source === source).length;
    if (count) return `<span class="spec-source ${meta.className} has-evidence">${meta.label} ${count}</span>`;
    const status = specSourceStatus(source);
    const suffix = status === 'unavailable' ? '미수집' : status === 'partial' ? '직접 근거 없음 · 수집 일부' : '직접 근거 없음';
    return `<span class="spec-source ${meta.className} ${status}">${meta.label} ${suffix}</span>`;
  }).join('');
}

function specEvidenceHtml(evidence) {
  if (!evidence.length) return '<p class="evidence-empty">연결된 출처 근거가 없습니다. 통합 분석 범위를 확인하세요.</p>';
  return evidence.map(item => {
    const meta = SPEC_SOURCE[item.source] || { label: item.source || '근거', className: 'other' };
    const title = item.title ? `<strong>${esc(item.title)}</strong>` : `<strong>${esc(meta.label)} 근거</strong>`;
    const content = `<span class="evidence-source ${meta.className}">${esc(meta.label)}</span><div>${title}<p>${esc(item.excerpt || '')}</p><time>${fmt(item.timestamp)}</time></div>`;
    const url = safeUrl(item.url);
    return url === '#' ? `<div class="evidence-item">${content}</div>` : `<a class="evidence-item" href="${esc(url)}" target="_blank">${content}</a>`;
  }).join('');
}

function specCard(spec, project) {
  const agentProject = aiProject(project.name);
  const analysis = analysisPresentation(D);
  const insight = resolveSpecInsight(project, spec, agentProject, {
    analysisStatus: analysis.status,
    sourceComparisonStatus: D.ai?.sourceComparison?.status,
    sourceStatus: D.ai?.sourceStatus,
  });
  const origin = insight.hasAgentAnalysis
    ? `통합 분석 · ${analysis.label} · ${fmt(D.ai?.generatedAt)}`
    : '규칙 기반 현황 · 통합 분석 대기';
  const blockers = insight.blockers.length
    ? `<div class="spec-callout blocker"><span>막힌 점</span><p>${insight.blockers.map(esc).join(' · ')}</p></div>`
    : insight.hasAgentAnalysis
      ? `<div class="spec-callout clear"><span>막힌 점</span><p>${insight.hasAnalysisLimit ? '확인 가능한 근거 범위에서는 실행 blocker 미확인' : '현재 확인된 실행 blocker 없음'}</p></div>`
      : '<div class="spec-callout clear"><span>막힌 점</span><p>통합 분석 대기 · 규칙상 기한 초과·확인 대기 없음</p></div>';
  const nextAction = insight.hasAgentAnalysis
    ? `<div class="spec-callout action"><span>다음 완료 지점</span><p>${esc(insight.nextAction || '근거에서 다음 완료 지점을 특정할 수 없음')}</p></div>`
    : insight.sourceAttention && insight.nextAction
    ? `<div class="spec-callout action"><span>다음 행동</span><p>${esc(insight.nextAction)}</p></div>`
    : insight.analysisPending
      ? '<div class="spec-callout action"><span>다음 행동</span><p>Notion·Slack·회의록·Git 통합 분석 완료 후 표시</p></div>'
      : '';
  const limits = insight.confidenceLimits.length
    ? `<p class="spec-confidence">확인 범위: ${insight.confidenceLimits.map(esc).join(' · ')}</p>`
    : '';
  return `<details class="spec spec-brief"><summary><div class="spec-heading"><div class="spec-title-line"><strong>${esc(spec.title)}</strong></div><small>${badge(spec.status || '상태 미정', workStatusTone(spec))} 담당 ${esc((spec.owners || []).join(', ') || '미지정')}</small></div><div class="spec-metrics"><b>${spec.progress}%</b><span>작업 ${spec.tasks.length} · 기한 초과 ${spec.overdue}</span><div class="progress"><span style="width:${spec.progress}%"></span></div></div></summary><div class="spec-briefing"><section class="spec-now"><div class="spec-kicker"><span>브리핑</span><small>${esc(origin)}</small></div><p class="spec-summary">${esc(insight.summary || '아직 요약할 진행 정보가 없습니다.')}</p><div class="spec-callouts">${blockers}${nextAction}</div>${limits}<div class="spec-coverage">${specCoverageHtml(insight.evidence)}</div></section><aside class="evidence-rail"><h5>최근 근거</h5>${specEvidenceHtml(insight.evidence)}</aside></div><details class="spec-work-items"><summary><span class="spec-work-items-label">Notion 작업항목 ${spec.tasks.length}개</span><span class="spec-work-items-toggle"><span class="toggle-open">열기</span><span class="toggle-close">접기</span> <span aria-hidden="true">→</span></span></summary><div class="spec-tasks">${taskRows(spec.tasks, 'status')}</div></details></details>`;
}

function sprintGroups(groups, expandedSprint, project) {
  return groups.map(group => `<details class="sprint-group" ${group.sprint === expandedSprint ? 'open' : ''}><summary><div><strong>${esc(group.sprint)}</strong><small>상위 작업 ${group.specs.length}개 · 작업항목 ${group.totalTasks}개</small></div><div><b>완료율 ${group.completionRate}%</b><small>${group.doneTasks}/${group.totalTasks} 완료 · 기한 초과 ${group.overdueCount}건</small></div></summary><div class="spec-list">${group.specs.map(spec => specCard(spec, project)).join('')}</div></details>`).join('');
}

function renderProjects() {
  const projects = sortProjects(D.projects);
  $('#tab-projects').innerHTML = `<div class="section-head"><div><h2>프로젝트</h2><p>프로젝트 → 스프린트 → 상위 작업 → 작업항목 구조입니다. 상위 작업을 열면 브리핑, 막힌 점, 다음 행동과 Notion·Slack·회의록·Git 근거를 먼저 봅니다.</p></div></div><div class="project-list">${projects.map(project => {
    const projectItems = D.workItems.filter(item => item.project === project.name);
    const specs = projectSpecs(project, projectItems);
    const allSprints = specs.map(spec => spec.sprint || '스프린트 미지정');
    const controls = resolveProjectControls(state.projectControls[project.name], allSprints);
    const groups = groupSpecsBySprint(specs, controls);
    const analysis = projectAnalysis(project);
    const open = projectShouldBeOpen(project, state.openProject) ? 'open' : '';
    const managementLabel = { error: '관리 오류', warning: '관리 주의', check: '관리 확인', normal: '관리 정상' }[project.managementStatus] || '관리 확인';
    return `<details class="card" data-project-card="${esc(project.name)}" ${open}><summary><div class="project-title"><strong>${esc(project.name)} ${badge(managementLabel,project.managementStatus)}</strong><span class="stat">진행 <b>${project.stats.inProgress}</b></span><span class="stat">기한 초과 <b class="${project.stats.overdue?'overdue':''}">${project.stats.overdue}</b></span><span class="stat">확인 <b>${project.stats.issueCount}</b></span></div></summary><div class="details-body"><div class="project-meta"><span>목표 ${esc(project.goal || '미입력')}</span><span>목표일 ${esc(project.milestones?.targetAt || '-')}</span><span>최근 Git ${fmt(project.recentGitAt)}</span></div>${analysis ? `<p class="summary"><strong>${esc(analysis.label)}</strong>: ${esc(analysis.text)}</p>`:''}<div class="toolbar details-toolbar"><label>스프린트<select data-project-control="sprint" data-project-name="${esc(project.name)}">${options(allSprints, controls.sprint, '전체 스프린트')}</select></label><label>순서<select data-project-control="order" data-project-name="${esc(project.name)}">${sortOptions([['desc','최신 스프린트순'],['asc','오래된 스프린트순']],controls.order || 'desc')}</select></label></div>${groups.length ? sprintGroups(groups, controls.sprint, project) : '<div class="summary">선택한 스프린트에 표시할 상위 작업이 없습니다.</div>'}</div></details>`;
  }).join('') || '<div class="card summary">표시할 프로젝트가 없습니다.</div>'}</div>`;
  document.querySelectorAll('[data-project-card]').forEach(card => card.ontoggle = event => {
    const name = event.currentTarget.dataset.projectCard;
    if (event.currentTarget.open) state.openProject = name;
    else if (state.openProject === name) state.openProject = null;
    persist();
  });
  document.querySelectorAll('[data-project-control]').forEach(control => control.onchange = event => {
    const name = event.target.dataset.projectName;
    state.projectControls[name] = { ...(state.projectControls[name] || {}), [event.target.dataset.projectControl]: event.target.value };
    state.openProject = name;
    persist(); renderProjects();
  });
  bindCopyActions($('#tab-projects'));
}

function sortOptions(rows, current) { return rows.map(([value,label]) => `<option value="${value}" ${current === value ? 'selected':''}>${label}</option>`).join(''); }

function renderPeople() {
  const activeTasks = D.workload.flatMap(person => person.tasks || []).filter(item => !isClosedWorkItem(item));
  const people = sortPeople(filterPeopleWorkload(D.workload, state.peopleFilters), state.personSort);
  const f = state.peopleFilters;
  $('#tab-people').innerHTML = `<div class="section-head"><div><h2>담당자</h2><p>완료 업무는 제외하고 현재 업무량·기한 위험·업무 집중을 확인합니다.</p></div></div><div class="toolbar"><label>팀<select data-people-filter="team">${options(activeTasks.map(item => item.team), f.team)}</select></label><label>프로젝트<select data-people-filter="project">${options(activeTasks.map(item => item.project), f.project)}</select></label><label>스프린트<select data-people-filter="sprint">${options(activeTasks.map(item => item.sprint), f.sprint)}</select></label><label>상태<select data-people-filter="status">${options(activeTasks.map(item => item.status), f.status)}</select></label><label>담당자 정렬<select id="personSort">${sortOptions([['default','기본 위험도'],['name','이름순'],['count','작업항목 많은 순'],['active','진행 중 많은 순'],['overdue','기한 초과 많은 순'],['due','가까운 마감일순']],state.personSort)}</select></label><button class="reset" data-action="reset-people-filters">필터 초기화</button></div><div class="people-list">${people.map(person => {
    const detail = state.personDetails[person.name] || {};
    const detailTasks = filterWorkItems(person.tasks, { ...detail, includeCompleted: false });
    const open = state.openPerson === person.name ? 'open' : '';
    return `<details class="card" ${open}><summary><div class="person-title"><strong>${esc(person.name)} ${badge((person.teams||[]).join(' · ') || '팀 미지정','gray')}</strong><span class="stat">프로젝트 <b>${person.projectCount}</b></span><span class="stat">작업항목 <b>${person.count}</b></span><span class="stat">진행 중 <b>${person.inProgressCount}</b></span><span class="stat">기한 초과 <b class="${person.overdueCount?'overdue':''}">${person.overdueCount}</b></span><span class="stat">가까운 마감 <b>${esc(person.nearestDue || '-')}</b></span></div></summary><div class="details-body"><div class="toolbar details-toolbar"><label>프로젝트<select data-person-detail-filter="project" data-person-name="${esc(person.name)}">${options(person.tasks.map(item => item.project),detail.project)}</select></label><label>스프린트<select data-person-detail-filter="sprint" data-person-name="${esc(person.name)}">${options(person.tasks.map(item => item.sprint),detail.sprint)}</select></label><label>상태<select data-person-detail-filter="status" data-person-name="${esc(person.name)}">${options(person.tasks.map(item => item.status),detail.status)}</select></label><label>작업항목 정렬<select data-person-detail-filter="sort" data-person-name="${esc(person.name)}">${sortOptions([['risk','위험도순'],['project','프로젝트순'],['sprint','스프린트순'],['status','상태순'],['due','기한순'],['name','이름순']],detail.sort || 'risk')}</select></label><button class="reset" data-person-detail-reset="${esc(person.name)}">내부 필터 초기화</button></div>${taskRows(detailTasks, detail.sort || 'risk')}</div></details>`;
  }).join('') || '<div class="card summary">현재 필터에 해당하는 진행 중 업무가 없습니다.</div>'}</div>`;
  $('#personSort').onchange = event => { state.personSort = event.target.value; persist(); renderPeople(); };
  document.querySelectorAll('[data-people-filter]').forEach(control => control.onchange = event => { state.peopleFilters[event.target.dataset.peopleFilter] = event.target.value; persist(); renderPeople(); });
  $('[data-action="reset-people-filters"]').onclick = () => { state.peopleFilters = {}; persist(); renderPeople(); };
  document.querySelectorAll('[data-person-detail-filter]').forEach(control => control.onchange = event => {
    const name = event.target.dataset.personName;
    state.personDetails[name] = { ...(state.personDetails[name] || {}), [event.target.dataset.personDetailFilter]: event.target.value };
    state.openPerson = name;
    persist(); renderPeople();
  });
  document.querySelectorAll('[data-person-detail-reset]').forEach(button => button.onclick = event => {
    const name = event.target.dataset.personDetailReset;
    state.personDetails[name] = {};
    state.openPerson = name;
    persist(); renderPeople();
  });
  bindCopyActions($('#tab-people'));
}

function renderChecks() {
  const visible = filterVisibleIssues(D.validationIssues, D.workItems, D.projects);
  const workItemForIssue = issue => D.workItems.find(item => item.id === issue.workItemId);
  const filtered = visible.filter(issue => !state.checkFilters.project || (issue.project || '프로젝트 미분류') === state.checkFilters.project).filter(issue => !state.checkFilters.category || issueMatchesCategory(issue, state.checkFilters.category)).filter(issue => !state.checkFilters.issueType || issue.type === state.checkFilters.issueType).filter(issue => !state.checkFilters.team || workItemForIssue(issue)?.team === state.checkFilters.team).filter(issue => !state.checkFilters.assignee || (workItemForIssue(issue)?.assignees || []).includes(state.checkFilters.assignee));
  const groups = groupIssuesByProjectItem(filtered);
  const itemCount = groups.reduce((sum, group) => sum + group.items.length, 0);
  const workItemIds = new Set(filtered.map(issue => issue.workItemId).filter(Boolean));
  const shareItems = D.workItems.filter(item => workItemIds.has(item.id));
  const shareTitle = state.checkFilters.issueType === 'OVERDUE' ? '기한 초과 작업항목'
    : state.checkFilters.category === 'guide' ? '가이드 위반 작업항목'
      : state.checkFilters.category ? `${ISSUE_CATEGORIES[state.checkFilters.category]} 작업항목`
        : '확인 필요 작업항목';
  const issueTypes = [...new Set(visible.map(issue => issue.type))].sort().map(type => `<option value="${esc(type)}" ${state.checkFilters.issueType === type ? 'selected' : ''}>${esc(issuePresentation({ type }).label)}</option>`).join('');
  const categories = Object.entries(ISSUE_CATEGORIES).map(([value, label]) => `<option value="${value}" ${state.checkFilters.category === value ? 'selected' : ''}>${label}</option>`).join('');
  const issueWorkItems = visible.map(workItemForIssue).filter(Boolean);
  $('#tab-checks').innerHTML = `<div class="section-head"><div><h2>확인필요</h2><p>관리 문제를 진행 준비 · 가이드 위반 · 일정 위험 · 데이터 불일치 · 연동 문제로 분류했습니다. 기한 초과는 일정 위험이며, 같은 작업의 날짜 누락 등은 가이드 위반에 함께 표시될 수 있습니다. 확인 대상 ${itemCount}개 · 세부 규칙 ${filtered.length}건</p></div><div class="share-actions"><button type="button" class="share-primary" data-copy-slack data-share-checks>복사</button></div></div><div class="toolbar"><label>프로젝트<select data-check-filter="project">${options(visible.map(issue => issue.project || '프로젝트 미분류'),state.checkFilters.project)}</select></label><label>팀<select data-check-filter="team">${options(issueWorkItems.map(item => item.team),state.checkFilters.team)}</select></label><label>담당자<select data-check-filter="assignee">${options(issueWorkItems.flatMap(item => item.assignees || []),state.checkFilters.assignee)}</select></label><label>분류<select data-check-filter="category"><option value="">전체</option>${categories}</select></label><label>문제 유형<select data-check-filter="issueType"><option value="">전체</option>${issueTypes}</select></label><button class="reset" data-action="reset-checks">필터 초기화</button></div><div class="check-groups">${groups.map(group => `<details class="check-project" open><summary>${group.project === '프로젝트 미분류' ? '<span class="dot check"></span>' : ''}${esc(group.project)} · 확인 대상 ${group.items.length}개</summary><div class="check-type"><div class="issue-list">${group.items.map(item => issueGroupRowHtml(item, D)).join('')}</div></div></details>`).join('') || '<div class="card summary">현재 확인할 항목이 없습니다.</div>'}</div>`;
  document.querySelectorAll('[data-check-filter]').forEach(control => control.onchange = event => { state.checkFilters[event.target.dataset.checkFilter] = event.target.value || ''; persist(); renderChecks(); });
  $('[data-action="reset-checks"]').onclick = () => { state.checkFilters = {}; persist(); renderChecks(); };
  bindCopyActions($('#tab-checks'), {
    items: shareItems,
    title: shareTitle,
    category: state.checkFilters.category || null,
    issueType: state.checkFilters.issueType || null,
  });
}

function render() {
  $('#loading').classList.add('hidden');
  $('#meta').textContent = `마지막 데이터 동기화 ${fmt(D.generatedAt)} · 한국 시간`;
  $('#sampleBadge').classList.toggle('hidden', !D.sample);
  $('#errors').classList.toggle('hidden', !D.errors?.length);
  if (D.errors?.length) {
    $('#errorSummary').textContent = `수집 중 확인할 사항 ${D.errors.length}건 · 상세 보기`;
    $('#errorDetails').textContent = D.errors.join('\n');
  }
  $('#checkCount').textContent = groupIssuesByProjectItem(filterVisibleIssues(D.validationIssues, D.workItems, D.projects)).reduce((sum, group) => sum + group.items.length, 0);
  renderTrust(); renderBriefing(); renderProjects(); renderPeople(); renderChecks(); activateTab(state.tab);
}

function activateTab(tab) {
  state.tab = ['briefing','projects','people','checks'].includes(tab) ? tab : 'briefing'; persist();
  document.querySelectorAll('#tabs button').forEach(button => {
    button.classList.toggle('active', button.dataset.tab === state.tab);
    if (button.dataset.tab === state.tab) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  document.querySelectorAll('.tab').forEach(section => section.classList.toggle('hidden', section.id !== `tab-${state.tab}`));
}

document.querySelectorAll('#tabs button').forEach(button => button.onclick = () => activateTab(button.dataset.tab));
async function readJsonResponse(response) {
  const text = await response.text();
  if (!text.trim()) return {};
  try { return JSON.parse(text); }
  catch {
    const detail = text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 180);
    throw new Error(`서버 수집 실패 (${response.status})${detail ? `: ${detail}` : ''}`);
  }
}
function syncThemeToggle() { $('#themeToggle').textContent = document.documentElement.dataset.theme === 'light' ? '다크 모드' : '라이트 모드'; }
$('#themeToggle').onclick = () => {
  const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  document.documentElement.dataset.theme = next;
  localStorage.setItem('dashboard-theme', next);
  syncThemeToggle();
};
syncThemeToggle();
$('#refreshBtn').onclick = async () => {
  if (demoMode) { await load(); return; }
  const button = $('#refreshBtn');
  const stateLabel = $('#collectState');
  button.disabled = true;
  stateLabel.textContent = '수집 중…';
  try {
    const response = await fetch('/api/refresh', { method: 'POST' });
    const result = await readJsonResponse(response);
    if (!response.ok) throw new Error(result.message || '수집에 실패했습니다.');
    if (result.completed && result.dashboard) {
      D = normalize(result.dashboard);
      $('#empty').classList.add('hidden');
      render();
      stateLabel.textContent = '최신화 완료';
      return;
    }
    pollStatus();
  } catch (error) {
    stateLabel.textContent = `수집 실패: ${error.message}`;
  } finally {
    button.disabled = false;
  }
};
let pollTimer;
async function pollStatus() {
  clearInterval(pollTimer);
  if (demoMode) {
    $('#refreshBtn').disabled = false;
    $('#collectState').textContent = '샘플 데이터 표시 중';
    $('#refreshBtn').textContent = '샘플 다시 보기';
    return;
  }
  const update = async () => {
    try {
      const response = await fetch('/api/status', { cache: 'no-store' });
      if (!response.ok) throw new Error(`status_${response.status}`);
      const status = await response.json();
      $('#refreshBtn').disabled = status.collecting; $('#collectState').textContent = status.collecting ? '수집 중…' : status.last?.state === 'error' ? `수집 실패: ${status.last.error || ''}` : '';
      if (!status.collecting) { clearInterval(pollTimer); return false; }
      return true;
    } catch {
      $('#refreshBtn').disabled = false;
      if (D?.sample) $('#collectState').textContent = '샘플 데이터 표시 중';
      clearInterval(pollTimer);
      return false;
    }
  };
  if (await update()) pollTimer = setInterval(async () => { if (!await update()) await load(); }, 2000);
}
const sampleDashboardPaths = ['../data/dashboard.sample.json', '/data/dashboard.sample.json', 'data/dashboard.sample.json'];
async function loadSampleDashboard() {
  for (const path of sampleDashboardPaths) {
    try {
      const response = await fetch(path, { cache: 'no-store' });
      if (!response.ok) continue;
      const sample = await readJsonResponse(response);
      return { ...sample, sample: true };
    } catch {}
  }
  return { ...JSON.parse(JSON.stringify(demoDashboard)), sample: true };
}
async function load() {
  let dashboard = demoMode ? { ...JSON.parse(JSON.stringify(demoDashboard)), sample: true } : null;
  if (!demoMode) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 1200);
      try {
        const response = await fetch('/api/dashboard', { signal: controller.signal, cache: 'no-store' });
        if (response.ok) dashboard = await readJsonResponse(response);
      } finally {
        clearTimeout(timeout);
      }
    } catch {}
  }
  dashboard ||= await loadSampleDashboard();
  if (!dashboard) { $('#loading').classList.add('hidden'); $('#empty').classList.remove('hidden'); return; }
  D = normalize(dashboard); $('#empty').classList.add('hidden'); render();
}
load(); pollStatus();
