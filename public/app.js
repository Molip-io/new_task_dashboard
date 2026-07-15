import { filterWorkItems, sortWorkItems, sortProjects, sortPeople, groupIssuesByProject } from './dashboard-view-model.js';

let D = null;
const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
const safeUrl = value => /^(https?:\/\/|#)/.test(String(value || '')) ? value : '#';
const fmt = value => value ? String(value).replace('T', ' ').slice(0, 16) : '-';
const DONE = new Set(['완료', '중단']);
const ISSUE_LABELS = {
  MISSING_START_DATE: '시작일 누락', MISSING_DUE_DATE: '마감일 누락', MISSING_COMPLETED_DATE: '완료일 누락',
  OVERDUE: '기한 초과', STALE_UPDATE: '최신화 필요', INVALID_HIERARCHY: '계층 구조 위반',
  MISSING_PROJECT: '프로젝트 연결 필요', MISSING_SPEC: '스펙 연결 필요', MISSING_ASSIGNEE: '담당자 재지정 필요',
  DATE_RANGE_MISMATCH: '기간 불일치', PARENT_CHILD_STATUS_MISMATCH: '상하위 상태 불일치',
  REOPENED_COMPLETED_ITEM: '완료 후 재작업 의심', GIT_NOTION_ACTIVITY_MISMATCH: 'Notion·Git 활동 불일치',
  UNMAPPED_GIT_ACTIVITY: 'Git 연결 실패', COMPLETION_DATE_RELATION: '완료일 관계',
  MISSING_DELAY_REASON: '지연 사유 누락', MISSING_DELAY_DATE_HISTORY: '변경 일정 기록 누락', MISSING_DELAY_OWNER_TAG: '지연 담당자 태그 누락',
};
const SEVERITY = { error: ['🔴', '오류'], warning: ['🟠', '주의'], check: ['🟡', '확인'], info: ['🔵', '정보'], normal: ['🟢', '정상'] };
const SEVERITY_RANK = { error: 0, warning: 1, check: 2, info: 3 };

const saved = JSON.parse(localStorage.getItem('dashboard-preferences') || '{}');
const query = new URLSearchParams(location.search);
const state = {
  tab: query.get('tab') || saved.tab || 'briefing', projectSort: saved.projectSort || 'risk',
  specSort: saved.specSort || 'risk', workSort: saved.workSort || 'risk', personSort: saved.personSort || 'default',
  filters: { ...(saved.filters || {}), includeCompleted: saved.filters?.includeCompleted ?? false },
};

function persist() {
  localStorage.setItem('dashboard-preferences', JSON.stringify(state));
  const params = new URLSearchParams(); params.set('tab', state.tab);
  for (const [key, value] of Object.entries(state.filters)) if (value && value !== false) params.set(key, String(value));
  history.replaceState(null, '', `${location.pathname}?${params}`);
}

function badge(value, severity = value) {
  const [emoji] = SEVERITY[severity] || SEVERITY.info;
  return `<span class="badge ${esc(severity)}">${emoji} ${esc(value)}</span>`;
}

function issueRow(issue) {
  const item = D.workItems.find(work => work.id === issue.workItemId);
  const commit = D.git?.commits?.find(row => row.hash === issue.metadata?.commitHash);
  return `<div class="issue-row ${esc(issue.severity)}">
    <strong>${SEVERITY[issue.severity]?.[0] || '•'} ${esc(issue.message)}</strong>
    <small>${esc(item ? `${item.spec || '스펙 미지정'} · ${item.title}` : issue.metadata?.commitHash ? `커밋 ${issue.metadata.commitHash.slice(0, 8)}` : '프로젝트 관리 항목')} · 감지 ${fmt(issue.detectedAt)}</small>
    ${issue.recommendedAction ? `<small>권장: ${esc(issue.recommendedAction)}</small>` : ''}
    ${(item?.url || commit?.url) ? `<small><a href="${esc(safeUrl(item?.url || commit?.url))}" target="_blank" rel="noreferrer">근거 열기</a></small>` : ''}
  </div>`;
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
  const validationIssues = raw.validationIssues || workItems.flatMap(item => item.issues || []);
  for (const item of workItems) {
    item.issues ||= validationIssues.filter(issue => issue.workItemId === item.id);
    item.riskScore ||= item.issues.reduce((sum, issue) => sum + ({ error: 100, warning: 30, check: 10, info: 2 }[issue.severity] || 0), 0);
  }
  const projects = (raw.projects || []).map(project => {
    const items = workItems.filter(item => item.project === project.name);
    const issues = validationIssues.filter(issue => issue.project === project.name);
    const stats = { total: items.length, done: items.filter(item => item.status === '완료').length, inProgress: items.filter(item => item.status === '진행 중').length, planned: items.filter(item => ['진행 예정', '시작 전'].includes(item.status)).length, review: items.filter(item => ['확인 요청', '검토중'].includes(item.status)).length, overdue: items.filter(item => item.overdueDays > 0).length, stale: items.filter(item => item.staleBusinessDays > 0).length, missingData: items.filter(item => item.issues.some(issue => issue.type.startsWith('MISSING_'))).length, missingCompleted: items.filter(item => item.issues.some(issue => issue.type === 'MISSING_COMPLETED_DATE')).length, issueCount: issues.length, ...project.stats };
    stats.completionRate = project.stats?.completionRate ?? (stats.total ? Math.round(stats.done / stats.total * 100) : 0);
    return { ...project, stats, issues, managementStatus: project.managementStatus || (issues.length ? 'warning' : 'normal'), recentNotionAt: project.recentNotionAt || null, recentGitAt: project.recentGitAt || null, specs: project.specs || [] };
  });
  const problemItems = workItems.filter(item => item.issues.some(issue => issue.severity !== 'info'));
  const workload = (raw.workload || []).map(person => ({
    ...person,
    tasks: (person.tasks || []).map(task => workItems.find(item => item.id === task.id) || workItems.find(item => item.title === task.title && item.project === task.project && item.assignees.includes(person.name)) || { ...task, assignees: [person.name], issues: [], overdueDays: 0, staleBusinessDays: 0, riskScore: 0 }),
  }));
  const metrics = raw.metrics || {
    activeProjects: projects.filter(project => project.stats.inProgress + project.stats.planned > 0).length,
    inProgressWorkItems: workItems.filter(item => item.status === '진행 중').length,
    overdueWorkItems: workItems.filter(item => item.overdueDays > 0).length,
    missingDateWorkItems: workItems.filter(item => item.issues.some(issue => ['MISSING_START_DATE', 'MISSING_DUE_DATE'].includes(issue.type))).length,
    missingCompletedDateWorkItems: workItems.filter(item => item.issues.some(issue => issue.type === 'MISSING_COMPLETED_DATE')).length,
    staleWorkItems: workItems.filter(item => item.staleBusinessDays > 0).length, guideViolationWorkItems: problemItems.length,
    needsCheckProjects: projects.filter(project => project.managementStatus !== 'normal').length, recentGitProjects: 0, gitNotionMismatchProjects: 0,
    normalWorkItems: workItems.length - problemItems.length, totalWorkItems: workItems.length,
  };
  return { ...raw, projects, workItems, workload, validationIssues, metrics, git: raw.git || { repositories: [], commits: [], errors: [] }, notionSetup: raw.notionSetup || { ready: false, databases: [] }, deltas: raw.deltas || [] };
}

function renderTrust() {
  const health = D.sourceHealth;
  const sourceLabels = { notion: 'Notion', slack: 'Slack', meetings: '회의록' };
  const sources = health?.sources?.map(source => `<span class="source ${source.status}">${esc(sourceLabels[source.id] || source.id)} ${source.status === 'ok' ? '성공' : source.status === 'partial' ? '부분 성공' : '실패'}${source.expected > 1 ? ` ${source.successful}/${source.expected}` : ''}</span>`).join('') || '<span class="source partial">출처 상태 미측정</span>';
  const setup = D.notionSetup.ready ? '<span class="source ok">Notion 필수 속성 정상</span>' : `<span class="source partial">Notion 설정 확인 ${D.notionSetup.databases?.flatMap(db => db.missingProperties || []).length || 0}건</span>`;
  const git = D.git.repositories.length ? `<span class="source ok">Git ${D.git.repositories.length}개 저장소</span>` : '<span class="source partial">Git 저장소 미설정</span>';
  $('#trustLine').innerHTML = `<strong>이 화면을 믿을 수 있는 범위</strong>${sources}${setup}${git}<span>마지막 동기화 ${fmt(D.generatedAt)}</span>`;
}

function kpi(value, label, tone = '') { return `<div class="kpi ${tone}"><div class="value">${value ?? 0}</div><div class="label">${esc(label)}</div></div>`; }

function renderBriefing() {
  const m = D.metrics;
  const decisions = [...(D.ai?.overall?.decisionsForCEO || []), ...D.projects.filter(project => project.notionSummary?.decision).map(project => ({ project: project.name, question: project.notionSummary.decision, context: 'Notion 업무현황 요약' }))];
  const priorityIssues = [...D.validationIssues].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]).slice(0, 5);
  const normalRate = m.totalWorkItems ? Math.round(m.normalWorkItems / m.totalWorkItems * 100) : 0;
  $('#tab-briefing').innerHTML = `
    <div class="section-head"><div><h2>오늘의 업무 브리핑</h2><p>판단할 것 → 관리상 막힌 것 → 어제와 달라진 것 순서입니다. 이 화면은 읽기 전용입니다.</p></div></div>
    <div class="kpis">${kpi(m.activeProjects, '진행 중 프로젝트', 'info')}${kpi(m.inProgressWorkItems, '진행 중 작업항목', 'normal')}${kpi(m.overdueWorkItems, '기한 초과 작업항목', m.overdueWorkItems ? 'error' : '')}${kpi(m.missingDateWorkItems, '날짜 미입력 작업항목', m.missingDateWorkItems ? 'error' : '')}${kpi(m.missingCompletedDateWorkItems, '완료일 미입력', m.missingCompletedDateWorkItems ? 'warning' : '')}${kpi(m.staleWorkItems, '최신화 필요 작업항목', m.staleWorkItems ? 'warning' : '')}${kpi(m.guideViolationWorkItems, '가이드 위반 작업항목', m.guideViolationWorkItems ? 'error' : '')}${kpi(m.needsCheckProjects, '확인이 필요한 프로젝트', m.needsCheckProjects ? 'warning' : '')}${kpi(m.recentGitProjects, '최근 Git 활동 프로젝트', 'info')}${kpi(m.gitNotionMismatchProjects, 'Notion·Git 불일치', m.gitNotionMismatchProjects ? 'warning' : '')}</div>
    <div class="grid-2">
      <div class="card"><h3>1. 대표가 확인할 판단</h3><div class="decision-list">${decisions.length ? decisions.slice(0, 5).map(item => `<div class="decision"><strong>[${esc(item.project)}] ${esc(item.question)}</strong><small>${esc(item.context || '')}</small></div>`).join('') : '<div class="summary">명시된 판단 안건이 없습니다.</div>'}</div></div>
      <div class="card"><h3>Notion 작업관리 상태</h3><div class="summary">필수 속성 ${D.notionSetup.ready ? '정상' : '확인 필요'} · 정상 관리 ${m.normalWorkItems}/${m.totalWorkItems} (${normalRate}%)<br>마지막 Notion 갱신 ${fmt(latest(D.workItems.map(item => item.notionUpdatedAt)))}<br>마지막 Git 활동 ${fmt(latest(D.git.commits.map(commit => commit.committedAt)))}</div></div>
    </div>
    <div class="grid-2">
      <div class="card"><h3>2. 현재 관리상 막힌 것</h3><div class="issue-list">${priorityIssues.length ? priorityIssues.map(issueRow).join('') : '<div class="summary">즉시 확인할 문제가 없습니다.</div>'}</div></div>
      <div class="card"><h3>3. 어제와 달라진 것</h3>${D.deltas.length ? D.deltas.slice(0, 8).map(delta => `<div class="issue-row info"><strong>🔵 [${esc(delta.project)}] ${esc(delta.taskTitle || '프로젝트')} · ${esc(delta.field)}</strong><small>${esc(JSON.stringify(delta.from))} → ${esc(JSON.stringify(delta.to))}</small></div>`).join('') : `<div class="summary">${esc(D.snapshotComparison?.reason || '변화가 감지되지 않았습니다.')}</div>`}</div>
    </div>
    <div class="card"><h3>프로젝트별 관리 상태</h3>${projectTable(sortProjects(D.projects))}</div>`;
}

