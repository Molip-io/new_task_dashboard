import { businessDaysBetween, calendarDaysBetween, kstDate } from './business-days.mjs';
import { enrichValidationIssue } from './issue-catalog.mjs';

const DONE = new Set(['완료', '중단']);
const severityScore = { error: 100, warning: 30, check: 10, info: 2 };

function addIssue(issues, issue) {
  const enriched = enrichValidationIssue(issue);
  const subject = enriched.workItemId || enriched.specId || enriched.metadata?.repositoryKey || enriched.metadata?.commitHash || 'project';
  issues.push({
    id: `${issue.type}:${issue.project || 'unclassified'}:${subject}`,
    detectedAt: enriched.detectedAt,
    metadata: enriched.metadata || {},
    ...enriched,
  });
}

function previousStatuses(snapshot) {
  const statuses = new Map();
  for (const project of snapshot?.projects || []) {
    for (const task of project.tasks || []) statuses.set(task.id, task.status);
  }
  return statuses;
}

function hierarchyDepth(task, tasksById, visiting = new Set()) {
  if (!(task.parentIds || []).length) return 0;
  if (visiting.has(task.id)) return Number.POSITIVE_INFINITY;
  const parent = tasksById.get(task.parentIds[0]);
  if (!parent) return 1;
  const next = new Set(visiting);
  next.add(task.id);
  return 1 + hierarchyDepth(parent, tasksById, next);
}

function latestCommit(commits) {
  return [...commits].sort((a, b) => b.committedAt.localeCompare(a.committedAt))[0] || null;
}

