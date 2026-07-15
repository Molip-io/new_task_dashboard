import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  attachOperationalMetadata,
  buildSourceHealth,
  diffSnapshots,
  saveDailySnapshot,
} from '../lib/operational-metadata.mjs';

const current = {
  generatedAt: '2026-07-15T07:30:00.000Z',
  errors: [],
  projects: [{
    name: '피자레디',
    config: { channels: ['team-pizza', 's2-pizza'] },
    stats: { total: 4, done: 2 },
    activeTasks: [{ id: 'task-1', title: 'QA', status: '진행 중', due: '2026-07-23', assignees: ['행크'] }],
    notionSummary: { status: '주의' },
    slack: [{ channel: 'team-pizza', count: 3 }],
  }],
  meetings: [{ date: '2026-07-14T01:00:00.000Z' }],
};

test('Given one missing Slack channel, When source health is built, Then Slack is partial and its coverage is explicit', () => {
  const health = buildSourceHealth(current);

  const slack = health.sources.find(source => source.id === 'slack');
  assert.equal(slack.status, 'partial');
  assert.equal(slack.successful, 1);
  assert.equal(slack.expected, 2);
  assert.equal(health.dependencyCoverage.status, 'unmeasured');
});

test('Given matching project and task IDs, When snapshots are compared, Then changed status and due date are returned', () => {
  const previous = {
    generatedAt: '2026-07-14T07:30:00.000Z',
    projects: [{
      name: '피자레디',
      status: '정상',
      completionRate: 50,
      tasks: [{ id: 'task-1', title: 'QA', status: '진행 예정', due: '2026-07-22', assignees: ['행크'] }],
    }],
  };
  const next = {
    generatedAt: '2026-07-15T07:30:00.000Z',
    projects: [{
      name: '피자레디',
      status: '주의',
      completionRate: 50,
      tasks: [{ id: 'task-1', title: 'QA', status: '진행 중', due: '2026-07-23', assignees: ['행크'] }],
    }],
  };

  const deltas = diffSnapshots(previous, next);

  assert.deepEqual(deltas.map(delta => delta.field), ['project.status', 'task.status', 'task.due']);
  assert.equal(deltas[0].from, '정상');
  assert.equal(deltas[0].to, '주의');
});

test('Given no earlier daily snapshot, When metadata is attached, Then delta comparison is explicitly unavailable', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dashboard-metadata-'));

  const enriched = attachOperationalMetadata(current, directory);

  assert.equal(enriched.snapshotComparison.available, false);
  assert.deepEqual(enriched.deltas, []);
  assert.match(enriched.snapshotComparison.reason, /전일 스냅샷/);
});

test('Given an enriched dashboard, When saving a daily snapshot, Then a date-keyed comparable snapshot is persisted', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dashboard-snapshot-'));
  const enriched = attachOperationalMetadata(current, directory);

  const file = saveDailySnapshot(enriched, directory);
  const snapshot = JSON.parse(fs.readFileSync(file, 'utf8'));

  assert.equal(path.basename(file), '2026-07-15.json');
  assert.equal(snapshot.projects[0].name, '피자레디');
  assert.equal(snapshot.projects[0].completionRate, 50);
  assert.equal(snapshot.projects[0].tasks[0].id, 'task-1');
});

test('Given a child task that just completed, When a snapshot is saved, Then the completed task remains comparable tomorrow', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dashboard-completed-snapshot-'));
  const completed = {
    ...current,
    projects: [{
      ...current.projects[0],
      activeTasks: [],
      specs: [{ tasks: [{ id: 'task-done', title: 'QA', status: '완료', due: '2026-07-15', assignees: ['행크'] }] }],
    }],
  };

  const file = saveDailySnapshot(completed, directory);
  const snapshot = JSON.parse(fs.readFileSync(file, 'utf8'));

  assert.equal(snapshot.projects[0].tasks[0].id, 'task-done');
  assert.equal(snapshot.projects[0].tasks[0].status, '완료');
});

test('Given a successful collection, When the dashboard is written, Then operational metadata is attached before its daily snapshot is saved', () => {
  const collector = fs.readFileSync(new URL('../collect.mjs', import.meta.url), 'utf8');

  const attachIndex = collector.indexOf('attachOperationalMetadata(dashboard, DATA)');
  const writeIndex = collector.indexOf("fs.writeFileSync(path.join(DATA, 'dashboard.json')");
  const snapshotIndex = collector.indexOf('saveDailySnapshot(dashboard, DATA)');

  assert.ok(attachIndex >= 0);
  assert.ok(writeIndex > attachIndex);
  assert.ok(snapshotIndex > writeIndex);
});
