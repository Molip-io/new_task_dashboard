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
  sortPeople,
  sortProjects,
  sortWorkItems,
  visibleWorkItemIssues,
  workStatusTone,
} from './dashboard-view-model.js';
import {
  gitTrustSummary,
  ISSUE_CATEGORIES,
  issueMatchesCategory,
  issuePresentation,
  primaryActionSummary,
} from './dashboard-management.js';
import { briefingHtml, issueGroupRowHtml, managementActionHtml } from './dashboard-presenters.js';

let D = null;
const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
const safeUrl = value => /^(https?:\/\/|#)/.test(String(value || '')) ? value : '#';
const fmt = value => value ? String(value).replace('T', ' ').slice(0, 16) : '-';
const DONE = new Set(['완료', '중단']);
const SEVERITY = { error: ['🔴', '오류'], warning: ['🟠', '주의'], check: ['🟡', '확인'], info: ['🔵', '정보'], normal: ['🟢', '정상'], gray: ['⚪', '대기'] };

const saved = JSON.parse(localStorage.getItem('dashboard-preferences') || '{}');
const query = new URLSearchParams(location.search);
const state = {
  tab: query.get('tab') || saved.tab || 'briefing',
  personSort: saved.personSort || 'default',
  peopleFilters: saved.peopleFilters || {},
  personDetails: saved.personDetails || {},
  projectControls: saved.projectControls || {},
  checkFilters: saved.checkFilters || {},
  briefingDetail: saved.briefingDetail || null,
  openProject: saved.openProject || null,
  openPerson: saved.openPerson || null,
};

function persist() {
  localStorage.setItem('dashboard-preferences', JSON.stringify(state));
  const params = new URLSearchParams(); params.set('tab', state.tab);
  history.replaceState(null, '', `${location.pathname}?${params}`);
}

function badge(value, severity = value) {
  const [emoji] = SEVERITY[severity] || SEVERITY.info;
  return `<span class="badge ${esc(severity)}">${emoji} ${esc(value)}</span>`;
}

function normalize(raw) {
  const workItems = raw.workItems?.length ? raw.workItems : (raw.workload || []).flatMap((person, personIndex) => (person.tasks || []).map((task, index) => {
    const id = task.id || `sample-${personIndex}-${index}`;
    const overdue = task.due && task.due < new Date().toISOString().slice(0, 10) && !DONE.has(task.status);
    const issues = overdue ? [{ id: `OVERDUE:${id}`, type: 'OVERDUE', severity: 'warning', message: '기한 초과', project: task.project, workItemId: id, detectedAt: raw.generatedAt, recommendedAction: '지연 사유와 변경 일정을 확인하세요.', metadata: {} }] : [];
    return {
    id, title: task.title, project: task.project, spec: task.spec || '스펙 미지정',
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
    guideViolationWorkItems: problemItems.length,
    needsCheckProjects: projects.filter(project => project.managementStatus !== 'normal').length,
    recentGitProjects: raw.metrics?.recentGitProjects || 0,
    gitNotionMismatchProjects: raw.metrics?.gitNotionMismatchProjects || 0,
    normalWorkItems: activeWorkItems.length - problemItems.length,
    totalWorkItems: activeWorkItems.length,
  };
  return { ...raw, projects, workItems, workload, validationIssues, metrics, git: raw.git || { repositories: [], commits: [], errors: [] }, notionSetup: raw.notionSetup || { ready: false, databases: [] }, deltas: raw.deltas || [] };
}

function renderTrust() {
  const health = D.sourceHealth;
  const sourceLabels = { notion: 'Notion', slack: 'Slack', meetings: '회의록' };
  const sources = health?.sources?.map(source => `<span class="source ${source.status}">${esc(sourceLabels[source.id] || source.id)} ${source.status === 'ok' ? '성공' : source.status === 'partial' ? '부분 성공' : '실패'}${source.expected > 1 ? ` ${source.successful}/${source.expected}` : ''}</span>`).join('') || '<span class="source partial">출처 상태 미측정</span>';
  const setup = D.notionSetup.ready ? '<span class="source ok">Notion 필수 속성 정상</span>' : `<span class="source partial">Notion 설정 확인 ${D.notionSetup.databases?.flatMap(db => db.missingProperties || []).length || 0}건</span>`;
  const git = gitTrustSummary(D.git, D.projects);
  $('#trustLine').innerHTML = `<strong>이 화면을 믿을 수 있는 범위</strong>${sources}${setup}<button type="button" class="source ${git.tone}" data-briefing-detail="git" aria-expanded="${state.briefingDetail === 'git'}">${esc(git.label)}</button><span>마지막 동기화 ${fmt(D.generatedAt)}</span>`;
  $('[data-briefing-detail="git"]').onclick = () => openBriefingDetail('git');
}

function openBriefingDetail(detail) {
  state.briefingDetail = state.briefingDetail === detail ? null : detail;
  state.tab = 'briefing';
  persist(); renderTrust(); renderBriefing(); activateTab('briefing');
}

function renderBriefing() {
  $('#tab-briefing').innerHTML = briefingHtml(D, state.briefingDetail, taskRows);
  document.querySelectorAll('#tab-briefing [data-briefing-detail]').forEach(button => button.onclick = () => openBriefingDetail(button.dataset.briefingDetail));
}

function aiProject(name) { return D.ai?.projects?.find(project => project.name === name) || null; }

function options(values, current, allLabel = '전체') {
  return `<option value="">${allLabel}</option>${[...new Set(values.filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), 'ko')).map(value => `<option value="${esc(value)}" ${value === current ? 'selected' : ''}>${esc(value)}</option>`).join('')}`;
}

function projectSpecs(project, items) {
  const source = project.specs.length ? project.specs : [...new Set(items.map(item => item.spec || '스펙 미지정'))].map((title, index) => ({ id: `${project.name}-${index}`, title, status: '', tasks: [] }));
  return filterSpecsWithWorkItems(source.map(spec => {
    const tasks = items.filter(item => item.spec === spec.title || item.specId === spec.id);
    const taskSprints = [...new Set(tasks.map(item => item.sprint).filter(Boolean))];
    return { ...spec, tasks, risk: tasks.reduce((sum, item) => sum + item.riskScore, 0), overdue: tasks.filter(item => item.overdueDays).length, progress: tasks.length ? Math.round(tasks.filter(item => DONE.has(item.status)).length / tasks.length * 100) : 0, sprint: spec.sprint || (taskSprints.length === 1 ? taskSprints[0] : null) };
  }));
}

function taskRows(items, sort = 'risk') {
  const rows = sortWorkItems(items, sort);
  if (!rows.length) return '<div class="summary empty-inline">표시할 작업항목이 없습니다.</div>';
  return `<div class="task-row header"><span>작업항목</span><span>상태</span><span>담당자</span><span>기간</span><span title="날짜·담당자·기한 등 Notion 관리 데이터 점검">관리 확인</span></div>${rows.map(item => {
    const closed = isClosedWorkItem(item);
    const issues = visibleWorkItemIssues(item);
    const action = primaryActionSummary(issues);
    const management = closed ? badge('완료','normal') : issues.length ? `<details class="management-check" data-management-check><summary>${badge(action.label, action.tone)}</summary><div class="management-actions">${issues.map(issue => managementActionHtml(issue, item.url)).join('')}</div></details>` : badge('정상','normal');
    return `<div class="task-row"><span class="task-title"><a href="${esc(safeUrl(item.url))}" target="_blank">${esc(item.title)}</a><small>${esc(item.project)} · ${esc(item.spec || '스펙 미지정')} · ${esc(item.team || '-')} ${item.sprint ? `· ${esc(item.sprint)}` : ''}</small></span><span>${badge(item.status || '미정', workStatusTone(item))}</span><span>${esc((item.assignees || []).join(', ') || '미지정')}</span><span class="${item.overdueDays ? 'overdue':''}">${esc(item.start || '-')} → ${esc(item.due || '-')} ${item.completedAt ? `· 완료 ${esc(item.completedAt)}` : ''} ${item.overdueDays ? `(+${item.overdueDays}일)` : ''}</span><span>${management}</span></div>`;
  }).join('')}`;
}

function specCard(spec) {
  return `<details class="spec"><summary><strong>${esc(spec.title)}</strong><span>완료 ${spec.progress}% · 작업항목 ${spec.tasks.length} · 기한 초과 ${spec.overdue}</span></summary><div class="spec-tasks">${taskRows(spec.tasks, 'status')}</div></details>`;
}

function sprintGroups(groups, expandedSprint) {
  return groups.map(group => `<details class="sprint-group" ${group.sprint === expandedSprint ? 'open' : ''}><summary><div><strong>${esc(group.sprint)}</strong><small>스펙 ${group.specs.length}개 · 작업항목 ${group.totalTasks}개</small></div><div><b>${group.completionRate}%</b><small>${group.doneTasks}/${group.totalTasks} 완료</small></div></summary><div class="spec-list">${group.specs.map(specCard).join('')}</div></details>`).join('');
}

function renderProjects() {
  const projects = sortProjects(D.projects);
  $('#tab-projects').innerHTML = `<div class="section-head"><div><h2>프로젝트</h2><p>프로젝트 → 스프린트 → 스펙 → 작업항목 구조로 진행도를 봅니다. 관리 확인은 Notion 작성 규칙 점검이며 작업 상태와는 별개입니다.</p></div></div><div class="project-list">${projects.map(project => {
    const projectItems = D.workItems.filter(item => item.project === project.name);
    const specs = projectSpecs(project, projectItems);
    const allSprints = specs.map(spec => spec.sprint || '스프린트 미지정');
    const controls = resolveProjectControls(state.projectControls[project.name], allSprints);
    const groups = groupSpecsBySprint(specs, controls);
    const summary = aiProject(project.name)?.summary || project.notionSummary?.summary;
    const open = projectShouldBeOpen(project, state.openProject) ? 'open' : '';
    const managementLabel = { error: '관리 오류', warning: '관리 주의', check: '관리 확인', normal: '관리 정상' }[project.managementStatus] || '관리 확인';
    return `<details class="card" data-project-card="${esc(project.name)}" ${open}><summary><div class="project-title"><strong>${esc(project.name)} ${badge(managementLabel,project.managementStatus)}</strong><span class="stat">완료율 <b>${project.stats.completionRate}%</b></span><span class="stat">진행 <b>${project.stats.inProgress}</b></span><span class="stat">기한 초과 <b class="${project.stats.overdue?'overdue':''}">${project.stats.overdue}</b></span><span class="stat">확인 <b>${project.stats.issueCount}</b></span></div></summary><div class="details-body"><div class="project-meta"><span>목표 ${esc(project.goal || '미입력')}</span><span>목표일 ${esc(project.milestones?.targetAt || '-')}</span><span>최근 Git ${fmt(project.recentGitAt)}</span></div><div class="progress"><span style="width:${project.stats.completionRate}%"></span></div>${summary ? `<p class="summary">AI 통합 요약: ${esc(summary)}</p>`:''}<div class="toolbar details-toolbar"><label>스프린트<select data-project-control="sprint" data-project-name="${esc(project.name)}">${options(allSprints, controls.sprint, '전체 스프린트')}</select></label><label>순서<select data-project-control="order" data-project-name="${esc(project.name)}">${sortOptions([['desc','최신 스프린트순'],['asc','오래된 스프린트순']],controls.order || 'desc')}</select></label></div>${groups.length ? sprintGroups(groups, controls.sprint) : '<div class="summary">선택한 스프린트에 스펙이 없습니다.</div>'}</div></details>`;
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
}

function renderChecks() {
  const visible = filterVisibleIssues(D.validationIssues, D.workItems, D.projects);
  const filtered = visible.filter(issue => !state.checkFilters.project || (issue.project || '프로젝트 미분류') === state.checkFilters.project).filter(issue => !state.checkFilters.category || issueMatchesCategory(issue, state.checkFilters.category)).filter(issue => !state.checkFilters.issueType || issue.type === state.checkFilters.issueType);
  const groups = groupIssuesByProjectItem(filtered);
  const itemCount = groups.reduce((sum, group) => sum + group.items.length, 0);
  const issueTypes = [...new Set(visible.map(issue => issue.type))].sort().map(type => `<option value="${esc(type)}" ${state.checkFilters.issueType === type ? 'selected' : ''}>${esc(issuePresentation({ type }).label)}</option>`).join('');
  const categories = Object.entries(ISSUE_CATEGORIES).map(([value, label]) => `<option value="${value}" ${state.checkFilters.category === value ? 'selected' : ''}>${label}</option>`).join('');
  $('#tab-checks').innerHTML = `<div class="section-head"><div><h2>확인필요</h2><p>관리 문제를 가이드 위반 · 일정 위험 · 데이터 불일치 · 연동 문제로 분류했습니다. 기한 초과는 일정 위험이며, 같은 작업의 날짜 누락 등은 가이드 위반에 함께 표시될 수 있습니다. 확인 대상 ${itemCount}개 · 세부 규칙 ${filtered.length}건</p></div></div><div class="toolbar"><label>프로젝트<select data-check-filter="project">${options(visible.map(issue => issue.project || '프로젝트 미분류'),state.checkFilters.project)}</select></label><label>분류<select data-check-filter="category"><option value="">전체</option>${categories}</select></label><label>문제 유형<select data-check-filter="issueType"><option value="">전체</option>${issueTypes}</select></label><button class="reset" data-action="reset-checks">필터 초기화</button></div><div class="check-groups">${groups.map(group => `<details class="check-project" open><summary>${group.project === '프로젝트 미분류' ? '🟡 ' : ''}${esc(group.project)} · 확인 대상 ${group.items.length}개</summary><div class="check-type"><div class="issue-list">${group.items.map(item => issueGroupRowHtml(item, D)).join('')}</div></div></details>`).join('') || '<div class="card summary">현재 확인할 항목이 없습니다.</div>'}</div>`;
  document.querySelectorAll('[data-check-filter]').forEach(control => control.onchange = event => { state.checkFilters[event.target.dataset.checkFilter] = event.target.value || ''; persist(); renderChecks(); });
  $('[data-action="reset-checks"]').onclick = () => { state.checkFilters = {}; persist(); renderChecks(); };
}

function render() {
  $('#meta').textContent = `마지막 데이터 동기화 ${fmt(D.generatedAt)} · Asia/Seoul 기준`;
  $('#sampleBadge').classList.toggle('hidden', !D.sample);
  $('#errors').classList.toggle('hidden', !D.errors?.length); if (D.errors?.length) $('#errors').textContent = D.errors.map(error => `⚠ ${error}`).join('\n');
  $('#checkCount').textContent = groupIssuesByProjectItem(filterVisibleIssues(D.validationIssues, D.workItems, D.projects)).reduce((sum, group) => sum + group.items.length, 0);
  renderTrust(); renderBriefing(); renderProjects(); renderPeople(); renderChecks(); activateTab(state.tab);
}

function activateTab(tab) {
  state.tab = ['briefing','projects','people','checks'].includes(tab) ? tab : 'briefing'; persist();
  document.querySelectorAll('#tabs button').forEach(button => button.classList.toggle('active', button.dataset.tab === state.tab));
  document.querySelectorAll('.tab').forEach(section => section.classList.toggle('hidden', section.id !== `tab-${state.tab}`));
}

document.querySelectorAll('#tabs button').forEach(button => button.onclick = () => activateTab(button.dataset.tab));
$('#refreshBtn').onclick = async () => { await fetch('/api/refresh', { method: 'POST' }); pollStatus(); };
let pollTimer;
async function pollStatus() {
  clearInterval(pollTimer);
  const update = async () => {
    const status = await (await fetch('/api/status')).json();
    $('#refreshBtn').disabled = status.collecting; $('#collectState').textContent = status.collecting ? '수집 중…' : status.last?.state === 'error' ? `수집 실패: ${status.last.error || ''}` : '';
    if (!status.collecting) { clearInterval(pollTimer); return false; }
    return true;
  };
  if (await update()) pollTimer = setInterval(async () => { if (!await update()) await load(); }, 2000);
}
async function load() {
  const response = await fetch('/api/dashboard');
  if (!response.ok) { $('#empty').classList.remove('hidden'); return; }
  D = normalize(await response.json()); $('#empty').classList.add('hidden'); render();
}
load(); pollStatus();
