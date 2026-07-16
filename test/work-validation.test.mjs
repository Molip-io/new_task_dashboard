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

  assert.deepEqual(issueTypes(result, 'work').sort(), ['MISSING_ASSIGNEE', 'MISSING_DUE_DATE', 'MISSING_START_DATE'].sort());
});

test('Given overdue and completed work items, When validation runs, Then overdue days and missing completion date are explicit', () => {
  const tasks = [
    { id: 'spec', title: '스펙', project: '포지', parentIds: [], status: '진행 중', start: '2026-07-01', due: '2026-07-31', assignees: ['PD'], edited: NOW },
    { id: 'late', title: '지연 작업', project: '포지', parentIds: ['spec'], status: '진행 중', start: '2026-07-01', due: '2026-07-10', assignees: ['A'], edited: NOW },
    { id: 'done', title: '완료 작업', project: '포지', parentIds: ['spec'], status: '완료', start: '2026-07-01', due: '2026-07-12', completedAt: null, assignees: ['B'], edited: NOW },
  ];

  const result = validateWorkManagement({ tasks, projects: [{ name: '포지' }], gitActivity: [], now: NOW });
  const overdue = result.issues.find(issue => issue.workItemId === 'late' && issue.type === 'OVERDUE');

  assert.equal(overdue.metadata.overdueDays, 5);
  assert.match(overdue.message, /5일/);
  assert.ok(issueTypes(result, 'done').includes('MISSING_COMPLETED_DATE'));
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
    { id: 'done', title: '완료 작업', project: '피자레디', parentIds: ['spec'], status: '완료', start: '2026-07-01', due: '2026-07-10', completedAt: '2026-07-10', assignees: ['B'], edited: NOW },
  ];
  const gitActivity = [
    { project: '피자레디', workItemId: 'done', committedAt: '2026-07-14T12:00:00+09:00', hash: 'mapped-after-done', message: 'late fix' },
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
