import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildAgentInputPacket, writeAgentInputPacket } from '../lib/agent-handoff.mjs';
import { AGENT_INPUT_REMOTE_READABLE_LIMIT } from '../lib/notion-agent-handoff.mjs';

const dashboard = {
  generatedAt: '2026-07-21T01:00:00.000Z',
  metrics: { overdueWorkItems: 1, guideViolationWorkItems: 2 },
  sourceHealth: { status: 'limited', sources: [{ id: 'slack', status: 'partial' }] },
  validationIssues: [{ type: 'OVERDUE', project: '피자레디', workItemId: 'task-1', severity: 'warning', message: '기한 초과' }],
  projects: [{
    name: '피자레디', goal: '출시', stats: { inProgress: 1, overdue: 1 }, notionSummary: null,
    meetings: [{ title: '일정 회의', date: '2026-07-20', url: 'https://notion.so/meeting', content: '익스프레스 기획 범위를 확정한다.', contentChecked: true }],
    specInsights: [{
      specId: 'spec-1', title: '익스프레스', evidence: [
        { source: 'notion', timestamp: '2026-07-20', title: '개발', excerpt: '진행 중', url: 'https://notion.so/task' },
        { source: 'slack', timestamp: '2026-07-20', title: '#s2_pizzaready', excerpt: '기획 범위 확정', url: 'https://slack.com/message' },
        { source: 'meeting', timestamp: '2026-07-20', title: '일정 회의', excerpt: '일정 지연으로 구조와 배치를 먼저 확정한다.', url: 'https://notion.so/meeting', attention: true, attentionType: 'schedule' },
      ],
    }],
    specs: [{
      id: 'spec-1', title: '익스프레스', sprint: 'Sprint60', status: '진행 중',
      childStats: { completionRate: 50 },
      tasks: [{ id: 'task-1', title: '개발', status: '진행 중', overdueDays: 1 }],
    }],
  }],
  workItems: [{ id: 'task-1', project: '피자레디', spec: '익스프레스', sprint: 'Sprint60', title: '개발', status: '진행 중', assignees: ['b'], branch: 'feature/express', due: '2026-07-20', overdueDays: 1, issues: [] }],
  slack: { 피자레디: [{ channel: 's2_pizzaready', messages: [{ time: '2026-07-20T08:00:00Z', user: 'a', text: '기획 확정 필요' }] }] },
  git: { commits: [{ project: '피자레디', hash: 'abc', shortHash: 'abc', committedAt: '2026-07-20T07:00:00Z', author: 'b', message: '익스프레스 개발' }] },
  deltas: [{ project: '피자레디', field: 'task.status', from: '시작 전', to: '진행 중' }],
};

test('Given a rule dashboard, When an agent packet is built, Then deterministic facts and source evidence are separated', () => {
  const packet = buildAgentInputPacket(dashboard);

  assert.equal(packet.schemaVersion, '1.0');
  assert.match(packet.runId, /^2026-07-21-/);
  assert.equal(packet.rules.metrics.overdueWorkItems, 1);
  assert.equal(packet.outputSchema.title, 'Notion Agent Dashboard Analysis');
  assert.ok(packet.outputSchema.required.includes('ruleMetrics'));
  assert.ok(packet.outputSchema.properties.ruleMetrics);
  assert.deepEqual(packet.projects[0].ruleAuditFormat.columns, [
    'itemLevel', 'status', 'sprint', 'sprintRelation', 'missingFieldMask', 'projectInherited', 'issueTypeIndexes',
  ]);
  const auditFormat = packet.projects[0].ruleAuditFormat;
  const auditRow = packet.projects[0].ruleAuditItems[0];
  assert.equal(auditFormat.indexedValues.itemLevel[auditRow[0]], 'child');
  assert.equal(auditFormat.indexedValues.status[auditRow[1]], '진행 중');
  assert.equal(auditFormat.indexedValues.sprint[auditRow[2]], 'Sprint60');
  assert.deepEqual(
    packet.projects[0].ruleAuditItems[0][6].map(index => packet.projects[0].ruleAuditFormat.issueTypes[index]),
    ['OVERDUE'],
  );
  assert.equal('ruleIssues' in packet.projects[0], false);
  assert.equal(packet.projects[0].analysisTargets[0].workItemId, 'task-1');
  assert.equal(packet.projects[0].analysisScope.targetLimit, 3);
  assert.equal(packet.projects[0].analysisTargets[0].branch, 'feature/express');
  assert.equal(packet.projects[0].analysisTargets[0].due, '2026-07-20');
  assert.deepEqual(packet.projects[0].analysisTargets[0].reasons, ['overdue']);
  assert.deepEqual(packet.projects[0].specCatalogFormat.columns, [
    'specId', 'title', 'sprint', 'status', 'activeTaskCount', 'completionRate', 'overdueCount',
  ]);
  assert.deepEqual(packet.projects[0].specCatalog[0], ['spec-1', '익스프레스', 'Sprint60', '진행 중', 1, 50, 1]);
  assert.equal(packet.projects[0].slackScope.channels[0], 's2_pizzaready');
  assert.equal(packet.projects[0].gitEvidence[0].hash, 'abc');
  assert.equal(packet.projects[0].meetingReferences[0].contentChecked, true);
  assert.equal('content' in packet.projects[0].meetingReferences[0], false);
  assert.deepEqual(packet.projects[0].sourceEvidenceFormat.columns, ['specId', 'source', 'timestamp', 'title', 'excerpt', 'url', 'attentionType', 'evidenceRole']);
  assert.equal(packet.projects[0].sourceEvidence[0][0], 'spec-1');
  assert.equal(packet.projects[0].sourceEvidence[0][1], 'meeting');
  assert.match(packet.projects[0].sourceEvidence[0][4], /일정 지연/);
  assert.equal(packet.projects[0].sourceEvidence[0][6], 'schedule');
  assert.equal(packet.projects[0].sourceEvidence[0][7], 'recent_execution');
  assert.ok(packet.projects[0].sourceEvidence.some(row => row[1] === 'slack' && row[4] === '기획 범위 확정'));
});

