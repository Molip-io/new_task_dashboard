import assert from 'node:assert/strict';
import test from 'node:test';
import {
  filterPeopleWorkload,
  filterSpecsWithWorkItems,
  filterVisibleIssues,
  filterWorkItems,
  groupIssuesByProjectItem,
  groupIssuesByProject,
  groupSpecsBySprint,
  projectShouldBeOpen,
  resolveProjectControls,
  sortPeople,
  sortProjects,
  sortWorkItems,
  visibleWorkItemIssues,
  workStatusTone,
} from '../public/dashboard-view-model.js';
import {
  briefingDetailItems,
  gitRepositoryStatus,
  gitTrustSummary,
  issueMatchesCategory,
  issuePresentation,
  primaryActionSummary,
} from '../public/dashboard-management.js';

const workItems = [
  { id: 'a', title: 'A', project: '피자레디', team: '개발', sprint: 'S1', status: '진행 중', due: '2026-07-20', riskScore: 10, issues: [{ type: 'OVERDUE' }] },
  { id: 'b', title: 'B', project: '포지', team: '아트', sprint: 'S2', status: '완료', due: '2026-07-10', riskScore: 1, issues: [] },
];

test('Given shared dashboard filters, When work items are filtered, Then status, team, project, sprint, and issue filters compose', () => {
  const result = filterWorkItems(workItems, { status: '진행 중', team: '개발', project: '피자레디', sprint: 'S1', issueType: 'OVERDUE', includeCompleted: false });

  assert.deepEqual(result.map(item => item.id), ['a']);
});

test('Given work items, When risk sorting is selected, Then highest management risk appears first', () => {
  assert.deepEqual(sortWorkItems(workItems, 'risk').map(item => item.id), ['a', 'b']);
});

test('Given project summaries, When default sorting runs, Then checks and overdue counts outrank names', () => {
  const projects = [
    { name: '가', stats: { issueCount: 0, overdue: 0, stale: 0 }, nearestDue: '2026-07-20' },
    { name: '나', stats: { issueCount: 2, overdue: 0, stale: 0 }, nearestDue: '2026-07-30' },
  ];

  assert.deepEqual(sortProjects(projects).map(project => project.name), ['나', '가']);
});

test('Given people summaries, When default sorting runs, Then overdue, active, item count, and name are applied in order', () => {
  const people = [
    { name: 'A', overdueCount: 0, inProgressCount: 5, count: 5 },
    { name: 'B', overdueCount: 1, inProgressCount: 1, count: 1 },
  ];

  assert.deepEqual(sortPeople(people, 'default').map(person => person.name), ['B', 'A']);
});

test('Given validation issues, When grouped, Then unclassified projects are listed first and issues nest by type', () => {
  const groups = groupIssuesByProject([
    { type: 'OVERDUE', project: '피자레디', severity: 'warning' },
    { type: 'MISSING_PROJECT', project: null, severity: 'error' },
  ]);

  assert.equal(groups[0].project, '프로젝트 미분류');
  assert.equal(groups[1].types[0].type, 'OVERDUE');
});

test('Given a person with active and completed work, When people filters run, Then completed work is excluded and active counts are recalculated', () => {
  const workload = [{
    name: 'A',
    teams: ['개발'],
    tasks: [
      { ...workItems[0], assignees: ['A'] },
      { ...workItems[1], assignees: ['A'], project: '피자레디', sprint: 'S1' },
    ],
  }];

  const result = filterPeopleWorkload(workload, { project: '피자레디', sprint: 'S1' });

  assert.deepEqual(result[0].tasks.map(item => item.id), ['a']);
  assert.equal(result[0].count, 1);
  assert.equal(result[0].projectCount, 1);
});

test('Given project specs across sprints, When sprint groups are built, Then groups sort naturally and completion uses all child work including done', () => {
  const specs = [
    { id: 's1', title: '첫 스펙', sprint: 'Sprint9', tasks: [{ status: '완료' }, { status: '진행 중' }] },
    { id: 's2', title: '다음 스펙', sprint: 'Sprint10', tasks: [{ status: '완료' }] },
    { id: 's3', title: '미지정 스펙', sprint: null, tasks: [] },
  ];

  const groups = groupSpecsBySprint(specs, { order: 'desc' });

  assert.deepEqual(groups.map(group => group.sprint), ['Sprint10', 'Sprint9', '스프린트 미지정']);
  assert.equal(groups[1].completionRate, 50);
  assert.equal(groups[1].totalTasks, 2);
});

test('Given empty, completed, and active project specs, When visible specs are selected, Then only specs with unfinished work remain', () => {
  const specs = [
    { id: 'empty', title: '빈 스펙', tasks: [] },
    { id: 'done', title: '완료 스펙', tasks: [{ status: '완료' }] },
    { id: 'active', title: '진행 스펙', tasks: [{ status: '완료' }, { status: '진행 중' }] },
  ];

  const result = filterSpecsWithWorkItems(specs);

  assert.deepEqual(result.map(spec => spec.id), ['active']);
});

test('Given a saved sprint filter whose specs are now complete, When project controls are resolved, Then the filter returns to all sprints', () => {
  const result = resolveProjectControls({ sprint: 'Sprint58', order: 'desc' }, ['Sprint59', 'Sprint60']);

  assert.deepEqual(result, { sprint: '', order: 'desc' });
});

