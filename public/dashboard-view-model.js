const severityOrder = { error: 0, warning: 1, check: 2, info: 3 };
const issueTypeOrder = { MISSING_PROJECT: 0, INVALID_HIERARCHY: 1, MISSING_START_DATE: 2, MISSING_DUE_DATE: 2, OVERDUE: 3, GIT_NOTION_ACTIVITY_MISMATCH: 4, UNMAPPED_GIT_ACTIVITY: 5 };
const closedStatuses = new Set(['완료', '일시 정지', '정지', '중단']);

export function isClosedWorkItem(item) {
  return closedStatuses.has(item?.status);
}

// Notion 상태 색과 1:1로 맞춘다. 여기 없는 상태는 중립 회색.
const statusTones = {
  '시작 전': 'gray',
  '진행 예정': 'info',
  '일시 정지': 'error',
  '검토중': 'gray',
  '추가 진행': 'warning',
  '진행 중': 'check',
  '확인 요청': 'review',
  '완료': 'done',
  '중단': 'gray',
};

export function workStatusTone(item) {
  return statusTones[item?.status] || 'gray';
}

export function filterSpecsWithWorkItems(specs) {
  return specs.filter(spec => (spec.tasks || []).length > 0 && (spec.tasks || []).some(item => !isClosedWorkItem(item)));
}

export function projectShouldBeOpen(project, openProject) {
  return project.name === openProject;
}

export function resolveProjectControls(controls = {}, availableSprints = []) {
  return {
    sprint: controls.sprint && availableSprints.includes(controls.sprint) ? controls.sprint : '',
    order: controls.order || 'desc',
  };
}

function evidenceKey(item) {
  return [item?.source, item?.url, item?.timestamp, item?.excerpt].map(value => String(value || '')).join('|');
}

function isManagementMetadataText(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return false;
  if (/(필수 진행 정보|관리 정보|필수 속성).*(누락|미입력)/.test(text)) return true;
  const metadataFields = ['우선순위', '기간', '브랜치', '담당자', '날짜', '시작일', '마감일'];
  const mentionedFields = metadataFields.filter(field => text.includes(field)).length;
  return mentionedFields > 0 && /(누락|미입력|보완|입력)/.test(text);
}

function sourceStatusIsLimited(status) {
  return ['failed', 'not_available', 'unavailable', 'partial', 'not_run'].includes(String(status || '').toLowerCase());
}

function localSpecFallback(spec) {
  const active = (spec?.tasks || []).filter(item => !isClosedWorkItem(item));
  const statusCounts = new Map();
  for (const item of active) statusCounts.set(item.status || '상태 미정', (statusCounts.get(item.status || '상태 미정') || 0) + 1);
  const statusText = [...statusCounts.entries()].map(([status, count]) => `${status} ${count}건`).join(' · ');
  const overdue = active.filter(item => item.overdueDays > 0);
  const review = active.filter(item => ['확인 요청', '검토중'].includes(item.status));
  const blockers = [];
  if (overdue.length) blockers.push(`기한 초과 ${overdue.length}건: ${overdue.slice(0, 2).map(item => item.title).join(', ')}`);
  if (review.length) blockers.push(`확인 대기 ${review.length}건: ${review.slice(0, 2).map(item => item.title).join(', ')}`);
  const latest = [...(spec?.tasks || [])]
    .filter(item => item.notionUpdatedAt)
    .sort((left, right) => String(right.notionUpdatedAt).localeCompare(String(left.notionUpdatedAt)))[0];
  const nextAction = overdue.length
      ? '기한 초과 작업의 지연 사유와 변경 일정을 먼저 확인합니다.'
      : review.length
        ? '확인 요청과 검토중 작업의 승인·수정 여부를 정리합니다.'
        : active.some(item => item.status === '진행 중')
          ? '진행 중 작업의 다음 완료 지점과 필요한 지원을 확인합니다.'
          : active.some(item => ['시작 전', '진행 예정'].includes(item.status))
            ? '착수 전 작업의 시작 조건과 담당 일정을 확인합니다.'
            : null;
  return {
    summary: active.length ? `현재 활성 작업 ${active.length}건이 ${statusText || '상태 미정'}입니다.` : '현재 표시할 활성 작업항목이 없습니다.',
    blockers,
    nextAction,
    evidence: latest ? [{
      source: 'notion', timestamp: latest.notionUpdatedAt, title: latest.title,
      excerpt: `${latest.status || '상태 미정'} · 담당 ${(latest.assignees || []).join(', ') || '미지정'}`,
      url: latest.url || spec?.url || null,
    }] : [],
  };
}

