import assert from 'node:assert/strict';
import test from 'node:test';
import { validateWorkManagement } from '../lib/work-validation.mjs';

const NOW = '2026-07-15T09:00:00+09:00';

function issueTypes(result, workItemId) {
  return result.issues.filter(issue => issue.workItemId === workItemId).map(issue => issue.type);
}

test('Given an active work item without dates or assignees, When guide validation runs, Then every missing management field is reported', () => {
  const tasks = [
    { id: 'spec', title: '핵심 스펙', project: '피자레디', parentIds: [], status: '진행 중', start: '2026-07-01', due: '2026-07-31', assignees: ['PD'], edited: NOW },
    { id: 'work', title: '개발 작업', project: '피자레디', parentIds: ['spec'], status: '진행 중', start: null, due: null, completedAt: null, assignees: [], edited: NOW },
  ];

  const result = validateWorkManagement({ tasks, projects: [{ name: '피자레디' }], gitActivity: [], now: NOW });

  assert.deepEqual(issueTypes(result, 'work').sort(), [
    'MISSING_ASSIGNEE',
    'MISSING_BRANCH',
    'MISSING_DUE_DATE',
    'MISSING_PRIORITY',
    'MISSING_SPRINT',
    'MISSING_START_DATE',
  ].sort());
});

test('Given a work item scoped through its parent but missing its own project relation, When validation runs, Then the project remains a guide violation', () => {
  const tasks = [
    { id: 'spec', title: '핵심 스펙', project: '피자레디', projectMissing: false, parentIds: [], status: '진행 중', start: '2026-07-01', due: '2026-07-31', assignees: ['PD'], edited: NOW },
    { id: 'work', title: '개발 작업', project: '피자레디', projectMissing: true, projectInherited: true, parentIds: ['spec'], status: '진행 중', start: '2026-07-01', due: '2026-07-31', assignees: ['A'], edited: NOW },
  ];

  const result = validateWorkManagement({ tasks, projects: [{ name: '피자레디' }], gitActivity: [], now: NOW });

  assert.ok(issueTypes(result, 'work').includes('MISSING_PROJECT'));
  assert.equal(result.issues.find(issue => issue.workItemId === 'work' && issue.type === 'MISSING_PROJECT').project, '피자레디');
});

test('Given overdue and completed work items, When validation runs, Then overdue is explicit and completed work is not collected', () => {
  const tasks = [
    { id: 'spec', title: '스펙', project: '포지', parentIds: [], status: '진행 중', start: '2026-07-01', due: '2026-07-31', assignees: ['PD'], edited: NOW },
    { id: 'late', title: '지연 작업', project: '포지', parentIds: ['spec'], status: '진행 중', start: '2026-07-01', due: '2026-07-10', assignees: ['A'], edited: NOW },
    { id: 'done', title: '완료 작업', project: '포지', parentIds: ['spec'], status: '완료', start: '2026-07-01', due: '2026-07-12', completedAt: null, assignees: ['B'], edited: NOW },
  ];

  const result = validateWorkManagement({ tasks, projects: [{ name: '포지' }], gitActivity: [], now: NOW });
  const overdue = result.issues.find(issue => issue.workItemId === 'late' && issue.type === 'OVERDUE');

  assert.equal(overdue.metadata.overdueDays, 5);
  assert.match(overdue.message, /5일/);
  assert.equal(issueTypes(result, 'done').length, 0);
  assert.equal(result.workItems.some(item => item.id === 'done'), false);
});

