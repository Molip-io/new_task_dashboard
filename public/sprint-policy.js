// Shared by the browser and Node. No source fetches or source-record mutations.
export const SPRINT_POLICY_VERSION = '2026-09-07.2';
export const GLOBAL_SPRINT_ALL = '전체';
const CLOSED = new Set(['완료', '일시 정지', '정지', '중단']);

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
  return 'unknown'; // 3,5 does not silently make Sprint4 current.
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

export function parseSprintInput(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return { mode: 'unset', input: '', sprints: [], configured: false };
  if (raw.replace(/\s+/g, '') === GLOBAL_SPRINT_ALL) {
    return { mode: 'all', input: GLOBAL_SPRINT_ALL, sprints: [], configured: true };
  }
  const compact = raw.replace(/\s+/g, '');
  if (!/^\d+(,\d+)*$/.test(compact)) {
    throw new Error('현재 스프린트는 숫자를 쉼표로 입력하거나 ‘전체’를 입력하세요. 예: 3,4,5 · 전체');
  }
  const numbers = [...new Set(compact.split(',').map(Number))].sort((a, b) => a - b);
  if (numbers.some(number => !Number.isSafeInteger(number) || number < 0 || number > 99999)) {
    throw new Error('스프린트 번호가 올바르지 않습니다.');
  }
  return {
    mode: 'selected',
    input: numbers.join(','),
    sprints: numbers.map(number => `Sprint${number}`),
    configured: true,
  };
}

function inputFromSprints(values = []) {
  const identities = uniqueSprints(values).map(sprintIdentity);
  if (!identities.length) return '';
  if (identities.some(item => item?.number === null || item?.number === undefined)) {
    return uniqueSprints(values).join(',');
  }
  return [...new Set(identities.map(item => item.number))].sort((a, b) => a - b).join(',');
}

export function allKnownSprints(dashboard = {}) {
  return uniqueSprints([
    ...(dashboard.projects || []).flatMap(project => [
      ...currentSprints(project),
      ...(project.specs || []).map(spec => spec.sprint),
    ]),
    ...(dashboard.workItems || dashboard.tasks || []).map(item => item.sprint),
  ]).sort((a, b) => String(a).localeCompare(String(b), 'ko', { numeric: true }));
}

export function legacyGlobalSprintScope(projects = []) {
  const sprintProjects = projects.filter(usesSprints);
  const sets = sprintProjects.map(project => currentSprints(project).map(normalizeSprint).sort());
  const first = JSON.stringify(sets[0] || []);
  const consistent = sets.length > 0 && sets.every(set => set.length > 0 && JSON.stringify(set) === first);
  const sprints = consistent ? currentSprints(sprintProjects[0]) : [];
  return {
    mode: consistent ? 'selected' : 'unset',
    input: consistent ? inputFromSprints(sprints) : '',
    sprints,
    configured: consistent,
    source: consistent ? 'notion-legacy' : 'notion-legacy-conflict',
  };
}

export function resolveSprintScope(dashboard = {}, setting = null) {
  if (!setting) return legacyGlobalSprintScope(dashboard.projects || []);
  if (setting.mode === 'all') {
    return { mode: 'all', input: GLOBAL_SPRINT_ALL, sprints: allKnownSprints(dashboard), configured: true, source: 'dashboard' };
  }
  if (setting.mode === 'selected') {
    const sprints = uniqueSprints(setting.sprints || parseSprintInput(setting.input).sprints);
    return { mode: 'selected', input: inputFromSprints(sprints), sprints, configured: true, source: 'dashboard' };
  }
  return { mode: 'unset', input: '', sprints: [], configured: false, source: 'dashboard' };
}

export function applyGlobalSprintScope(projects = [], scope = {}) {
  const sprints = uniqueSprints(scope.sprints || []);
  return projects.map(project => usesSprints(project)
    ? {
        ...project,
        currentSprints: sprints,
        sprintSettingSource: scope.source || 'dashboard',
        config: { ...project.config, currentSprints: sprints, sprintRequired: true },
      }
    : {
        ...project,
        currentSprints: [],
        sprintSettingSource: 'not-applicable',
        config: { ...project.config, currentSprints: [], sprintRequired: false },
      });
}

