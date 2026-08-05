import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DASHBOARD_SNAPSHOT_MAX_PAYLOAD_LENGTH,
  compactDashboard,
  decodeDashboardSnapshot,
  encodeDashboardSnapshot,
  publishDashboardSnapshotToNotion,
  readLatestDashboardSnapshotFromNotion,
} from '../lib/dashboard-snapshot.mjs';

const dashboard = {
  generatedAt: '2026-07-21T22:30:00.000Z',
  errors: [],
  metrics: { activeProjects: 1 },
  projects: [{
    name: '피자레디',
    config: { gitUrl: 'https://github.com/Molip-io/pizzaready', channels: ['private-channel'] },
    specs: [{ id: 'spec-1', title: '익스프레스', status: '진행 중', sprint: 'Sprint 58', childStats: { total: 2, done: 1, completionRate: 50 }, tasks: [{ id: 'task-1', title: '기획', status: '진행 중', raw: 'duplicate' }, { id: 'task-2', title: '개발', status: '완료', raw: 'duplicate' }] }],
    specInsights: [{
      specId: 'spec-1', title: '익스프레스', summary: '개발 진행 중', blockers: ['검토 대기'], nextAction: '검토 완료',
      evidence: [{ source: 'slack', timestamp: '2026-07-21', title: '#피자레디', excerpt: '기획 확정', url: 'https://slack.com/message' }],
    }],
    stats: { total: 1, done: 0 },
  }],
  workItems: [{
    id: 'task-1', title: '기획', status: '진행 중', project: '피자레디', spec: '익스프레스',
    issues: [{ id: 'duplicate-issue' }], assignees: ['a'], rawNotion: { secret: true },
  }],
  guideViolationItems: [{
    id: 'spec-1', itemLevel: 'parent', title: '익스프레스', status: '진행 중', project: '피자레디',
    issues: [{ id: 'parent-issue', type: 'MISSING_DESCRIPTION', category: 'guide', severity: 'error' }],
    rawNotion: { secret: true },
  }],
  workload: [{ name: 'a', teams: ['기획'], tasks: [{ id: 'task-1', rawNotion: { duplicate: true } }] }],
  validationIssues: [{ id: 'issue-1', type: 'MISSING_DUE_DATE', severity: 'error', project: '피자레디', workItemId: 'task-1', metadata: { url: 'https://notion.so/task', raw: 'drop' } }],
  git: { repositories: [], commits: [], errors: [] },
  sourceHealth: { status: 'complete', sources: [] },
};

test('Given a full dashboard, When compacted for remote delivery, Then duplicate and raw source fields are removed', () => {
  const compact = compactDashboard(dashboard);

  assert.equal(compact.projects[0].specs[0].tasks.length, 2);
  assert.equal(compact.projects[0].specs[0].tasks[1].status, '완료');
  assert.equal(compact.projects[0].specs[0].tasks[1].raw, undefined);
  assert.equal(compact.projects[0].specs[0].childStats.completionRate, 50);
  assert.equal(compact.projects[0].specInsights[0].summary, '개발 진행 중');
  assert.equal(compact.projects[0].specInsights[0].evidence[0].source, 'slack');
  assert.deepEqual(compact.workload[0].tasks, [{ id: 'task-1' }]);
  assert.equal(compact.workItems[0].rawNotion, undefined);
  assert.equal(compact.workItems[0].issues, undefined);
  assert.equal(compact.guideViolationItems[0].itemLevel, 'parent');
  assert.equal(compact.guideViolationItems[0].issues[0].type, 'MISSING_DESCRIPTION');
  assert.equal(compact.guideViolationItems[0].rawNotion, undefined);
  assert.equal(compact.projects[0].config.channels, undefined);
});

test('Given a compact dashboard, When encoded and decoded, Then the browser payload round-trips below the Notion limit', () => {
  const payload = encodeDashboardSnapshot(dashboard);
  const decoded = decodeDashboardSnapshot(payload);

  assert.ok(payload.length < DASHBOARD_SNAPSHOT_MAX_PAYLOAD_LENGTH);
  assert.equal(decoded.projects[0].name, '피자레디');
  assert.equal(decoded.workItems[0].title, '기획');
  assert.equal(decoded.guideViolationItems[0].title, '익스프레스');
});

test('Given no current snapshot, When published, Then an idempotent Notion page is created', async () => {
  let created;
  const result = await publishDashboardSnapshotToNotion({
    databaseId: 'summary-db',
    dashboard,
    query: async () => [],
    create: async (databaseId, properties) => {
      created = { databaseId, properties };
      return { id: 'page-1' };
    },
  });

  assert.equal(result.status, 'created');
  assert.equal(result.runId, 'dashboard-snapshot:2026-07-21');
  assert.equal(created.databaseId, 'summary-db');
  assert.equal(created.properties.run_id.rich_text[0].text.content, result.runId);
});

test('Given a stored snapshot, When read, Then the latest payload is decoded', async () => {
  const payload = encodeDashboardSnapshot(dashboard);
  const result = await readLatestDashboardSnapshotFromNotion({
    databaseId: 'summary-db',
    query: async () => [{
      id: 'page-1',
      last_edited_time: '2026-07-21T23:00:00.000Z',
      properties: {
        run_id: { type: 'rich_text', rich_text: [{ plain_text: 'dashboard-snapshot:2026-07-21' }] },
        payload: { type: 'rich_text', rich_text: [{ plain_text: payload }] },
      },
    }],
  });

  assert.equal(result.dashboard.generatedAt, dashboard.generatedAt);
  assert.equal(result.runId, 'dashboard-snapshot:2026-07-21');
});
