import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildAgentInputPacket, writeAgentInputPacket } from '../lib/agent-handoff.mjs';

const dashboard = {
  generatedAt: '2026-07-21T01:00:00.000Z',
  metrics: { overdueWorkItems: 1, guideViolationWorkItems: 2 },
  sourceHealth: { status: 'limited', sources: [{ id: 'slack', status: 'partial' }] },
  validationIssues: [{ type: 'OVERDUE', project: '피자레디', workItemId: 'task-1', severity: 'warning', message: '기한 초과' }],
  projects: [{ name: '피자레디', goal: '출시', stats: { inProgress: 1, overdue: 1 }, notionSummary: null, meetings: [{ title: '일정 회의', date: '2026-07-20', url: 'https://notion.so/meeting' }] }],
  workItems: [{ id: 'task-1', project: '피자레디', spec: '익스프레스', sprint: 'Sprint60', title: '개발', status: '진행 중', assignees: ['b'], due: '2026-07-20', overdueDays: 1, issues: [] }],
  slack: { 피자레디: [{ channel: 's2_pizzaready', messages: [{ time: '2026-07-20T08:00:00Z', user: 'a', text: '기획 확정 필요' }] }] },
  git: { commits: [{ project: '피자레디', hash: 'abc', shortHash: 'abc', committedAt: '2026-07-20T07:00:00Z', author: 'b', message: '익스프레스 개발' }] },
  deltas: [{ project: '피자레디', field: 'task.status', from: '시작 전', to: '진행 중' }],
};

test('Given a rule dashboard, When an agent packet is built, Then deterministic facts and source evidence are separated', () => {
  const packet = buildAgentInputPacket(dashboard);

  assert.equal(packet.schemaVersion, '1.0');
  assert.match(packet.runId, /^2026-07-21-/);
  assert.equal(packet.rules.metrics.overdueWorkItems, 1);
  assert.equal(packet.projects[0].analysisTargets[0].workItemId, 'task-1');
  assert.equal(packet.projects[0].analysisTargets[0].overdueDays, 1);
  assert.deepEqual(packet.projects[0].analysisTargets[0].reasons, ['overdue']);
  assert.equal(packet.projects[0].slackScope.channels[0], 's2_pizzaready');
  assert.equal(packet.projects[0].gitEvidence[0].hash, 'abc');
});

test('Given an output path, When the packet is written, Then a valid JSON handoff file is created', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dashboard-agent-'));
  const file = path.join(directory, 'agent-input.json');

  writeAgentInputPacket(dashboard, file);

  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(saved.projects[0].name, '피자레디');
});