test('Given a planned work item whose start date has passed, When validation runs, Then its status and schedule must be reconciled', () => {
  const tasks = [
    { id: 'spec', title: '비밀 과자점', project: '피자레디', parentIds: [], status: '진행 중', start: '2026-07-01', due: '2026-08-12', assignees: ['PD'], edited: NOW },
    {
      id: 'work',
      title: '리소스 적용 및 연출',
      project: '피자레디',
      parentIds: ['spec'],
      status: '진행 예정',
      sprint: 'Sprint60',
      start: '2026-07-01',
      due: '2026-08-12',
      assignees: ['A'],
      priority: '높음',
      branch: 'feature/secret-store',
      branches: ['feature/secret-store'],
      edited: NOW,
    },
  ];

  const result = validateWorkManagement({
    tasks,
    projects: [{ name: '피자레디', currentSprints: ['Sprint60'] }],
    gitActivity: [],
    now: '2026-08-06T09:00:00+09:00',
  });
  const issue = result.issues.find(row => row.workItemId === 'work' && row.type === 'PLANNED_START_DATE_PASSED');

  assert.ok(issue);
  assert.equal(issue.category, 'guide');
  assert.equal(issue.metadata.elapsedDays, 36);
  assert.match(issue.message, /시작일이 36일 지났지만 진행 예정/);
  assert.match(issue.recommendedAction, /진행 중으로 변경|시작일을 조정/);
});

test('Given a planned work item starting today or later, When validation runs, Then it is not flagged as a stale planned status', () => {
  const tasks = [
    { id: 'spec', title: '상위 작업', project: '피자레디', parentIds: [], status: '진행 예정', start: '2026-08-06', due: '2026-08-12' },
    { id: 'today', title: '오늘 시작', project: '피자레디', parentIds: ['spec'], status: '진행 예정', sprint: 'Sprint60', start: '2026-08-06', due: '2026-08-12', assignees: ['A'], priority: '높음', branch: 'today', branches: ['today'] },
    { id: 'future', title: '내일 시작', project: '피자레디', parentIds: ['spec'], status: '진행 예정', sprint: 'Sprint60', start: '2026-08-07', due: '2026-08-12', assignees: ['B'], priority: '높음', branch: 'future', branches: ['future'] },
  ];

  const result = validateWorkManagement({
    tasks,
    projects: [{ name: '피자레디', currentSprints: ['Sprint60'] }],
    now: '2026-08-06T09:00:00+09:00',
  });

  assert.equal(result.issues.some(issue => issue.type === 'PLANNED_START_DATE_PASSED'), false);
});

test('Given a third-level item and an orphan item, When hierarchy is validated, Then both structural violations are reported', () => {
  const common = { project: '피자레디', status: '시작 전', start: '2026-07-01', due: '2026-07-31', assignees: ['A'], edited: NOW };
  const tasks = [
    { ...common, id: 'spec', title: '스펙', parentIds: [] },
    { ...common, id: 'child', title: '작업항목', parentIds: ['spec'] },
    { ...common, id: 'third', title: '3단계', parentIds: ['child'] },
    { ...common, id: 'orphan', title: '고아', parentIds: ['missing'] },
  ];

  const result = validateWorkManagement({ tasks, projects: [{ name: '피자레디' }], gitActivity: [], now: NOW });

  assert.ok(issueTypes(result, 'third').includes('INVALID_HIERARCHY'));
  assert.ok(issueTypes(result, 'orphan').includes('MISSING_SPEC'));
});

test('Given recent Git activity and stale Notion data, When validation runs, Then the activity mismatch is prioritized without changing status', () => {
  const tasks = [
    { id: 'spec', title: '스펙', project: '피자레디', parentIds: [], status: '진행 중', start: '2026-07-01', due: '2026-07-31', assignees: ['PD'], edited: '2026-07-07T09:00:00+09:00' },
    { id: 'work', title: '기능 개발', project: '피자레디', parentIds: ['spec'], status: '진행 중', start: '2026-07-01', due: '2026-07-31', assignees: ['A'], edited: '2026-07-07T09:00:00+09:00', gitKey: 'PIZZA-42' },
  ];
  const gitActivity = [{ project: '피자레디', workItemId: 'work', committedAt: '2026-07-14T12:00:00+09:00', hash: 'abc', message: 'PIZZA-42 implement' }];

  const result = validateWorkManagement({ tasks, projects: [{ name: '피자레디' }], gitActivity, now: NOW, staleBusinessDays: 3 });

  assert.ok(issueTypes(result, 'work').includes('GIT_NOTION_ACTIVITY_MISMATCH'));
  assert.equal(result.workItems.find(item => item.id === 'work').status, '진행 중');
});

