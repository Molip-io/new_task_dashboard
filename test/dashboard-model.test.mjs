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