export function resolveSpecInsight(project, spec, agentProject = null, analysisMeta = {}) {
  const fallback = (project?.specInsights || []).find(item => item.specId === spec.id)
    || localSpecFallback(spec);
  const analysisStatus = String(analysisMeta.analysisStatus || '').toLowerCase();
  const agentIsUsable = !['failed', 'legacy', 'not_run', 'stale'].includes(analysisStatus);
  const agent = agentIsUsable
    ? (agentProject?.specSummaries || []).find(item => item.specId && item.specId === spec.id) || null
    : null;
  const evidence = (agent ? agent.evidence || [] : fallback.evidence || [])
    .filter((item, index, rows) => rows.findIndex(candidate => evidenceKey(candidate) === evidenceKey(item)) === index)
    .sort((left, right) => String(right.timestamp || '').localeCompare(String(left.timestamp || '')))
    .slice(0, 6);
  const agentBlockers = (agent?.blockers || []).filter(item => !isManagementMetadataText(item));
  const agentNextAction = isManagementMetadataText(agent?.nextAction) ? null : agent?.nextAction;
  const confidenceLimits = agent ? agent.confidenceLimits || [] : [];
  const sourceStatuses = Object.values(analysisMeta.sourceStatus || {});
  const hasAnalysisLimit = Boolean(agent && (confidenceLimits.length
    || sourceStatusIsLimited(analysisMeta.analysisStatus)
    || sourceStatusIsLimited(analysisMeta.sourceComparisonStatus)
    || sourceStatuses.some(sourceStatusIsLimited)));
  const blockers = (agent ? agentBlockers : fallback.blockers || [])
    .filter((item, index, rows) => rows.indexOf(item) === index)
    .slice(0, 3);
  return {
    summary: agent ? agent.summary || '' : fallback.summary || '',
    blockers,
    nextAction: agent ? agentNextAction || null : fallback.nextAction || null,
    evidence,
    confidenceLimits,
    hasAnalysisLimit,
    hasAgentAnalysis: Boolean(agent),
    sourceAttention: !agent && (fallback.evidence || []).some(item => item.attention),
    analysisPending: !agent,
  };
}

export function visibleWorkItemIssues(item) {
  if (isClosedWorkItem(item)) return [];
  return (item.issues || []).filter(issue => issue.type !== 'STALE_UPDATE');
}

export function filterWorkItems(items, filters = {}) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const inDays = days => new Date(`${today}T00:00:00+09:00`).getTime() + days * 86400_000;
  return items.filter(item => {
    if (!filters.includeCompleted && isClosedWorkItem(item)) return false;
    if (filters.status && item.status !== filters.status) return false;
    if (filters.team && item.team !== filters.team) return false;
    if (filters.project && item.project !== filters.project) return false;
    if (filters.spec && item.spec !== filters.spec) return false;
    if (filters.sprint && item.sprint !== filters.sprint) return false;
    if (filters.assignee && !(item.assignees || []).includes(filters.assignee)) return false;
    if (filters.issueType && !(item.issues || []).some(issue => issue.type === filters.issueType)) return false;
    if (filters.overdue === 'yes' && !(item.overdueDays > 0)) return false;
    if (filters.git === 'yes' && !item.latestGitAt) return false;
    if (filters.gitMismatch === 'yes' && !(item.issues || []).some(issue => issue.type === 'GIT_NOTION_ACTIVITY_MISMATCH')) return false;
    if (filters.guideViolation === 'yes' && !(item.issues || []).some(issue => ['error', 'warning'].includes(issue.severity))) return false;
    if (filters.period === 'today' && item.due !== today) return false;
    if (filters.period === 'thisWeek' && (!item.due || new Date(`${item.due}T00:00:00+09:00`).getTime() < inDays(0) || new Date(`${item.due}T00:00:00+09:00`).getTime() > inDays(7))) return false;
    if (filters.period === 'nextWeek' && (!item.due || new Date(`${item.due}T00:00:00+09:00`).getTime() <= inDays(7) || new Date(`${item.due}T00:00:00+09:00`).getTime() > inDays(14))) return false;
    if (filters.period === 'overdue' && !(item.overdueDays > 0)) return false;
    if (filters.period === 'missing' && item.due) return false;
    if (filters.dateFrom && (!item.due || item.due < filters.dateFrom)) return false;
    if (filters.dateTo && (!item.due || item.due > filters.dateTo)) return false;
    return true;
  });
}

const statusOrder = { '진행 중': 0, '확인 요청': 1, '검토중': 1, '추가 진행': 1, '진행 예정': 2, '시작 전': 3, '일시 정지': 4, '정지': 4, '중단': 4, '완료': 4 };

