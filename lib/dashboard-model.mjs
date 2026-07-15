import { buildProjectSpecs } from './task-hierarchy.mjs';

const DONE = new Set(['완료', '중단']);
const IN_PROGRESS = new Set(['진행 중']);
const PLANNED = new Set(['진행 예정', '시작 전']);
const REVIEW = new Set(['확인 요청', '검토중']);

function latest(values) {
  return values.filter(Boolean).sort().at(-1) || null;
}

function earliest(values) {
  return values.filter(Boolean).sort()[0] || null;
}

function statusFor(issues) {
  if (issues.some(issue => issue.severity === 'error')) return 'error';
  if (issues.some(issue => issue.severity === 'warning')) return 'warning';
  if (issues.some(issue => issue.severity === 'check')) return 'check';
  return 'normal';
}

function buildPeople(workItems) {
  const people = new Map();
  for (const item of workItems) {
    for (const name of item.assignees || []) {
      const person = people.get(name) || { name, teams: new Set(), projects: new Set(), tasks: [] };
      person.teams.add(item.team || '기타');
      person.projects.add(item.project);
      person.tasks.push(item);
      people.set(name, person);
    }
  }
  return [...people.values()].map(person => ({
    name: person.name,
    teams: [...person.teams],
    projects: [...person.projects],
    projectCount: person.projects.size,
    count: person.tasks.length,
    inProgressCount: person.tasks.filter(item => IN_PROGRESS.has(item.status)).length,
    overdueCount: person.tasks.filter(item => item.overdueDays > 0).length,
    staleCount: person.tasks.filter(item => item.staleBusinessDays > 0).length,
    missingCompletedCount: person.tasks.filter(item => item.issues?.some(issue => issue.type === 'MISSING_COMPLETED_DATE')).length,
    nearestDue: earliest(person.tasks.map(item => item.due)),
    latestNotionAt: latest(person.tasks.map(item => item.notionUpdatedAt)),
    latestGitAt: latest(person.tasks.map(item => item.latestGitAt)),
    tasks: person.tasks,
  })).sort((a, b) => b.overdueCount - a.overdueCount || b.staleCount - a.staleCount || b.inProgressCount - a.inProgressCount || a.name.localeCompare(b.name, 'ko'));
}

function buildProjects(baseProjects, tasks, workItems, issues, commits) {
  return baseProjects.map(project => {
    const items = workItems.filter(item => item.project === project.name);
    const projectTasks = tasks.filter(task => task.project === project.name);
    const projectIssues = issues.filter(issue => issue.project === project.name);
    const projectCommits = commits.filter(commit => commit.project === project.name);
    const stats = {
      total: items.length,
      done: items.filter(item => item.status === '완료').length,
      inProgress: items.filter(item => IN_PROGRESS.has(item.status)).length,
      planned: items.filter(item => PLANNED.has(item.status)).length,
      review: items.filter(item => REVIEW.has(item.status)).length,
      overdue: items.filter(item => item.overdueDays > 0).length,
      stale: items.filter(item => item.staleBusinessDays > 0).length,
      missingData: items.filter(item => item.issues?.some(issue => ['MISSING_START_DATE', 'MISSING_DUE_DATE', 'MISSING_ASSIGNEE', 'MISSING_PROJECT', 'MISSING_SPEC'].includes(issue.type))).length,
      missingCompleted: items.filter(item => item.issues?.some(issue => issue.type === 'MISSING_COMPLETED_DATE')).length,
      issueCount: projectIssues.filter(issue => issue.severity !== 'info').length,
    };
    return {
      ...project,
      specs: buildProjectSpecs(projectTasks, [...DONE]),
      stats: { ...stats, completionRate: stats.total ? Math.round(stats.done / stats.total * 100) : 0 },
      managementStatus: statusFor(projectIssues),
      issues: projectIssues,
      recentNotionAt: latest(items.map(item => item.notionUpdatedAt)),
      recentGitAt: latest([...items.map(item => item.latestGitAt), ...projectCommits.map(commit => commit.committedAt)])?.slice(0, 10) || null,
      nearestDue: earliest(items.filter(item => !DONE.has(item.status)).map(item => item.due)),
      teams: [...new Set(items.map(item => item.team).filter(Boolean))],
    };
  });
}

export function buildManagementDashboard({ base, tasks, workItems, issues, git, notionSetup }) {
  const projects = buildProjects(base.projects, tasks, workItems, issues, git.commits);
  const selectedProjects = new Set(projects.map(project => project.name));
  const projectNamesWithGit = new Set(git.commits.filter(commit => selectedProjects.has(commit.project)).map(commit => commit.project));
  const mismatchProjects = new Set(issues.filter(issue => issue.type === 'GIT_NOTION_ACTIVITY_MISMATCH').map(issue => issue.project));
  const problematicItems = workItems.filter(item => item.issues?.some(issue => issue.severity !== 'info'));
  const missingDate = workItems.filter(item => item.issues?.some(issue => ['MISSING_START_DATE', 'MISSING_DUE_DATE'].includes(issue.type)));
  const workload = buildPeople(workItems);
  const unassignedTasks = workItems.filter(item => !DONE.has(item.status) && !(item.assignees || []).length);
  return {
    ...base,
    projects,
    workItems,
    workload,
    teamQueue: { unassignedTasks, count: unassignedTasks.length },
    hierarchyStats: { personalTaskLinks: workload.reduce((sum, person) => sum + person.count, 0) },
    validationIssues: issues,
    notionSetup,
    git,
    metrics: {
      activeProjects: projects.filter(project => project.stats.inProgress + project.stats.planned + project.stats.review > 0).length,
      inProgressWorkItems: workItems.filter(item => IN_PROGRESS.has(item.status)).length,
      overdueWorkItems: workItems.filter(item => item.overdueDays > 0).length,
      missingDateWorkItems: missingDate.length,
      missingCompletedDateWorkItems: workItems.filter(item => item.issues?.some(issue => issue.type === 'MISSING_COMPLETED_DATE')).length,
      staleWorkItems: workItems.filter(item => item.staleBusinessDays > 0).length,
      guideViolationWorkItems: problematicItems.length,
      needsCheckProjects: projects.filter(project => project.managementStatus !== 'normal').length,
      recentGitProjects: projectNamesWithGit.size,
      gitNotionMismatchProjects: mismatchProjects.size,
      normalWorkItems: workItems.length - problematicItems.length,
      totalWorkItems: workItems.length,
    },
  };
}