test('Given old Notion edit time without Git evidence, When validation runs, Then edit age alone is not treated as a management problem', () => {
  const tasks = [
    { id: 'spec', title: '스펙', project: '피자레디', parentIds: [], status: '진행 중', start: '2026-07-01', due: '2026-07-31', assignees: ['PD'], edited: '2026-07-01T09:00:00+09:00' },
    { id: 'work', title: '기능 개발', project: '피자레디', parentIds: ['spec'], status: '진행 중', start: '2026-07-01', due: '2026-07-31', assignees: ['A'], edited: '2026-07-01T09:00:00+09:00' },
  ];

  const result = validateWorkManagement({ tasks, projects: [{ name: '피자레디' }], gitActivity: [], now: NOW, staleBusinessDays: 3 });

  assert.ok(!issueTypes(result, 'work').includes('STALE_UPDATE'));
});

test('Given a previously completed item that is active again, When snapshots are compared, Then rework suspicion is reported', () => {
  const tasks = [
    { id: 'spec', title: '스펙', project: '피자레디', parentIds: [], status: '진행 중', start: '2026-07-01', due: '2026-07-31', assignees: ['PD'], edited: NOW },
    { id: 'work', title: 'QA 대응', project: '피자레디', parentIds: ['spec'], status: '진행 중', start: '2026-07-01', due: '2026-07-31', assignees: ['A'], edited: NOW },
  ];
  const previousSnapshot = { projects: [{ name: '피자레디', tasks: [{ id: 'work', status: '완료' }] }] };

  const result = validateWorkManagement({ tasks, projects: [{ name: '피자레디' }], gitActivity: [], previousSnapshot, now: NOW });

  assert.ok(issueTypes(result, 'work').includes('REOPENED_COMPLETED_ITEM'));
});

test('Given an overdue item without the guide-required delay record, When validation runs, Then reason, date history, and owner tag are requested', () => {
  const tasks = [
    { id: 'spec', title: '스펙', project: '피자레디', parentIds: [], status: '진행 중', start: '2026-07-01', due: '2026-07-31', assignees: ['PD'], edited: NOW },
    { id: 'late', title: '지연 작업', project: '피자레디', parentIds: ['spec'], status: '진행 중', start: '2026-07-01', due: '2026-07-10', assignees: ['A'], edited: NOW, delayReason: null, previousDue: null, delayTaggedUsers: [] },
  ];

  const result = validateWorkManagement({ tasks, projects: [{ name: '피자레디' }], gitActivity: [], now: NOW });
  const types = issueTypes(result, 'late');

  assert.ok(types.includes('MISSING_DELAY_REASON'));
  assert.ok(types.includes('MISSING_DELAY_DATE_HISTORY'));
  assert.ok(types.includes('MISSING_DELAY_OWNER_TAG'));
});

test('Given validation issues from multiple domains, When validation runs, Then every issue carries one management action contract', () => {
  const tasks = [
    { id: 'spec', title: '스펙', project: '피자레디', parentIds: [], status: '진행 중', start: '2026-07-01', due: '2026-07-31', assignees: ['PD'], edited: NOW },
    { id: 'late', title: '지연 작업', project: '피자레디', parentIds: ['spec'], status: '진행 중', start: null, due: '2026-07-10', assignees: ['A'], edited: NOW },
    { id: 'git-work', title: 'Git 작업', project: '피자레디', parentIds: ['spec'], status: '진행 중', start: '2026-07-01', due: '2026-07-20', assignees: ['B'], edited: '2026-07-01T09:00:00+09:00' },
  ];
  const gitActivity = [
    { project: '피자레디', workItemId: 'git-work', committedAt: '2026-07-14T12:00:00+09:00', hash: 'mapped-active', message: 'active work' },
    { project: '피자레디', workItemId: null, committedAt: '2026-07-14T13:00:00+09:00', hash: 'unmapped', message: 'unknown task' },
  ];

  const result = validateWorkManagement({ tasks, projects: [{ name: '피자레디' }], gitActivity, now: NOW });

  for (const issue of result.issues) {
    assert.ok(['guide', 'schedule', 'consistency', 'integration'].includes(issue.category), `${issue.type} category`);
    assert.ok(issue.label, `${issue.type} label`);
    assert.ok(issue.responsibleRole, `${issue.type} responsibleRole`);
    assert.ok(issue.actionTarget, `${issue.type} actionTarget`);
    assert.ok(issue.recommendedAction, `${issue.type} recommendedAction`);
  }
  assert.equal(result.issues.find(issue => issue.type === 'MISSING_START_DATE').category, 'guide');
  assert.equal(result.issues.find(issue => issue.type === 'OVERDUE').category, 'schedule');
  assert.equal(result.issues.find(issue => issue.type === 'GIT_NOTION_ACTIVITY_MISMATCH').category, 'consistency');
  assert.equal(result.issues.find(issue => issue.type === 'UNMAPPED_GIT_ACTIVITY').category, 'integration');
});