function latest(values) { return values.filter(Boolean).sort().at(-1) || null; }
function aiProject(name) { return D.ai?.projects?.find(project => project.name === name) || null; }
function projectTable(projects) {
  return `<div style="overflow:auto"><table class="management-table"><thead><tr><th>프로젝트</th><th>관리 상태</th><th>작업항목</th><th>기한 초과</th><th>최신화 필요</th><th>필수 누락</th><th>최근 Git</th><th>최근 Notion</th><th>팀</th></tr></thead><tbody>${projects.map(project => `<tr><td><strong>${esc(project.name)}</strong></td><td>${badge(SEVERITY[project.managementStatus]?.[1] || '확인', project.managementStatus)}</td><td>${project.stats.inProgress}</td><td class="${project.stats.overdue ? 'overdue' : ''}">${project.stats.overdue}</td><td>${project.stats.stale}</td><td>${project.stats.missingData}</td><td>${fmt(project.recentGitAt)}</td><td>${fmt(project.recentNotionAt)}</td><td>${esc((project.teams || []).join(' · ') || '-')}</td></tr>`).join('')}</tbody></table></div>`;
}

function options(values, current, allLabel = '전체') {
  return `<option value="">${allLabel}</option>${[...new Set(values.filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), 'ko')).map(value => `<option value="${esc(value)}" ${value === current ? 'selected' : ''}>${esc(value)}</option>`).join('')}`;
}