export function applySprintSelections(projects = [], selections = []) {
  const sprints = Array.isArray(selections) ? selections : uniqueSprints(Object.values(selections || {}).flat());
  return applyGlobalSprintScope(projects, { sprints, source: 'dashboard' });
}

export function scopeSignature(scopeOrProjects = [], mode = null) {
  if (Array.isArray(scopeOrProjects)) {
    return JSON.stringify([
      mode || 'selected',
      scopeOrProjects.filter(usesSprints).map(project => currentSprints(project).map(normalizeSprint).sort()).sort(),
    ]);
  }
  const scope = scopeOrProjects || {};
  return JSON.stringify([scope.mode || 'unset', uniqueSprints(scope.sprints || []).map(normalizeSprint).sort()]);
}

function itemKey(item) { return `${item.project || ''}:${item.id || item.url || item.title}`; }
export function sortIssuesOverdueFirst(issues = []) {
  const rank = issue => issue.type === 'OVERDUE' ? -1 : ({ error: 0, warning: 1, check: 2, info: 3 }[issue.severity] ?? 4);
  return [...issues].sort((a, b) => rank(a) - rank(b));
}
export function isOverdue(item) {
  return !CLOSED.has(item.status) && (Number(item.overdueDays) > 0 || (item.issues || []).some(issue => issue.type === 'OVERDUE'));
}

export function buildSprintOverview(dashboard, scopeOverride = null, filters = {}) {
  let scope;
  if (typeof scopeOverride === 'string') scope = parseSprintInput(scopeOverride);
  else if (scopeOverride?.mode) scope = scopeOverride;
  else scope = dashboard.sprintSettings?.scope || dashboard.sprintScope || resolveSprintScope(dashboard, dashboard.sprintSettings?.setting || null);

  if (scope.mode === 'all' && !(scope.sprints || []).length) scope = { ...scope, sprints: allKnownSprints(dashboard) };
  const projects = applyGlobalSprintScope(dashboard.projects || [], scope);
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

  const selectedKeys = new Set(uniqueSprints(scope.sprints || []).map(normalizeSprint));
  const relation = item => {
    const project = byName.get(item.project);
    if (!project) return 'unknown';
    if (!usesSprints(project)) return 'not-applicable';
    if (scope.mode === 'all') return item.sprint ? 'current' : 'unknown';
    if (scope.mode === 'selected') return classifySprint(item.sprint, scope.sprints || []);
    return 'unknown';
  };
  const inScope = item => {
    if (!scope.configured && scope.mode === 'unset') return false;
    const project = byName.get(item.project);
    if (project && !usesSprints(project)) return true;
    if (scope.mode === 'all') return Boolean(item.sprint);
    return selectedKeys.has(normalizeSprint(item.sprint));
  };

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
  const outsideOverdueItems = active.filter(item => !inScope(item) && isOverdue(item));
  return {
    policyVersion: SPRINT_POLICY_VERSION,
    scope: { ...scope, sprints: uniqueSprints(scope.sprints || []) },
    scopeConfigured: scope.mode !== 'unset' && scope.configured !== false,
    projects: selectedProjects,
    configuredProjects: projects,
    workItems: selected,
    runningItems: running,
    overdueItems: overdue,
    guideViolationItems: guide,
    progressSetupItems: setup,
    outsideOverdueItems,
    unknownSprintItems: active.filter(item => usesSprints(byName.get(item.project) || {}) && relation(item) === 'unknown'),
    pastNotStartedItems: active.filter(item => relation(item) === 'past' && item.status === '시작 전'),
    parentIssueCount: parentIds.size,
    unconfiguredProjects: scope.mode === 'unset' ? projects.filter(usesSprints).map(project => project.name) : [],
    metrics: {
      activeProjects: selectedProjects.length,
      inProgressWorkItems: running.length,
      overdueWorkItems: overdue.length,
      guideViolationWorkItems: guide.length,
      progressSetupRequiredItems: setup.length,
    },
  };
}

export function availableSprints(dashboard) {
  return allKnownSprints(dashboard);
}