test('Given matched and unrelated meeting candidates, When an agent packet is built, Then only spec-linked meetings are offered for deeper reading', () => {
  const packet = buildAgentInputPacket({
    ...dashboard,
    projects: [{
      ...dashboard.projects[0],
      meetings: [
        ...dashboard.projects[0].meetings,
        { title: 'AI 자동화 회의', date: '2026-07-20', url: 'https://notion.so/unrelated', contentChecked: true },
      ],
    }],
  });

  assert.deepEqual(packet.projects[0].meetingReferences.map(item => item.url), ['https://notion.so/meeting']);
});

test('Given an output path, When the packet is written, Then a valid JSON handoff file is created', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dashboard-agent-'));
  const file = path.join(directory, 'agent-input.json');

  writeAgentInputPacket(dashboard, file);

  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(saved.projects[0].name, '피자레디');
});

test('Given a sprint-optional project, When an agent packet is built, Then a missing sprint is not encoded as a missing field', () => {
  const sprintOptionalDashboard = {
    ...dashboard,
    projects: [{
      name: 'AI Native',
      config: { sprintRequired: false, currentSprints: [] },
      specs: [{ id: 'ai-spec', title: 'AI 연구', sprint: null, status: '진행 중', childStats: { completionRate: 0 }, tasks: [{ id: 'ai-work', status: '진행 중' }] }],
    }],
    validationIssues: [],
    workItems: [{ id: 'ai-work', project: 'AI Native', spec: 'AI 연구', sprint: null, title: '개념 연구', status: '진행 중', assignees: ['A'], priority: '높음', start: '2026-08-05', due: '2026-08-11', branch: 'feature/ai', sprintRelation: 'not-applicable', issues: [] }],
    git: { commits: [] },
    deltas: [],
  };

  const packet = buildAgentInputPacket(sprintOptionalDashboard);
  const project = packet.projects[0];
  const missingMask = project.ruleAuditItems[0][4];

  assert.equal(project.sprintRequired, false);
  assert.equal(project.specCatalog[0][2], '해당 없음');
  assert.equal(missingMask & project.ruleAuditFormat.missingFieldBits.sprint, 0);
});