function filterBar() {
  const f = state.filters, items = D.workItems;
  return `<div class="toolbar" id="workFilters">
    <label>상태<select data-filter="status">${options(items.map(item => item.status), f.status)}</select></label>
    <label>팀<select data-filter="team">${options(items.map(item => item.team), f.team)}</select></label>
    <label>프로젝트<select data-filter="project">${options(items.map(item => item.project), f.project)}</select></label>
    <label>스펙<select data-filter="spec">${options(items.map(item => item.spec), f.spec)}</select></label>
    <label>스프린트<select data-filter="sprint">${options(items.map(item => item.sprint), f.sprint)}</select></label>
    <label>담당자<select data-filter="assignee">${options(items.flatMap(item => item.assignees || []), f.assignee)}</select></label>
    <label>기간<select data-filter="period"><option value="">전체</option>${[['today','오늘 마감'],['thisWeek','이번 주 마감'],['nextWeek','다음 주 마감'],['overdue','기한 초과'],['missing','날짜 없음']].map(([value,label]) => `<option value="${value}" ${f.period === value ? 'selected':''}>${label}</option>`).join('')}</select></label>
    <label>기한 초과<select data-filter="overdue"><option value="">전체</option><option value="yes" ${f.overdue === 'yes' ? 'selected':''}>초과</option></select></label>
    <label>최신화<select data-filter="stale"><option value="">전체</option><option value="yes" ${f.stale === 'yes' ? 'selected':''}>필요</option></select></label>
    <label>가이드<select data-filter="guideViolation"><option value="">전체</option><option value="yes" ${f.guideViolation === 'yes' ? 'selected':''}>위반</option></select></label>
    <label>확인 유형<select data-filter="issueType">${options(items.flatMap(item => item.issues || []).map(issue => issue.type), f.issueType)}</select></label>
    <label>Git<select data-filter="git"><option value="">전체</option><option value="yes" ${f.git === 'yes' ? 'selected':''}>최근 활동</option></select></label>
    <label>Git 불일치<select data-filter="gitMismatch"><option value="">전체</option><option value="yes" ${f.gitMismatch === 'yes' ? 'selected':''}>불일치</option></select></label>
    <label>시작일<input type="date" data-filter="dateFrom" value="${esc(f.dateFrom || '')}"></label><label>종료일<input type="date" data-filter="dateTo" value="${esc(f.dateTo || '')}"></label>
    <label><input type="checkbox" data-filter="includeCompleted" ${f.includeCompleted ? 'checked':''}> 완료 포함</label>
    <button class="reset" data-action="reset-filters">필터 초기화</button>
  </div>`;
}

