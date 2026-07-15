import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDashboardSyncCompleted } from '../lib/sync-event.mjs';

test('Given a completed dashboard build, When the extension event is created, Then it contains notification-ready counts without sending Slack', () => {
  const event = buildDashboardSyncCompleted({
    generatedAt: '2026-07-15T00:00:00.000Z',
    projects: [{ managementStatus: 'normal' }, { managementStatus: 'needs-update' }],
    workItems: [{ overdueDays: 2 }, { overdueDays: 0 }],
    validationIssues: [{ type: 'OVERDUE' }, { type: 'MISSING_DUE_DATE' }],
  });

  assert.equal(event.type, 'dashboardSyncCompleted');
  assert.equal(event.payload.normalProjects, 1);
  assert.equal(event.payload.needsUpdateProjects, 1);
  assert.equal(event.payload.overdueWorkItems, 1);
  assert.equal(event.payload.issueCount, 2);
  assert.equal(event.notificationSent, false);
});