test('Given hundreds of repeated guide issues, When an agent packet is built, Then it remains remotely readable without losing audit coverage', () => {
  const workItems = Array.from({ length: 180 }, (_, index) => ({
    id: `task-${index}`,
    project: '포지 앤 포춘',
    title: `작업 ${index}`,
    status: index % 3 === 0 ? '시작 전' : '진행 예정',
    team: '개발',
    assignees: [],
    priority: null,
    start: null,
    due: null,
    sprint: null,
    projectMissing: index % 10 === 0,
    projectInherited: index % 10 === 0,
    projectSource: index % 10 === 0 ? 'parent' : 'property',
    issues: [
      { type: 'MISSING_START_DATE', category: 'guide', severity: 'error', message: '시작일 없음' },
      { type: 'MISSING_DUE_DATE', category: 'guide', severity: 'error', message: '마감일 없음' },
      { type: 'MISSING_ASSIGNEE', category: 'guide', severity: 'error', message: '담당자 없음' },
      ...(index % 10 === 0
        ? [{ type: 'MISSING_PROJECT', category: 'guide', severity: 'check', message: '프로젝트 연결 필요' }]
        : []),
    ],
  }));
  const validationIssues = workItems.flatMap(item => item.issues.map(issue => ({
    ...issue,
    id: `${issue.type}:${item.id}`,
    project: item.project,
    workItemId: item.id,
    recommendedAction: 'Notion에서 입력하세요.',
  })));
  const largeDashboard = {
    generatedAt: '2026-07-30T03:00:00.000Z',
    metrics: { totalWorkItems: 180, guideViolationWorkItems: 180, missingDateWorkItems: 180 },
    projects: [{ name: '포지 앤 포춘', stats: { total: 180 } }],
    workItems,
    validationIssues,
    deltas: [],
  };

  const packet = buildAgentInputPacket(largeDashboard);
  const projectPacket = packet.projects[0];
  const projectBit = projectPacket.ruleAuditFormat.missingFieldBits.project;

  assert.equal(projectPacket.ruleAuditItems.length, 180);
  assert.ok(projectPacket.ruleAuditItems.every(row => row.slice(0, 4).every(Number.isInteger)));
  assert.equal(projectPacket.ruleAuditItems[0][5], 1);
  assert.ok((projectPacket.ruleAuditItems[0][4] & projectBit) !== 0);
  assert.ok(projectPacket.analysisTargets[0].reasons.includes('missing_project'));
  assert.ok(JSON.stringify(packet).length < AGENT_INPUT_REMOTE_READABLE_LIMIT, `원격 입력이 여전히 너무 큽니다: ${JSON.stringify(packet).length}자`);
});

test('Given more linked source excerpts than the remote budget allows, When an agent packet is built, Then evidence is compacted without dropping every linked spec', () => {
  const evidenceDashboard = structuredClone(dashboard);
  evidenceDashboard.projects[0].specInsights = Array.from({ length: 80 }, (_, index) => ({
    specId: `spec-${index}`,
    title: `상위 작업 ${index}`,
    evidence: ['slack', 'meeting', 'git'].map(source => ({
      source,
      timestamp: '2026-07-20T08:00:00Z',
      title: `${source} 근거 ${'제목'.repeat(40)}`,
      excerpt: `직접 연결된 근거 ${'내용'.repeat(120)}`,
      url: `https://example.com/${source}/${index}/${'path'.repeat(20)}`,
    })),
  }));

  const packet = buildAgentInputPacket(evidenceDashboard);

  assert.ok(JSON.stringify(packet).length < AGENT_INPUT_REMOTE_READABLE_LIMIT);
  assert.ok(packet.projects[0].sourceEvidence.length >= 80);
  assert.equal(new Set(packet.projects[0].sourceEvidence.map(row => row[0])).size, 80);
});

test('Given parent and child rule items, When an agent packet is built, Then item level preserves their different validation contracts', () => {
  const ruleItems = [
    {
      id: 'spec',
      itemLevel: 'parent',
      specId: 'spec',
      project: '피자레디',
      title: '상위 작업',
      status: '진행 중',
      sprint: 'Sprint60',
      assignees: ['PD'],
      issues: [{ type: 'MISSING_DESCRIPTION', category: 'guide', severity: 'error' }],
    },
    {
      id: 'work',
      itemLevel: 'child',
      specId: 'spec',
      spec: '상위 작업',
      project: '피자레디',
      title: '하위 작업',
      status: '시작 전',
      sprint: 'Sprint60',
      issues: [],
    },
  ];
  const packet = buildAgentInputPacket({
    generatedAt: '2026-07-30T03:00:00.000Z',
    metrics: { totalWorkItems: 2 },
    projects: [{ name: '피자레디', stats: { total: 1 } }],
    workItems: [ruleItems[1]],
    ruleItems,
    validationIssues: [{
      type: 'MISSING_DESCRIPTION',
      category: 'guide',
      severity: 'error',
      project: '피자레디',
      specId: 'spec',
      workItemId: null,
    }],
    deltas: [],
  });

  const { indexedValues } = packet.projects[0].ruleAuditFormat;
  assert.deepEqual(packet.projects[0].ruleAuditItems.map(row => indexedValues.itemLevel[row[0]]), ['parent', 'child']);
  assert.equal(packet.projects[0].analysisTargets[0].itemLevel, 'parent');
  assert.equal(packet.projects[0].analysisTargets[0].workItemId, null);
});