export function validateWorkManagement({
  tasks,
  projects,
  gitActivity = [],
  gitRepositories = [],
  previousSnapshot = null,
  now = new Date().toISOString(),
  staleBusinessDays = 3,
}) {
  const detectedAt = new Date(now).toISOString();
  const today = kstDate(now);
  const projectNames = new Set(projects.map(project => project.name));
  const tasksById = new Map(tasks.map(task => [task.id, task]));
  const priorStatuses = previousStatuses(previousSnapshot);
  const issues = [];
  const gitByWorkItem = new Map();
  for (const commit of gitActivity) {
    if (!commit.workItemId) continue;
    const commits = gitByWorkItem.get(commit.workItemId) || [];
    commits.push(commit);
    gitByWorkItem.set(commit.workItemId, commits);
  }

  const repositoryIssueTypes = {
    'missing-url': ['GIT_URL_MISSING', 'Git 저장소 URL이 입력되지 않음'],
    'invalid-url': ['GIT_URL_INVALID', 'Git 저장소 URL 형식이 올바르지 않음'],
    'auth-required': ['GIT_AUTH_REQUIRED', 'Git 저장소 접근 인증 필요'],
    partial: ['GIT_PARTIAL_FETCH', 'Git 활동 일부를 수집하지 못함'],
    failed: ['GIT_FETCH_FAILED', 'Git 활동을 수집하지 못함'],
  };
  for (const repository of gitRepositories) {
    const [type, message] = repositoryIssueTypes[repository.status] || [];
    if (!type) continue;
    const project = projectNames.has(repository.project) ? repository.project : null;
    const repositoryName = repository.name || repository.remote || repository.gitUrl || repository.url || repository.project || 'repository';
    addIssue(issues, {
      type,
      severity: repository.status === 'failed' ? 'error' : repository.status === 'partial' ? 'warning' : 'check',
      message,
      project,
      specId: null,
      workItemId: null,
      detectedAt,
      metadata: {
        repository: repositoryName,
        repositoryKey: repository.remote || repository.gitUrl || repository.url || repositoryName,
        repositoryStatus: repository.status,
        source: repository.source || null,
        remote: repository.remote || repository.gitUrl || repository.url || null,
        defaultBranch: repository.defaultBranch || repository.branch || null,
        lastFetchedAt: repository.lastFetchedAt || null,
      },
    });
  }

  for (const task of tasks) {
    const isWorkItem = (task.parentIds || []).length > 0;
    const spec = isWorkItem ? tasksById.get(task.parentIds[0]) : null;
    const base = { project: projectNames.has(task.project) ? task.project : null, workItemId: isWorkItem ? task.id : null, specId: isWorkItem ? spec?.id || null : task.id, detectedAt };
    if (!task.start) addIssue(issues, { ...base, type: 'MISSING_START_DATE', severity: 'error', message: '시작일 없음', recommendedAction: 'Notion 기간의 시작일을 입력하세요.' });
    if (!task.due) addIssue(issues, { ...base, type: 'MISSING_DUE_DATE', severity: 'error', message: '마감일 없음', recommendedAction: 'Notion 기간의 마감일을 입력하세요.' });
    if (task.start && task.due && task.start > task.due) addIssue(issues, { ...base, type: 'DATE_RANGE_MISMATCH', severity: 'error', message: '시작일이 마감일보다 늦음', recommendedAction: '기간의 시작일과 마감일을 확인하세요.' });
    if (!projectNames.has(task.project)) addIssue(issues, { ...base, type: 'MISSING_PROJECT', severity: 'check', message: '프로젝트 연결 필요', recommendedAction: '요약 대상 프로젝트를 연결하세요.' });

    if (isWorkItem) {
      if (!spec) addIssue(issues, { ...base, type: 'MISSING_SPEC', severity: 'error', message: '상위 스펙 연결 필요', recommendedAction: '작업항목을 상위 핵심 작업에 연결하세요.' });
      if (hierarchyDepth(task, tasksById) > 1) addIssue(issues, { ...base, type: 'INVALID_HIERARCHY', severity: 'error', message: '3단계 이상의 작업 구조', recommendedAction: '상위 스펙과 작업항목의 2단계 구조로 이동하세요.' });
      if (!(task.assignees || []).length) addIssue(issues, { ...base, type: 'MISSING_ASSIGNEE', severity: 'error', message: task.ignoredAssigneeCount ? '담당자 재지정 필요' : '담당자 없음', recommendedAction: '현재 담당자를 지정하세요.' });
      if (spec && task.start && spec.start && task.start < spec.start) addIssue(issues, { ...base, type: 'DATE_RANGE_MISMATCH', severity: 'warning', message: '작업항목 시작일이 상위 스펙보다 빠름', recommendedAction: '상위·하위 기간을 확인하세요.' });
      if (spec && task.due && spec.due && task.due > spec.due) addIssue(issues, { ...base, type: 'DATE_RANGE_MISMATCH', severity: 'warning', message: '작업항목 마감일이 상위 스펙 기간을 벗어남', recommendedAction: '상위 완료일 또는 작업항목 마감일을 조정하세요.' });
    }

    const overdueDays = !DONE.has(task.status) && task.due && task.due < today ? calendarDaysBetween(task.due, today) : 0;
    if (overdueDays > 0) addIssue(issues, { ...base, type: 'OVERDUE', severity: 'warning', message: `기한 초과 ${overdueDays >= 14 ? '14일 이상' : `${overdueDays}일`}`, recommendedAction: '지연 사유와 변경 일정을 상위 페이지에 기록하세요.', metadata: { overdueDays } });
    if (task.status === '완료' && !task.completedAt) addIssue(issues, { ...base, type: 'MISSING_COMPLETED_DATE', severity: 'error', message: '완료 상태지만 완료일 없음', recommendedAction: '실제 완료일을 입력하세요.' });
    if (task.status === '완료' && task.completedAt && task.due) {
      const relation = task.completedAt > task.due ? '마감일 이후 완료' : task.completedAt < task.due ? '마감일 이전 완료' : '마감일 당일 완료';
      addIssue(issues, { ...base, type: 'COMPLETION_DATE_RELATION', severity: 'info', message: relation, recommendedAction: null, metadata: { due: task.due, completedAt: task.completedAt } });
    }
    if (overdueDays > 0 && !task.delayReason) addIssue(issues, { ...base, type: 'MISSING_DELAY_REASON', severity: 'warning', message: '지연 사유 기록 없음', recommendedAction: '상위 페이지에 지연 사유를 기록하세요.' });
    if (overdueDays > 0 && !task.previousDue) addIssue(issues, { ...base, type: 'MISSING_DELAY_DATE_HISTORY', severity: 'check', message: '변경 전후 일정 기록 확인 필요', recommendedAction: '변경 전 날짜와 변경 후 날짜를 함께 기록하세요.' });
    if (overdueDays > 0 && !(task.delayTaggedUsers || []).length) addIssue(issues, { ...base, type: 'MISSING_DELAY_OWNER_TAG', severity: 'check', message: '지연 공유 담당자 태그 확인 필요', recommendedAction: 'PD 또는 메인 기획자를 태그하세요.' });
    if (priorStatuses.get(task.id) === '완료' && !DONE.has(task.status)) addIssue(issues, { ...base, type: 'REOPENED_COMPLETED_ITEM', severity: 'warning', message: '완료 후 재작업 의심', recommendedAction: '추가 작업이면 기존 페이지가 아닌 신규 작업항목을 생성하세요.' });

    const commit = latestCommit(gitByWorkItem.get(task.id) || []);
    if (commit && task.status === '완료' && task.completedAt && commit.committedAt.slice(0, 10) > task.completedAt) {
      addIssue(issues, { ...base, type: 'GIT_NOTION_ACTIVITY_MISMATCH', severity: 'check', message: 'Notion 완료일 이후 관련 Git 커밋 발생', recommendedAction: '완료 후 수정인지 신규 작업항목이 필요한지 확인하세요.', metadata: { commitHash: commit.hash, committedAt: commit.committedAt } });
    } else if (commit && task.edited && businessDaysBetween(task.edited, commit.committedAt) >= staleBusinessDays) {
      addIssue(issues, { ...base, type: 'GIT_NOTION_ACTIVITY_MISMATCH', severity: 'info', message: `Notion 갱신 이후 Git 커밋 발생`, recommendedAction: '실제 진행 내용이 Notion에 반영됐는지 확인하세요.', metadata: { commitHash: commit.hash, committedAt: commit.committedAt } });
    }
  }

  const childrenByParent = new Map();
  for (const task of tasks.filter(task => (task.parentIds || []).length)) {
    for (const parentId of task.parentIds) {
      const children = childrenByParent.get(parentId) || [];
      children.push(task);
      childrenByParent.set(parentId, children);
    }
  }
  for (const spec of tasks.filter(task => !(task.parentIds || []).length)) {
    const children = childrenByParent.get(spec.id) || [];
    if (DONE.has(spec.status) && children.some(child => !DONE.has(child.status))) addIssue(issues, { type: 'PARENT_CHILD_STATUS_MISMATCH', severity: 'error', message: '미완료 작업항목이 있지만 상위 스펙은 완료 상태', project: spec.project, specId: spec.id, workItemId: null, detectedAt, recommendedAction: '상위 스펙 상태 또는 하위 작업 상태를 확인하세요.' });
    if (children.length && !DONE.has(spec.status) && children.every(child => DONE.has(child.status))) addIssue(issues, { type: 'PARENT_CHILD_STATUS_MISMATCH', severity: 'warning', message: '모든 작업항목이 완료됐지만 상위 스펙은 진행 중', project: spec.project, specId: spec.id, workItemId: null, detectedAt, recommendedAction: '상위 스펙 완료 여부를 확인하세요.' });
  }

  const commitsByProject = new Map();
  for (const commit of gitActivity) {
    const key = commit.project || '__unclassified__';
    const commits = commitsByProject.get(key) || [];
    commits.push(commit);
    commitsByProject.set(key, commits);
  }
  for (const commits of commitsByProject.values()) {
    const unmapped = commits.filter(commit => !commit.workItemId);
    if (!unmapped.length) continue;
    const project = projectNames.has(unmapped[0].project) ? unmapped[0].project : null;
    const representative = latestCommit(unmapped);
    const mappedCommitCount = commits.length - unmapped.length;
    addIssue(issues, {
      type: 'UNMAPPED_GIT_ACTIVITY',
      severity: 'check',
      message: project ? `작업항목을 연결할 수 없는 Git 활동 ${unmapped.length}건` : `프로젝트를 연결할 수 없는 Git 활동 ${unmapped.length}건`,
      project,
      specId: null,
      workItemId: null,
      detectedAt,
      recommendedAction: project ? '커밋 메시지에 작업 키를 포함하거나 매핑 규칙을 추가하세요.' : 'Git 저장소의 프로젝트 매핑을 설정하세요.',
      metadata: {
        commitCount: commits.length,
        mappedCommitCount,
        unmappedCommitCount: unmapped.length,
        mappingRate: Math.round((mappedCommitCount / commits.length) * 100),
        commitHash: representative.hash,
        committedAt: representative.committedAt,
        url: representative.url,
        representativeCommit: {
          hash: representative.hash,
          committedAt: representative.committedAt,
          message: representative.message,
          url: representative.url,
        },
      },
    });
  }

  const workItems = tasks.filter(task => (task.parentIds || []).length).map(task => {
    const itemIssues = issues.filter(issue => issue.workItemId === task.id);
    const commit = latestCommit(gitByWorkItem.get(task.id) || []);
    const overdue = itemIssues.find(issue => issue.type === 'OVERDUE')?.metadata.overdueDays || 0;
    return {
      ...task,
      specId: task.parentIds[0] || null,
      spec: tasksById.get(task.parentIds[0])?.title || null,
      notionUpdatedAt: task.edited || null,
      latestGitAt: commit?.committedAt || null,
      latestGitCommit: commit || null,
      overdueDays: overdue,
      staleBusinessDays: 0,
      issues: itemIssues,
      riskScore: itemIssues.reduce((score, issue) => score + (severityScore[issue.severity] || 0), 0) + overdue,
      guideStatus: itemIssues.some(issue => issue.severity === 'error') ? 'error' : itemIssues.some(issue => issue.severity === 'warning') ? 'warning' : itemIssues.length ? 'check' : 'normal',
    };
  });

  return { issues, workItems };
}