test('Given multiple unmapped commits in one project, When validation runs, Then one project-level issue summarizes mapping coverage and a representative commit', () => {
  const tasks = [
    { id: 'spec', title: '스펙', project: '피자레디', parentIds: [], status: '진행 중', start: '2026-07-01', due: '2026-07-31', assignees: ['PD'], edited: NOW },
    { id: 'work', title: '개발 작업', project: '피자레디', parentIds: ['spec'], status: '진행 중', start: '2026-07-01', due: '2026-07-31', assignees: ['A'], edited: NOW },
  ];
  const gitActivity = [
    { project: '피자레디', workItemId: 'work', committedAt: '2026-07-12T12:00:00+09:00', hash: 'mapped', message: 'linked' },
    { project: '피자레디', workItemId: null, committedAt: '2026-07-13T12:00:00+09:00', hash: 'older', message: 'unknown one', url: 'https://github.test/older' },
    { project: '피자레디', workItemId: null, committedAt: '2026-07-14T12:00:00+09:00', hash: 'newer', message: 'unknown two', url: 'https://github.test/newer' },
  ];

  const result = validateWorkManagement({ tasks, projects: [{ name: '피자레디' }], gitActivity, now: NOW });
  const unmapped = result.issues.filter(issue => issue.type === 'UNMAPPED_GIT_ACTIVITY');

  assert.equal(unmapped.length, 1);
  assert.equal(unmapped[0].workItemId, null);
  assert.equal(unmapped[0].specId, null);
  assert.match(unmapped[0].message, /2건/);
  assert.deepEqual(unmapped[0].metadata, {
    commitCount: 3,
    mappedCommitCount: 1,
    unmappedCommitCount: 2,
    mappingRate: 33,
    commitHash: 'newer',
    committedAt: '2026-07-14T12:00:00+09:00',
    url: 'https://github.test/newer',
    representativeCommit: {
      hash: 'newer',
      committedAt: '2026-07-14T12:00:00+09:00',
      message: 'unknown two',
      url: 'https://github.test/newer',
    },
  });
});

test('Given Git repository collection states, When validation runs, Then each unhealthy repository creates one project-level integration issue', () => {
  const tasks = [
    { id: 'spec', title: '스펙', project: '피자레디', parentIds: [], status: '진행 중', start: '2026-07-01', due: '2026-07-31', assignees: ['PD'], edited: NOW },
  ];
  const gitRepositories = [
    { name: 'missing', project: '피자레디', source: 'notion', status: 'missing-url', remote: null },
    { name: 'invalid', project: '피자레디', source: 'notion', status: 'invalid-url', remote: 'https://gitlab.test/game' },
    { name: 'private', project: '피자레디', source: 'notion', status: 'auth-required', remote: 'https://github.com/molip/private' },
    { name: 'partial', project: '피자레디', source: 'notion', status: 'partial', remote: 'https://github.com/molip/partial' },
    { name: 'failed', project: '피자레디', source: 'notion', status: 'failed', remote: 'https://github.com/molip/failed' },
    { name: 'healthy', project: '피자레디', source: 'notion', status: 'ok', remote: 'https://github.com/molip/healthy' },
    { name: 'quiet', project: '피자레디', source: 'notion', status: 'no-activity', remote: 'https://github.com/molip/quiet' },
  ];

  const result = validateWorkManagement({ tasks, projects: [{ name: '피자레디' }], gitRepositories, now: NOW });
  const repositoryIssues = result.issues.filter(issue => issue.type.startsWith('GIT_'));

  assert.deepEqual(repositoryIssues.map(issue => issue.type).sort(), [
    'GIT_AUTH_REQUIRED',
    'GIT_FETCH_FAILED',
    'GIT_PARTIAL_FETCH',
    'GIT_URL_INVALID',
    'GIT_URL_MISSING',
  ]);
  assert.equal(new Set(repositoryIssues.map(issue => issue.id)).size, 5);
  for (const issue of repositoryIssues) {
    assert.equal(issue.project, '피자레디');
    assert.equal(issue.workItemId, null);
    assert.equal(issue.specId, null);
    assert.equal(issue.category, 'integration');
    assert.equal(issue.actionTarget, ['GIT_URL_MISSING', 'GIT_URL_INVALID'].includes(issue.type) ? 'project' : 'git-repository');
    assert.equal(issue.metadata.repositoryStatus, gitRepositories.find(repository => repository.name === issue.metadata.repository)?.status);
  }
});

