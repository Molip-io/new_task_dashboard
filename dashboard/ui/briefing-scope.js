import { briefingDetailItems } from './dashboard-management.js';

export function sprintKey(value) {
  const raw = String(value ?? '').trim().toLowerCase().replace(/\s+/g, '');
  const number = raw.match(/^(?:sprint|스프린트)?(\d+(?:\.\d+)?)$/);
  return number ? `sprint${Number(number[1])}` : raw;
}

export function sprintOptions(dashboard) {
  const items = [...(dashboard.workItems || []), ...(dashboard.guideViolationItems || []), ...(dashboard.progressSetupItems || []), ...(dashboard.projects || []).flatMap(project => project.specs || [])];
  const keys = [...new Set(items.map(item => sprintKey(item.sprint)).filter(Boolean))];
  return keys.sort((a, b) => a.localeCompare(b, 'ko', { numeric: true })).map(key => ({ key, label: key.startsWith('sprint') && /^\d/.test(key.slice(6)) ? `스프린트 ${key.slice(6)}` : key }));
}

export function scopeBriefing(dashboard, filters = {}) {
  const keys = (filters.sprints || []).map(sprintKey);
  const matches = item => (!keys.length || keys.includes(sprintKey(item.sprint)))
    && (!filters.project || item.project === filters.project)
    && (!filters.team || item.team === filters.team)
    && (!filters.assignee || (item.assignees || []).includes(filters.assignee));
  const scoped = {
    ...dashboard,
    workItems: (dashboard.workItems || []).filter(matches),
    guideViolationItems: briefingDetailItems(dashboard, 'guide').filter(matches),
    progressSetupItems: briefingDetailItems(dashboard, 'setup').filter(matches),
  };
  scoped.projects = (dashboard.projects || []).filter(project => !filters.project || project.name === filters.project).map(project => {
    const active = scoped.workItems.filter(item => item.project === project.name);
    return { ...project, stats: { ...project.stats,
      inProgress: active.filter(item => item.status === '진행 중').length,
      planned: active.filter(item => ['시작 전', '진행 예정'].includes(item.status)).length,
      review: active.filter(item => ['확인 요청', '검토중'].includes(item.status)).length,
      overdue: active.filter(item => item.overdueDays > 0 && !['완료', '일시 정지', '정지', '중단'].includes(item.status)).length,
    } };
  });
  scoped.metrics = { ...dashboard.metrics,
    activeProjects: briefingDetailItems(scoped, 'projects').length,
    inProgressWorkItems: briefingDetailItems(scoped, 'work-items').length,
    overdueWorkItems: briefingDetailItems(scoped, 'overdue').length,
    guideViolationWorkItems: briefingDetailItems(scoped, 'guide').length,
    progressSetupRequiredItems: briefingDetailItems(scoped, 'setup').length,
  };
  return scoped;
}