function sortedSpecs(project, items) {
  const source = project.specs.length ? project.specs : [...new Set(items.map(item => item.spec || '스펙 미지정'))].map((title, index) => ({ id: `${project.name}-${index}`, title, status: '', tasks: [] }));
  const specs = source.map(spec => {
    const tasks = items.filter(item => item.spec === spec.title || item.specId === spec.id);
    return { ...spec, tasks, risk: tasks.reduce((sum, item) => sum + item.riskScore, 0), due: tasks.map(item => item.due).filter(Boolean).sort()[0] || null, overdue: tasks.filter(item => item.overdueDays).length, progress: tasks.length ? Math.round(tasks.filter(item => DONE.has(item.status)).length / tasks.length * 100) : 0, updated: latest(tasks.map(item => item.notionUpdatedAt)), git: latest(tasks.map(item => item.latestGitAt)), sprint: tasks.map(item => item.sprint).find(Boolean) || '' };
  }).filter(spec => spec.tasks.length);
  const compare = {
    risk: (a,b) => b.risk-a.risk, due: (a,b) => (a.due||'9999').localeCompare(b.due||'9999'),
    overdue: (a,b) => b.overdue-a.overdue, progress: (a,b) => b.progress-a.progress,
    updated: (a,b) => (b.updated||'').localeCompare(a.updated||''), git: (a,b) => (b.git||'').localeCompare(a.git||''),
    name: (a,b) => a.title.localeCompare(b.title,'ko'), sprint: (a,b) => a.sprint.localeCompare(b.sprint,'ko'),
  }[state.specSort];
  return specs.sort(compare || ((a,b) => a.title.localeCompare(b.title,'ko')));
}