test('Given no repository collection argument, When validation runs, Then existing callers remain compatible', () => {
  const tasks = [
    { id: 'spec', title: '스펙', project: '피자레디', parentIds: [], status: '진행 중', start: '2026-07-01', due: '2026-07-31', assignees: ['PD'], edited: NOW },
  ];

  const result = validateWorkManagement({ tasks, projects: [{ name: '피자레디' }], now: NOW });

  assert.equal(result.issues.some(issue => issue.type.startsWith('GIT_')), false);
});

test('Given a current-sprint start-before item, When validation runs, Then setup is requested without requiring execution fields', () => {
  const tasks = [
    { id: 'spec', title: '스펙', project: '피자레디', parentIds: [], status: '진행 중', sprint: 'Sprint60' },
    { id: 'work', title: '준비 작업', project: '피자레디', parentIds: ['spec'], status: '시작 전', sprint: 'Sprint 60', assignees: [], priority: null, start: null, due: null, branches: [] },
  ];

  const result = validateWorkManagement({
    tasks,
    projects: [{ name: '피자레디', currentSprints: ['스프린트60'] }],
    now: NOW,
  });
  const types = issueTypes(result, 'work');

  assert.ok(types.includes('CURRENT_SPRINT_SETUP_REQUIRED'));
  assert.ok(!types.includes('MISSING_ASSIGNEE'));
  assert.ok(!types.includes('MISSING_PRIORITY'));
  assert.ok(!types.includes('MISSING_START_DATE'));
  assert.ok(!types.includes('MISSING_DUE_DATE'));
  assert.ok(!types.includes('MISSING_BRANCH'));
  assert.equal(result.progressSetupItems.length, 1);
});

test('Given a project that does not use sprints, When work has no sprint, Then no sprint guide issue or sprint readiness issue is created', () => {
  const tasks = [
    { id: 'spec', title: 'AI 연구', project: 'AI Native', parentIds: [], status: '진행 중', sprint: null },
    { id: 'work', title: '개념 연구', project: 'AI Native', parentIds: ['spec'], status: '진행 중', sprint: null, assignees: ['A'], priority: '높음', start: '2026-08-05', due: '2026-08-11', branch: 'feature/ai', branches: ['feature/ai'] },
  ];

  const result = validateWorkManagement({
    tasks,
    projects: [{ name: 'AI Native', sprintRequired: false, currentSprints: [] }],
    now: NOW,
  });

  assert.equal(result.issues.some(issue => issue.type === 'MISSING_SPRINT'), false);
  assert.equal(result.issues.some(issue => ['CURRENT_SPRINT_SETUP_REQUIRED', 'PAST_SPRINT_NOT_STARTED'].includes(issue.type)), false);
  assert.equal(result.ruleItems.find(item => item.id === 'work').sprintRelation, 'not-applicable');
});