test('Given a person with only completed history, When people workload has no task filter, Then the person remains with zero active work', () => {
  const workload = [{ name: '[마성호]바트', teams: ['아트'], tasks: [] }];

  const result = filterPeopleWorkload(workload, {});

  assert.equal(result[0].name, '[마성호]바트');
  assert.equal(result[0].count, 0);
});

test('Given several validation rules on one work item, When checks are grouped for action, Then one item contains all reasons', () => {
  const groups = groupIssuesByProjectItem([
    { id: 'start', type: 'MISSING_START_DATE', project: '피자레디', workItemId: 'task-1', severity: 'error' },
    { id: 'due', type: 'MISSING_DUE_DATE', project: '피자레디', workItemId: 'task-1', severity: 'error' },
    { id: 'owner', type: 'MISSING_ASSIGNEE', project: '피자레디', workItemId: 'task-1', severity: 'error' },
  ]);

  assert.equal(groups.length, 1);
  assert.equal(groups[0].items.length, 1);
  assert.deepEqual(groups[0].items[0].issues.map(issue => issue.id), ['start', 'due', 'owner']);
});

test('Given an error project with no explicit expansion, When project open state is resolved, Then its management status does not auto-expand it', () => {
  const project = { name: '피자레디', managementStatus: 'error' };

  assert.equal(projectShouldBeOpen(project, null), false);
  assert.equal(projectShouldBeOpen(project, '피자레디'), true);
});

test('Given completed work with raw validation issues, When project row issues are selected, Then completion stays visible without a red validation badge', () => {
  const completed = { status: '완료', issues: [{ type: 'MISSING_COMPLETED_DATE', severity: 'error' }] };

  assert.deepEqual(visibleWorkItemIssues(completed), []);
});

test('Given work with validation errors, When its status tone is selected, Then the tone depends only on the workflow status', () => {
  const item = { status: '진행 중', guideStatus: 'error', issues: [{ severity: 'error' }] };

  assert.equal(workStatusTone(item), 'info');
  assert.notEqual(workStatusTone(item), 'error');
});

test('Given confirmation issues for active and completed work, When visible issues are selected, Then completed and stale-update issues are hidden', () => {
  const issues = [
    { id: 'active', type: 'OVERDUE', workItemId: 'a' },
    { id: 'done', type: 'MISSING_COMPLETED_DATE', workItemId: 'b' },
    { id: 'stale', type: 'STALE_UPDATE', workItemId: 'a' },
    { id: 'project', type: 'UNMAPPED_GIT_ACTIVITY', workItemId: null },
  ];

  const result = filterVisibleIssues(issues, workItems, []);

  assert.deepEqual(result.map(issue => issue.id), ['active', 'project']);
});

test('Given a legacy validation issue, When its management presentation is selected, Then it receives an actionable category and owner', () => {
  const presentation = issuePresentation({ type: 'MISSING_DUE_DATE', workItemId: 'task-1', recommendedAction: '마감일을 입력하세요.' });

  assert.deepEqual(presentation, {
    category: 'guide', categoryLabel: '가이드 위반', label: '기간 입력 필요',
    recommendedAction: '마감일을 입력하세요.', responsibleRole: '작업 담당자', actionTarget: 'work-item',
  });
});

test('Given several issues on one work item, When the primary action is summarized, Then one action and the remaining count are shown', () => {
  const summary = primaryActionSummary([
    { type: 'OVERDUE', severity: 'warning' },
    { type: 'MISSING_DUE_DATE', severity: 'error' },
    { type: 'MISSING_ASSIGNEE', severity: 'error' },
  ]);

  assert.equal(summary.label, '기간 입력 필요 외 2건');
  assert.equal(summary.tone, 'error');
});

test('Given guide and schedule issues, When briefing guide details are selected, Then overdue-only work is not double-counted as a guide violation', () => {
  const dashboard = { workItems: [
    { id: 'date', status: '진행 중', issues: [{ type: 'MISSING_START_DATE' }] },
    { id: 'late', status: '진행 중', overdueDays: 3, issues: [{ type: 'OVERDUE' }] },
    { id: 'done', status: '완료', issues: [{ type: 'MISSING_DUE_DATE' }] },
  ] };

  assert.deepEqual(briefingDetailItems(dashboard, 'guide').map(item => item.id), ['date']);
  assert.equal(issueMatchesCategory(dashboard.workItems[1].issues[0], 'schedule'), true);
});

test('Given Git repository states, When trust summaries are selected, Then missing URL, authentication, and no-activity states remain distinct', () => {
  assert.equal(gitTrustSummary({ repositories: [], errors: [] }, [{ name: 'A' }]).label, 'Git URL 미입력');
  assert.equal(gitTrustSummary({ repositories: [{ project: 'A', status: 'missing-url' }], errors: [] }, [{ name: 'A', config: { gitUrl: null } }]).label, 'Git URL 미입력');
  assert.equal(gitTrustSummary({ repositories: [{ status: 'auth-required' }], errors: [] }, [{ name: 'A', gitUrl: 'https://github.com/a/a' }]).label, 'Git 인증 필요');
  assert.equal(gitTrustSummary({ repositories: [{ status: 'partial' }], errors: ['partial activity data'] }, [{ name: 'A', gitUrl: 'https://github.com/a/a' }]).label, 'Git 부분 수집');
  assert.equal(gitRepositoryStatus({ status: 'no-activity', commitCount: 0 }), '연결됨 · 최근 활동 없음');
});
