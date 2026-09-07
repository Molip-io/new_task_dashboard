// Shared by the browser and Node. No source fetches or source-record mutations.
export const SPRINT_POLICY_VERSION = '2026-09-07.1';
const CLOSED = new Set(['완료', '일시 정지', '정지', '중단']);
const has = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key);

export function sprintIdentity(value) {
  const raw = String(value || '').trim().toLowerCase().replace(/\s+/g, '');
  if (!raw) return null;
  const match = raw.match(/^(?:sprint|스프린트)(\d+)$/);
  if (!match) return { key: raw, number: null };
  const number = Number(match[1]);
  return { key: `sprint${number}`, number };
}
export const normalizeSprint = value => sprintIdentity(value)?.key || null;
export function uniqueSprints(values = []) {
  return [...new Map(values.filter(value => typeof value === 'string' && value.trim())
    .map(value => [normalizeSprint(value), value.trim()])).values()];
}
export function classifySprint(value, currentSprints = []) {
  const sprint = sprintIdentity(value);
  const current = uniqueSprints(currentSprints).map(sprintIdentity);
  if (!sprint || !current.length) return 'unknown';
  if (current.some(item => item.key === sprint.key)) return 'current';
  if (sprint.number === null || current.some(item => item.number === null)) return 'unknown';
  const numbers = current.map(item => item.number);
  if (sprint.number > Math.max(...numbers)) return 'future';
  if (sprint.number < Math.min(...numbers)) return 'past';
  return 'unknown'; // Non-contiguous selections do not make the intervening sprint current.
}
export function projectKey(project) {
  return String(project.notionId || project.config?.notionId || project.name);
}
export function usesSprints(project) {
  return (project.sprintRequired ?? project.config?.sprintRequired) !== false;
}
export function currentSprints(project) {
  return uniqueSprints(project.currentSprints ?? project.config?.currentSprints ?? []);
}
export function scopeSignature(projects = []) {
  return JSON.stringify(projects.map(project => [projectKey(project), usesSprints(project),
    currentSprints(project).map(normalizeSprint).sort()]).sort((a, b) => a[0].localeCompare(b[0])));
}
export function applySprintSelections(projects, selections = {}) {
  return projects.map(project => {
    const key = projectKey(project);
    const sprints = has(selections, key) ? uniqueSprints(selections[key]) : currentSprints(project);
    return { ...project, currentSprints: sprints, config: { ...project.config, currentSprints: sprints } };
  });
}
function itemKey(item) { return `${item.project || ''}:${item.id || item.url || item.title}`; }
export function sortIssuesOverdueFirst(issues = []) {
  const rank = issue => issue.type === 'OVERDUE' ? -1 : ({ error: 0, warning: 1, check: 2, info: 3 }[issue.severity] ?? 4);
  return [...issues].sort((a, b) => rank(a) - rank(b));
}
export function isOverdue(item) {
  return !CLOSED.has(item.status) && (Number(item.overdueDays) > 0 || (item.issues || []).some(issue => issue.type === 'OVERDUE'));
}

// All four task KPIs use child work items. Parent checks remain in the audit/Checks tab.
export function buildSprintOverview(dashboard, selections = {}, filters = {}) {
  const projects = applySprintSelections(dashboard.projects || [], selections);
  const byName = new Map(projects.map(project => [project.name, project]));
  const specs = new Map(projects.flatMap(project => (project.specs || []).map(spec => [spec.id, spec])));
  const raw = dashboard.workItems || [];
  const allIssues = dashboard.validationIssues || [];
  const unique = new Map();
  for (const original of raw) {
    if (original.itemLevel === 'parent' || CLOSED.has(original.status) || CLOSED.has(specs.get(original.specId)?.status)) continue;
    const issues = new Map([...(original.issues || []), ...allIssues.filter(issue => issue.workItemId === original.id)]
      .map(issue => [issue.id || `${issue.type}:${issue.message || ''}`, issue]));
    const item = { ...original, issues: sortIssuesOverdueFirst([...issues.values()]) };
    unique.set(itemKey(item), item);
  }
  const active = [...unique.values()].filter(item =>
    (!filters.project || item.project === filters.project) &&
    (!filters.team || item.team === filters.team) &&
    (!filters.assignee || (item.assignees || []).includes(filters.assignee)));
  const relation = item => {
    const project = byName.get(item.project);
    return !project ? 'unknown' : !usesSprints(project) ? 'not-applicable' : classifySprint(item.sprint, currentSprints(project));
  };
  const inScope = item => ['current', 'not-applicable'].includes(relation(item));
  const selected = active.filter(inScope).map(item => ({ ...item, sprintRelation: relation(item) }));
  const overdue = selected.filter(isOverdue);
  const guide = selected.filter(item => !isOverdue(item) && item.issues.some(issue => issue.category === 'guide'));
  const setup = selected.filter(item => item.sprintRelation === 'current' && item.status === '시작 전' && !isOverdue(item));
  const running = selected.filter(item => item.status === '진행 중');
  const selectedProjects = projects.filter(project => selected.some(item => item.project === project.name))
    .map(project => {
      const items = selected.filter(item => item.project === project.name);
      return { ...project, stats: { ...project.stats, total: items.length, inProgress: items.filter(item => item.status === '진행 중').length,
        overdue: items.filter(isOverdue).length, issueCount: items.filter(item => item.issues.length).length } };
    });
  const parentIds = new Set(allIssues.filter(issue => !issue.workItemId && issue.specId).map(issue => issue.specId));
  return {
    policyVersion: SPRINT_POLICY_VERSION,
    projects: selectedProjects, configuredProjects: projects, workItems: selected,
    runningItems: running, overdueItems: overdue, guideViolationItems: guide, progressSetupItems: setup,
    outsideOverdueItems: active.filter(item => !inScope(item) && isOverdue(item)),
    unknownSprintItems: active.filter(item => relation(item) === 'unknown'),
    pastNotStartedItems: active.filter(item => relation(item) === 'past' && item.status === '시작 전'),
    parentIssueCount: parentIds.size,
    unconfiguredProjects: projects.filter(project => usesSprints(project) && !currentSprints(project).length).map(project => project.name),
    metrics: { activeProjects: selectedProjects.length, inProgressWorkItems: running.length, overdueWorkItems: overdue.length,
      guideViolationWorkItems: guide.length, progressSetupRequiredItems: setup.length },
  };
}

export function availableSprints(dashboard, project) {
  return uniqueSprints([...currentSprints(project),
    ...(dashboard.workItems || []).filter(item => item.project === project.name).map(item => item.sprint),
    ...(project.specs || []).map(spec => spec.sprint)])
    .sort((a, b) => a.localeCompare(b, 'ko', { numeric: true }));
}