test('Given future and past start-before items, When validation runs, Then future setup is excluded and past work remains visible', () => {
  const tasks = [
    { id: 'spec', title: '스펙', project: '피자레디', parentIds: [], status: '진행 중', sprint: 'Sprint60' },
    { id: 'future', title: '미래 작업', project: '피자레디', parentIds: ['spec'], status: '시작 전', sprint: 'Sprint61' },
    { id: 'past', title: '지난 작업', project: '피자레디', parentIds: ['spec'], status: '시작 전', sprint: 'Sprint59' },
  ];

  const result = validateWorkManagement({
    tasks,
    projects: [{ name: '피자레디', currentSprints: ['스프린트60'] }],
    now: NOW,
  });

  assert.ok(!issueTypes(result, 'future').includes('CURRENT_SPRINT_SETUP_REQUIRED'));
  assert.ok(!issueTypes(result, 'future').some(type => ['MISSING_ASSIGNEE', 'MISSING_PRIORITY', 'MISSING_START_DATE', 'MISSING_DUE_DATE', 'MISSING_BRANCH'].includes(type)));
  assert.ok(issueTypes(result, 'past').includes('PAST_SPRINT_NOT_STARTED'));
  assert.equal(result.ruleStats.futureSprintExcludedItems, 1);
  assert.equal(result.ruleStats.pastSprintNotStartedItems, 1);
});

test('Given configured project owners and a described parent item, When validation runs, Then required owners are compared by user ID', () => {
  const tasks = [{
    id: 'spec',
    title: '상위 작업',
    project: '피자레디',
    parentIds: [],
    status: '진행 중',
    sprint: 'Sprint60',
    description: '목적\n범위\n완료 기준',
    descriptionChecked: true,
    assigneeUsers: [{ id: 'pd' }, { id: 'lead' }],
  }];
  const projects = [{
    name: '피자레디',
    currentSprints: ['Sprint60'],
    pdUsers: [{ id: 'pd' }],
    teamLeadUsers: [{ id: 'lead' }],
  }];

  const result = validateWorkManagement({ tasks, projects, now: NOW });

  assert.equal(result.issues.some(issue => ['MISSING_DESCRIPTION', 'MISSING_REQUIRED_OWNERS'].includes(issue.type)), false);
});

test('Given a confirmation request comment mentioning the project PD, When validation runs, Then the tag rule passes', () => {
  const tasks = [
    { id: 'spec', title: '스펙', project: '피자레디', parentIds: [], status: '진행 중', sprint: 'Sprint60' },
    {
      id: 'work',
      title: '확인 작업',
      project: '피자레디',
      parentIds: ['spec'],
      status: '확인 요청',
      sprint: 'Sprint60',
      assigneeUsers: [{ id: 'owner' }],
      commentCheckAvailable: true,
      commentMentionUserIds: ['pd'],
    },
  ];
  const projects = [{ name: '피자레디', currentSprints: ['Sprint60'], pdUsers: [{ id: 'pd' }] }];

  const result = validateWorkManagement({ tasks, projects, now: NOW });

  assert.equal(issueTypes(result, 'work').includes('MISSING_CONFIRMATION_COMMENT_TAG'), false);
  assert.equal(issueTypes(result, 'work').includes('RULE_NOT_EVALUATED'), false);
});

test('Given completed, paused, and stopped work, When validation runs, Then none enters active validation', () => {
  const tasks = [
    { id: 'spec', title: '스펙', project: '피자레디', parentIds: [], status: '진행 중', sprint: 'Sprint60' },
    { id: 'done', title: '완료', project: '피자레디', parentIds: ['spec'], status: '완료', sprint: 'Sprint60' },
    { id: 'paused', title: '정지', project: '피자레디', parentIds: ['spec'], status: '일시 정지', sprint: 'Sprint60' },
    { id: 'stopped', title: '중단', project: '피자레디', parentIds: ['spec'], status: '중단', sprint: 'Sprint60' },
  ];

  const result = validateWorkManagement({ tasks, projects: [{ name: '피자레디', currentSprints: ['Sprint60'] }], now: NOW });

  assert.deepEqual(result.workItems, []);
  assert.equal(result.issues.some(issue => ['done', 'paused', 'stopped'].includes(issue.workItemId)), false);
});