function taskRows(items) {
  return `<div class="task-row header"><span>작업항목</span><span>상태</span><span>담당자</span><span>기간</span><span>Notion 갱신</span><span>검증</span></div>${sortWorkItems(items, state.workSort).map(item => `<div class="task-row"><span class="task-title"><a href="${esc(safeUrl(item.url))}" target="_blank">${esc(item.title)}</a><small>${esc(item.project)} · ${esc(item.spec || '스펙 미지정')} · ${esc(item.team || '-')} ${item.sprint ? `· ${esc(item.sprint)}` : ''}</small></span><span>${badge(item.status || '미정', item.guideStatus === 'error' ? 'error' : 'gray')}</span><span>${esc((item.assignees || []).join(', ') || '미지정')}</span><span class="${item.overdueDays ? 'overdue':''}">${esc(item.start || '-')} → ${esc(item.due || '-')} ${item.completedAt ? `· 완료 ${esc(item.completedAt)}` : ''} ${item.overdueDays ? `(+${item.overdueDays}일)` : ''}</span><span>${fmt(item.notionUpdatedAt)}</span><span>${item.issues.length ? badge(`${item.issues.length}건`, item.guideStatus || 'check') : badge('정상','normal')}</span></div>`).join('')}`;
}

function renderProjects() {
  const items = filterWorkItems(D.workItems, state.filters);
  const projects = sortProjects(D.projects.filter(project => !state.filters.project || project.name === state.filters.project).filter(project => items.some(item => item.project === project.name) || state.filters.includeCompleted), state.projectSort);
  $('#tab-projects').innerHTML = `<div class="section-head"><div><h2>프로젝트</h2><p>프로젝트 → 스펙 → 작업항목 구조와 완료율·관리 위험을 함께 봅니다.</p></div><div class="toolbar"><label>프로젝트 정렬<select id="projectSort">${sortOptions([['risk','위험도순'],['due','마감 임박순'],['overdue','기한 초과순'],['progress','진행률순'],['updated','최근 업데이트순'],['git','최근 Git 활동순'],['name','이름순']],state.projectSort)}</select></label><label>스펙 정렬<select id="specSort">${sortOptions([['risk','위험도순'],['due','마감 임박순'],['overdue','기한 초과순'],['progress','진행률순'],['updated','최근 업데이트순'],['git','최근 Git 활동순'],['name','이름순'],['sprint','스프린트순']],state.specSort)}</select></label><label>작업항목 정렬<select id="workSort">${sortOptions([['risk','위험도순'],['status','상태별'],['due','기한별'],['overdue','기한 초과 일수'],['name','이름별'],['project','프로젝트별'],['spec','스펙별'],['assignee','담당자별'],['sprint','스프린트별'],['updated','최근 업데이트순'],['git','최근 Git 활동순']],state.workSort)}</select></label></div></div>${filterBar()}<div class="project-list">${projects.map(project => {
    const projectItems = items.filter(item => item.project === project.name), specs = sortedSpecs(project, projectItems);
    const summary = aiProject(project.name)?.summary || project.notionSummary?.summary;
    return `<details class="card" ${project.managementStatus !== 'normal' ? 'open':''}><summary><div class="project-title"><strong>${esc(project.name)} ${badge(SEVERITY[project.managementStatus]?.[1] || '확인',project.managementStatus)}</strong><span class="stat">완료율 <b>${project.stats.completionRate}%</b></span><span class="stat">진행 <b>${project.stats.inProgress}</b></span><span class="stat">기한 초과 <b class="${project.stats.overdue?'overdue':''}">${project.stats.overdue}</b></span><span class="stat">최신화 <b>${project.stats.stale}</b></span><span class="stat">확인 <b>${project.stats.issueCount}</b></span></div></summary><div class="details-body"><div class="project-meta"><span>목표 ${esc(project.goal || '미입력')}</span><span>목표일 ${esc(project.milestones?.targetAt || '-')}</span><span>최근 Git ${fmt(project.recentGitAt)}</span><span>최근 Notion ${fmt(project.recentNotionAt)}</span></div><div class="progress"><span style="width:${project.stats.completionRate}%"></span></div>${summary ? `<p class="summary">AI 통합 요약: ${esc(summary)}</p>`:''}<div class="spec-list">${specs.length ? specs.map(spec => `<details class="spec" open><summary><strong>${esc(spec.title)}</strong><span>완료 ${spec.progress}% · 작업항목 ${spec.tasks.length} · 기한 초과 ${spec.overdue}</span></summary><div class="spec-tasks">${taskRows(spec.tasks)}</div></details>`).join('') : '<div class="summary">현재 필터에 해당하는 스펙·작업항목이 없습니다.</div>'}</div></div></details>`;
  }).join('') || '<div class="card summary">현재 필터에 해당하는 프로젝트가 없습니다.</div>'}</div>`;
  bindCommon();
  $('#projectSort').onchange = event => { state.projectSort = event.target.value; persist(); renderProjects(); };
  $('#specSort').onchange = event => { state.specSort = event.target.value; persist(); renderProjects(); };
  $('#workSort').onchange = event => { state.workSort = event.target.value; persist(); renderProjects(); };
}

