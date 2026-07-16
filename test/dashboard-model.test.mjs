import assert from 'node:assert/strict';
import test from 'node:test';
import { buildManagementDashboard } from '../lib/dashboard-model.mjs';

test('Given validated work items and Git activity, When the dashboard model is built, Then project, person, and briefing metrics share the same facts', () => {
  const base = {
    generatedAt: '2026-07-15T00:00:00.000Z',
    projects: [{ name: '피자레디', config: {}, notionSummary: null, meetings: [], slack: [] }],
    meetings: [], errors: [], slack: {}, ai: null,
  };
  const workItems = [
    { id: 'a', title: '개발', project: '피자레디', spec: '스펙', status: '진행 중', team: '개발', assignees: ['행크'], due: '2026-07-14', overdueDays: 1, staleBusinessDays: 3, completedAt: null, notionUpdatedAt: '2026-07-10', latestGitAt: '2026-07-15', issues: [{ type: 'OVERDUE', severity: 'warning' }], riskScore: 31 },
  ];
  const dashboard = buildManagementDashboard({ base, tasks: [], workItems, issues: workItems[0].issues.map(issue => ({ ...issue, project: '피자레디', workItemId: 'a' })), git: { repositories: [], commits: [], errors: [] }, notionSetup: { ready: true, databases: [] } });

  assert.equal(dashboard.metrics.inProgressWorkItems, 1);
  assert.equal(dashboard.metrics.overdueWorkItems, 1);
  assert.equal(dashboard.projects[0].stats.issueCount, 1);
  assert.equal(dashboard.workload[0].overdueCount, 1);
  assert.equal(dashboard.projects[0].recentGitAt, '2026-07-15');
});

test('Given completed and stale confirmation issues, When the dashboard model is built, Then progress keeps completed work while people and confirmation queues stay active-only', () => {
  const base = {
    generatedAt: '2026-07-15T00:00:00.000Z',
    projects: [{ name: '피자레디', config: {}, notionSummary: null, meetings: [], slack: [] }],
    meetings: [], errors: [], slack: {}, ai: null,
  };
  const workItems = [
    { id: 'active', title: '진행', project: '피자레디', spec: '스펙', status: '진행 중', team: '개발', assignees: ['행크'], overdueDays: 1, issues: [], riskScore: 0 },
    { id: 'done', title: '완료', project: '피자레디', spec: '스펙', status: '완료', team: '개발', assignees: ['행크'], overdueDays: 0, issues: [], riskScore: 0 },
  ];
  const issues = [
    { id: 'active-overdue', type: 'OVERDUE', severity: 'warning', project: '피자레디', workItemId: 'active' },
    { id: 'done-date', type: 'MISSING_COMPLETED_DATE', severity: 'error', project: '피자레디', workItemId: 'done' },
    { id: 'unscoped-done-date', type: 'MISSING_COMPLETED_DATE', severity: 'error', project: null, workItemId: 'unscoped-done' },
    { id: 'stale', type: 'STALE_UPDATE', severity: 'warning', project: '피자레디', workItemId: 'active' },
  ];

  const dashboard = buildManagementDashboard({ base, tasks: [{ id: 'unscoped-done', status: '완료' }], workItems, issues, git: { repositories: [], commits: [], errors: [] }, notionSetup: { ready: true, databases: [] } });

  assert.equal(dashboard.projects[0].stats.total, 2);
  assert.equal(dashboard.projects[0].stats.done, 1);
  assert.deepEqual(dashboard.workload[0].tasks.map(item => item.id), ['active']);
  assert.deepEqual(dashboard.validationIssues.map(issue => issue.id), ['active-overdue']);
});

test('Given a person assigned only to completed work, When the dashboard model is built, Then the person remains in the roster with zero active work', () => {
  const base = {
    generatedAt: '2026-07-15T00:00:00.000Z',
    projects: [{ name: '포지 앤 포춘', config: {}, notionSummary: null, meetings: [], slack: [] }],
    meetings: [], errors: [], slack: {}, ai: null,
  };
  const workItems = [
    { id: 'done', title: '애니메이션 최적화', project: '포지 앤 포춘', spec: '아트 최적화', status: '완료', team: '아트', assignees: ['[마성호]바트'], overdueDays: 0, issues: [], riskScore: 0 },
  ];

  const dashboard = buildManagementDashboard({ base, tasks: [], workItems, issues: [], git: { repositories: [], commits: [], errors: [] }, notionSetup: { ready: true, databases: [] } });

  assert.equal(dashboard.workload[0].name, '[마성호]바트');
  assert.equal(dashboard.workload[0].count, 0);
  assert.deepEqual(dashboard.workload[0].tasks, []);
});

test('Given guide and schedule issues that overlap, When briefing metrics are built, Then guide violations and overdue work remain distinct dimensions', () => {
  const base = {
    generatedAt: '2026-07-16T00:00:00.000Z',
    projects: [{ name: '피자레디', config: {}, notionSummary: null, meetings: [], slack: [] }],
    meetings: [], errors: [], slack: {}, ai: null,
  };
  const workItems = [
    { id: 'schedule', title: '일정만 지연', project: '피자레디', status: '진행 중', team: '개발', assignees: ['A'], overdueDays: 2, issues: [], riskScore: 30 },
    { id: 'guide', title: '날짜 누락', project: '피자레디', status: '진행 중', team: '기획', assignees: ['B'], overdueDays: 0, issues: [{ type: 'MISSING_DUE_DATE', category: 'guide' }], riskScore: 100 },
    { id: 'both', title: '지연 기록 누락', project: '피자레디', status: '진행 중', team: '기획', assignees: ['C'], overdueDays: 3, issues: [{ type: 'OVERDUE', category: 'schedule' }, { type: 'MISSING_DELAY_REASON', category: 'guide' }], riskScore: 130 },
  ];
  const issues = [
    { id: 'overdue-1', type: 'OVERDUE', category: 'schedule', severity: 'warning', project: '피자레디', workItemId: 'schedule' },
    { id: 'missing-date', type: 'MISSING_DUE_DATE', category: 'guide', severity: 'error', project: '피자레디', workItemId: 'guide' },
    { id: 'overdue-2', type: 'OVERDUE', category: 'schedule', severity: 'warning', project: '피자레디', workItemId: 'both' },
    { id: 'missing-delay', type: 'MISSING_DELAY_REASON', category: 'guide', severity: 'warning', project: '피자레디', workItemId: 'both' },
  ];

  const dashboard = buildManagementDashboard({ base, tasks: [], workItems, issues, git: { repositories: [], commits: [], errors: [] }, notionSetup: { ready: true, databases: [] } });

  assert.equal(dashboard.metrics.overdueWorkItems, 2);
  assert.equal(dashboard.metrics.guideViolationWorkItems, 2);
  assert.equal(dashboard.metrics.missingDateWorkItems, 1);
});