export function sortWorkItems(items, sort = 'risk') {
  const copy = [...items];
  const compare = {
    risk: (a, b) => b.riskScore - a.riskScore || (statusOrder[a.status] ?? 9) - (statusOrder[b.status] ?? 9) || (a.due || '9999').localeCompare(b.due || '9999') || a.title.localeCompare(b.title, 'ko'),
    status: (a, b) => (statusOrder[a.status] ?? 9) - (statusOrder[b.status] ?? 9) || a.title.localeCompare(b.title, 'ko'),
    due: (a, b) => (a.due || '9999').localeCompare(b.due || '9999') || a.title.localeCompare(b.title, 'ko'),
    overdue: (a, b) => b.overdueDays - a.overdueDays || a.title.localeCompare(b.title, 'ko'),
    name: (a, b) => a.title.localeCompare(b.title, 'ko'),
    project: (a, b) => a.project.localeCompare(b.project, 'ko') || a.title.localeCompare(b.title, 'ko'),
    spec: (a, b) => (a.spec || '').localeCompare(b.spec || '', 'ko') || a.title.localeCompare(b.title, 'ko'),
    git: (a, b) => (b.latestGitAt || '').localeCompare(a.latestGitAt || ''),
    sprint: (a, b) => (a.sprint || 'ZZZ').localeCompare(b.sprint || 'ZZZ', 'ko'),
    assignee: (a, b) => ((a.assignees || []).join(',') || 'ZZZ').localeCompare((b.assignees || []).join(',') || 'ZZZ', 'ko'),
  }[sort];
  return copy.sort(compare || ((a, b) => a.title.localeCompare(b.title, 'ko')));
}

export function sortProjects(projects, sort = 'risk') {
  const compare = {
    risk: (a, b) =>
    b.stats.issueCount - a.stats.issueCount
    || b.stats.overdue - a.stats.overdue
    || (a.nearestDue || '9999').localeCompare(b.nearestDue || '9999')
    || a.name.localeCompare(b.name, 'ko'),
    due: (a, b) => (a.nearestDue || '9999').localeCompare(b.nearestDue || '9999'),
    overdue: (a, b) => b.stats.overdue - a.stats.overdue || a.name.localeCompare(b.name, 'ko'),
    progress: (a, b) => b.stats.completionRate - a.stats.completionRate || a.name.localeCompare(b.name, 'ko'),
    git: (a, b) => (b.recentGitAt || '').localeCompare(a.recentGitAt || ''),
    name: (a, b) => a.name.localeCompare(b.name, 'ko'),
  }[sort];
  return [...projects].sort(compare || ((a, b) => a.name.localeCompare(b.name, 'ko')));
}

export function sortPeople(people, sort = 'default') {
  const compare = {
    default: (a, b) => b.overdueCount - a.overdueCount || b.inProgressCount - a.inProgressCount || b.count - a.count || a.name.localeCompare(b.name, 'ko'),
    name: (a, b) => a.name.localeCompare(b.name, 'ko'),
    count: (a, b) => b.count - a.count || a.name.localeCompare(b.name, 'ko'),
    active: (a, b) => b.inProgressCount - a.inProgressCount || a.name.localeCompare(b.name, 'ko'),
    overdue: (a, b) => b.overdueCount - a.overdueCount || a.name.localeCompare(b.name, 'ko'),
    due: (a, b) => (a.nearestDue || '9999').localeCompare(b.nearestDue || '9999'),
  }[sort];
  return [...people].sort(compare || ((a, b) => a.name.localeCompare(b.name, 'ko')));
}

export function filterPeopleWorkload(workload, filters = {}) {
  const taskFilterActive = Object.entries(filters).some(([key, value]) => key !== 'team' && key !== 'includeCompleted' && Boolean(value));
  return workload.map(person => {
    if (filters.team && !(person.teams || []).includes(filters.team)) return null;
    const tasks = filterWorkItems(person.tasks || [], { ...filters, includeCompleted: false });
    return {
      ...person,
      tasks,
      count: tasks.length,
      projectCount: new Set(tasks.map(item => item.project)).size,
      inProgressCount: tasks.filter(item => item.status === '진행 중').length,
      overdueCount: tasks.filter(item => item.overdueDays > 0).length,
      nearestDue: tasks.map(item => item.due).filter(Boolean).sort()[0] || null,
    };
  }).filter(person => person && (person.tasks.length > 0 || !taskFilterActive));
}

function sprintNumber(value) {
  const numbers = String(value || '').match(/\d+/g);
  return numbers?.length ? Number(numbers.at(-1)) : null;
}