function sortOptions(rows, current) { return rows.map(([value,label]) => `<option value="${value}" ${current === value ? 'selected':''}>${label}</option>`).join(''); }

function renderPeople() {
  const people = sortPeople(D.workload.map(person => ({ ...person, overdueCount: person.overdueCount ?? person.tasks.filter(item => item.overdueDays).length, staleCount: person.staleCount ?? person.tasks.filter(item => item.staleBusinessDays).length, inProgressCount: person.inProgressCount ?? person.tasks.filter(item => item.status === '진행 중').length, projectCount: person.projectCount ?? new Set(person.tasks.map(item => item.project)).size, nearestDue: person.nearestDue || person.tasks.map(item => item.due).filter(Boolean).sort()[0] || null })), state.personSort);
  $('#tab-people').innerHTML = `<div class="section-head"><div><h2>담당자</h2><p>평가가 아니라 업무 누락·기한 위험·최신화 문제를 찾는 화면입니다.</p></div><label>정렬 <select id="personSort">${sortOptions([['default','기본 위험도'],['name','이름순'],['count','작업항목 많은 순'],['active','진행 중 많은 순'],['overdue','기한 초과 많은 순'],['stale','최신화 필요 많은 순'],['due','가까운 마감일순'],['updated','업데이트 오래된 순']],state.personSort)}</select></label></div><div class="people-list">${people.map(person => `<details class="card"><summary><div class="person-title"><strong>${esc(person.name)} ${badge((person.teams||[]).join(' · ') || '팀 미지정','gray')}</strong><span class="stat">프로젝트 <b>${person.projectCount}</b></span><span class="stat">작업항목 <b>${person.count}</b></span><span class="stat">진행 중 <b>${person.inProgressCount}</b></span><span class="stat">기한 초과 <b class="${person.overdueCount?'overdue':''}">${person.overdueCount}</b></span><span class="stat">최신화 필요 <b>${person.staleCount}</b></span></div></summary><div class="details-body">${taskRows(person.tasks)}</div></details>`).join('') || '<div class="card summary">담당자가 지정된 진행 중 작업항목이 없습니다.</div>'}</div>`;
  $('#personSort').onchange = event => { state.personSort = event.target.value; persist(); renderPeople(); };
}

