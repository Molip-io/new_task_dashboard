const severityOrder = { error: 0, warning: 1, check: 2, info: 3 };
const issueTypeOrder = { MISSING_PROJECT: 0, INVALID_HIERARCHY: 1, MISSING_START_DATE: 2, MISSING_DUE_DATE: 2, MISSING_COMPLETED_DATE: 3, OVERDUE: 4, STALE_UPDATE: 5, GIT_NOTION_ACTIVITY_MISMATCH: 6, UNMAPPED_GIT_ACTIVITY: 7 };

export function filterWorkItems(items, filters = {}) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const inDays = days => new Date(`${today}T00:00:00+09:00`).getTime() + days * 86400_000;
  return items.filter(item => {
    if (!filters.includeCompleted && item.status === '완료') return false;
    if (filters.status && item.status !== filters.status) return false;
    if (filters.team && item.team !== filters.team) return false;
    if (filters.project && item.project !== filters.project) return false;
    if (filters.spec && item.spec !== filters.spec) return false;
    if (filters.sprint && item.sprint !== filters.sprint) return false;
    if (filters.assignee && !(item.assignees || []).includes(filters.assignee)) return false;
    if (filters.issueType && !(item.issues || []).some(issue => issue.type === filters.issueType)) return false;
    if (filters.overdue === 'yes' && !(item.overdueDays > 0)) return false;
    if (filters.stale === 'yes' && !(item.staleBusinessDays > 0)) return false;
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

const statusOrder = { '진행 중': 0, '확인 요청': 1, '검토중': 1, '진행 예정': 2, '시작 전': 3, '완료': 4 };

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
    updated: (a, b) => (b.notionUpdatedAt || '').localeCompare(a.notionUpdatedAt || ''),
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
    || b.stats.stale - a.stats.stale
    || (a.nearestDue || '9999').localeCompare(b.nearestDue || '9999')
    || a.name.localeCompare(b.name, 'ko'),
    due: (a, b) => (a.nearestDue || '9999').localeCompare(b.nearestDue || '9999'),
    overdue: (a, b) => b.stats.overdue - a.stats.overdue || a.name.localeCompare(b.name, 'ko'),
    progress: (a, b) => b.stats.completionRate - a.stats.completionRate || a.name.localeCompare(b.name, 'ko'),
    updated: (a, b) => (b.recentNotionAt || '').localeCompare(a.recentNotionAt || ''),
    git: (a, b) => (b.recentGitAt || '').localeCompare(a.recentGitAt || ''),
    name: (a, b) => a.name.localeCompare(b.name, 'ko'),
  }[sort];
  return [...projects].sort(compare || ((a, b) => a.name.localeCompare(b.name, 'ko')));
}

export function sortPeople(people, sort = 'default') {
  const compare = {
    default: (a, b) => b.overdueCount - a.overdueCount || b.staleCount - a.staleCount || b.inProgressCount - a.inProgressCount || a.name.localeCompare(b.name, 'ko'),
    name: (a, b) => a.name.localeCompare(b.name, 'ko'),
    count: (a, b) => b.count - a.count || a.name.localeCompare(b.name, 'ko'),
    active: (a, b) => b.inProgressCount - a.inProgressCount || a.name.localeCompare(b.name, 'ko'),
    overdue: (a, b) => b.overdueCount - a.overdueCount || a.name.localeCompare(b.name, 'ko'),
    stale: (a, b) => b.staleCount - a.staleCount || a.name.localeCompare(b.name, 'ko'),
    due: (a, b) => (a.nearestDue || '9999').localeCompare(b.nearestDue || '9999'),
    updated: (a, b) => (a.latestNotionAt || '9999').localeCompare(b.latestNotionAt || '9999'),
  }[sort];
  return [...people].sort(compare || ((a, b) => a.name.localeCompare(b.name, 'ko')));
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