function compareSprints(left, right, order) {
  const missing = '스프린트 미지정';
  if (left === missing) return 1;
  if (right === missing) return -1;
  const leftNumber = sprintNumber(left);
  const rightNumber = sprintNumber(right);
  const direction = order === 'asc' ? 1 : -1;
  if (leftNumber !== null && rightNumber !== null && leftNumber !== rightNumber) return (leftNumber - rightNumber) * direction;
  return left.localeCompare(right, 'ko', { numeric: true }) * direction;
}

export function groupSpecsBySprint(specs, controls = {}) {
  const groups = new Map();
  for (const spec of specs) {
    const sprint = spec.sprint || '스프린트 미지정';
    if (controls.sprint && sprint !== controls.sprint) continue;
    if (!groups.has(sprint)) groups.set(sprint, []);
    groups.get(sprint).push(spec);
  }
  return [...groups.entries()].map(([sprint, groupedSpecs]) => {
    const tasks = groupedSpecs.flatMap(spec => spec.tasks || []);
    const doneTasks = tasks.filter(isClosedWorkItem).length;
    return {
      sprint,
      specs: groupedSpecs,
      totalTasks: tasks.length,
      doneTasks,
      completionRate: tasks.length ? Math.round(doneTasks / tasks.length * 100) : 0,
      overdueCount: tasks.filter(task => task.overdueDays > 0).length,
    };
  }).sort((left, right) => compareSprints(left.sprint, right.sprint, controls.order || 'desc'));
}

export function filterVisibleIssues(issues, workItems, projects = []) {
  const workById = new Map(workItems.map(item => [item.id, item]));
  const specById = new Map(projects.flatMap(project => (project.specs || []).map(spec => [spec.id, spec])));
  return issues.filter(issue => {
    if (issue.type === 'STALE_UPDATE') return false;
    if (issue.workItemId && isClosedWorkItem(workById.get(issue.workItemId))) return false;
    if (!issue.workItemId && issue.specId && isClosedWorkItem(specById.get(issue.specId))) return false;
    return true;
  });
}

export function groupIssuesByProject(issues) {
  const projects = new Map();
  for (const issue of issues) {
    const project = issue.project || '프로젝트 미분류';
    if (!projects.has(project)) projects.set(project, new Map());
    const types = projects.get(project);
    if (!types.has(issue.type)) types.set(issue.type, []);
    types.get(issue.type).push(issue);
  }
  return [...projects.entries()].map(([project, types]) => ({
    project,
    types: [...types.entries()].map(([type, groupedIssues]) => ({
      type,
      issues: groupedIssues.sort((a, b) => (severityOrder[a.severity] ?? 9) - (severityOrder[b.severity] ?? 9)),
    })).sort((a, b) => (issueTypeOrder[a.type] ?? 99) - (issueTypeOrder[b.type] ?? 99)),
  })).sort((a, b) => {
    if (a.project === '프로젝트 미분류') return -1;
    if (b.project === '프로젝트 미분류') return 1;
    return a.project.localeCompare(b.project, 'ko');
  });
}

function issueSubjectKey(issue) {
  if (issue.workItemId) return `work:${issue.workItemId}`;
  if (issue.specId) return `spec:${issue.specId}`;
  if (issue.metadata?.commitHash) return `commit:${issue.metadata.commitHash}`;
  return `issue:${issue.project || ''}:${issue.type}:${issue.message || ''}`;
}

export function groupIssuesByProjectItem(issues) {
  const projects = new Map();
  for (const issue of issues) {
    const project = issue.project || '프로젝트 미분류';
    if (!projects.has(project)) projects.set(project, new Map());
    const subjects = projects.get(project);
    const key = issueSubjectKey(issue);
    if (!subjects.has(key)) subjects.set(key, []);
    const subjectIssues = subjects.get(key);
    const duplicate = subjectIssues.some(existing => existing.type === issue.type && existing.message === issue.message);
    if (!duplicate) subjectIssues.push(issue);
  }
  return [...projects.entries()].map(([project, subjects]) => ({
    project,
    items: [...subjects.entries()].map(([key, subjectIssues]) => ({
      key,
      project,
      issues: subjectIssues,
      severity: [...subjectIssues].sort((left, right) => (severityOrder[left.severity] ?? 9) - (severityOrder[right.severity] ?? 9))[0]?.severity || 'info',
    })).sort((left, right) => (severityOrder[left.severity] ?? 9) - (severityOrder[right.severity] ?? 9)),
  })).sort((left, right) => {
    if (left.project === '프로젝트 미분류') return -1;
    if (right.project === '프로젝트 미분류') return 1;
    return left.project.localeCompare(right.project, 'ko');
  });
}