function renderChecks() {
  const filtered = D.validationIssues.filter(issue => !state.filters.project || issue.project === state.filters.project).filter(issue => !state.filters.issueType || issue.type === state.filters.issueType);
  const groups = groupIssuesByProject(filtered);
  $('#tab-checks').innerHTML = `<div class="section-head"><div><h2>확인필요</h2><p>데이터 무결성·가이드 위반·Git 연결 문제를 프로젝트별로 묶었습니다.</p></div></div><div class="toolbar"><label>프로젝트<select data-check-filter="project">${options(D.validationIssues.map(issue => issue.project || '프로젝트 미분류'),state.filters.project)}</select></label><label>문제 유형<select data-check-filter="issueType">${options(D.validationIssues.map(issue => issue.type),state.filters.issueType).replaceAll('>'+state.filters.issueType+'<','>'+esc(ISSUE_LABELS[state.filters.issueType]||state.filters.issueType)+'<')}</select></label><button class="reset" data-action="reset-checks">필터 초기화</button></div><div class="check-groups">${groups.map(group => `<details class="check-project" open><summary>${group.project === '프로젝트 미분류' ? '🟡 ' : ''}${esc(group.project)} · ${group.types.reduce((sum,type)=>sum+type.issues.length,0)}건</summary>${group.types.map(type => `<div class="check-type"><h4>${esc(ISSUE_LABELS[type.type] || type.type)} (${type.issues.length})</h4><div class="issue-list">${type.issues.map(issueRow).join('')}</div></div>`).join('')}</details>`).join('') || '<div class="card summary">현재 확인할 항목이 없습니다.</div>'}</div>`;
  document.querySelectorAll('[data-check-filter]').forEach(control => control.onchange = event => { state.filters[event.target.dataset.checkFilter] = event.target.value || ''; persist(); renderChecks(); });
  $('[data-action="reset-checks"]').onclick = () => { state.filters.project = ''; state.filters.issueType = ''; persist(); renderChecks(); };
}

function bindCommon() {
  document.querySelectorAll('[data-filter]').forEach(control => control.onchange = event => { state.filters[event.target.dataset.filter] = event.target.type === 'checkbox' ? event.target.checked : event.target.value; persist(); renderProjects(); });
  document.querySelector('[data-action="reset-filters"]')?.addEventListener('click', () => { state.filters = { includeCompleted: false }; persist(); renderProjects(); });
}

function render() {
  $('#meta').textContent = `마지막 데이터 동기화 ${fmt(D.generatedAt)} · Asia/Seoul 기준`;
  $('#sampleBadge').classList.toggle('hidden', !D.sample);
  $('#errors').classList.toggle('hidden', !D.errors?.length); if (D.errors?.length) $('#errors').textContent = D.errors.map(error => `⚠ ${error}`).join('\n');
  $('#checkCount').textContent = D.validationIssues.length;
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
