import assert from 'node:assert/strict';
import test from 'node:test';
import { buildProjectSpecs } from '../lib/task-hierarchy.mjs';
import { buildProjectOperations } from '../lib/project-operations.mjs';
import { enrichParentChildCompletion } from '../lib/project-state-enrichment.mjs';
import { enrichAgentPacketWithProjectOperations } from '../lib/agent-project-operations.mjs';
import { buildAgentInputPacket } from '../lib/agent-handoff.mjs';
import { compactDashboard } from '../lib/dashboard-snapshot.mjs';
import { filterSpecsWithWorkItems } from '../public/dashboard-view-model.js';
import { briefingHtml } from '../public/dashboard-presenters.js';

const parent = { id: 'spec', title: 'SP3 업로드 빌드', project: '포지 앤 포춘', parentIds: [], status: '진행 중', sprint: 'Sprint3' };
const children = [
  { id: 'a', title: 'AOS', project: '포지 앤 포춘', parentIds: ['spec'], status: '완료', sprint: 'Sprint3', completedAt: '2026-09-07' },
  { id: 'b', title: 'iOS', project: '포지 앤 포춘', parentIds: ['spec'], status: '완료', sprint: 'Sprint3', completedAt: '2026-09-07' },
];

function operations() {
  return buildProjectOperations([{ channel: 's2_forge_and_fortune', messages: [
    { time: '2026-09-07T09:00:00+09:00', text: 'Sprint3 업로드빌드 완료했습니다. AOS 3.5.0, iOS 3.5.0 마켓 업로드 완료', url: 'https://slack/build' },
    { time: '2026-09-07T10:00:00+09:00', text: '업로드 빌드 QA 이후 CPI 테스트 진행하도록 하겠습니다.', url: 'https://slack/qa' },
    { time: '2026-09-07T11:00:00+09:00', text: 'AOS 3.5.0 99.9% 릴리즈, iOS 3.5.0 자동출시 진행', url: 'https://slack/release' },
    { time: '2026-09-07T12:00:00+09:00', text: 'SP2 데이터 분석 및 퍼널 확인 결과를 기반으로 밸런싱 진행', url: 'https://slack/data' },
    { time: '2026-09-07T13:00:00+09:00', text: '점심 메뉴 공유', url: 'https://slack/chat' },
  ] }]);
}

test('active parent remains visible when every registered child is complete', () => {
  const [spec] = buildProjectSpecs([parent, ...children], ['완료', '중단', '일시 정지', '정지']);
  assert.equal(spec.status, '진행 중');
  assert.equal(spec.childDerivedStatus, '완료');
  assert.equal(spec.childStats.completionRate, 100);
  assert.equal(spec.completionMismatch, true);
  assert.deepEqual(filterSpecsWithWorkItems([spec]).map(item => item.id), ['spec']);
});

test('parent-child completion mismatch becomes a management check without inventing more work', () => {
  const validation = { issues: [], ruleItems: [{ ...parent, itemLevel: 'parent', issues: [], riskScore: 0, guideStatus: 'normal' }] };
  enrichParentChildCompletion(validation, [parent, ...children], '2026-09-08T00:00:00Z');
  const issue = validation.issues[0];
  assert.equal(issue.type, 'PARENT_CHILD_STATUS_MISMATCH');
  assert.equal(issue.severity, 'check');
  assert.match(issue.recommendedAction, /완료 처리|추가 하위 작업항목/);
  assert.equal(validation.ruleItems[0].issues[0].type, 'PARENT_CHILD_STATUS_MISMATCH');
});

test('project operation evidence tracks build QA release and data separately', () => {
  const result = operations();
  assert.ok(result.latestBuild);
  assert.ok(result.latestQa);
  assert.equal(result.latestRelease.url, 'https://slack/release');
  assert.equal(result.latestData.url, 'https://slack/data');
  assert.equal(result.events.some(event => event.url === 'https://slack/chat'), false);
  assert.ok(result.evidence.every(item => item.evidenceRole === 'project_operation'));
});

test('agent and remote snapshot retain active specs plus project-wide lifecycle evidence', () => {
  const [spec] = buildProjectSpecs([parent, ...children], ['완료', '중단', '일시 정지', '정지']);
  const ops = operations();
  const ruleParent = { ...parent, itemLevel: 'parent', sprintRelation: 'current', assignees: ['PD'], issues: [{ type: 'PARENT_CHILD_STATUS_MISMATCH', category: 'guide', severity: 'check' }] };
  const dashboard = {
    generatedAt: '2026-09-08T00:00:00Z', metrics: {}, deltas: [], validationIssues: [], workItems: [], ruleItems: [ruleParent],
    sourceHealth: { status: 'ok', sources: [] }, git: { repositories: [], commits: [], errors: [] },
    projects: [{ name: '포지 앤 포춘', currentSprints: ['Sprint3'], sprintRequired: true, config: { currentSprints: ['Sprint3'], sprintRequired: true }, specs: [spec], stats: {}, projectOperations: ops }],
  };
  const packet = enrichAgentPacketWithProjectOperations(buildAgentInputPacket(dashboard), dashboard);
  assert.deepEqual(packet.projects[0].specCatalog[0], ['spec', 'SP3 업로드 빌드', 'Sprint3', '진행 중', 0, 100, 0]);
  assert.ok(packet.projects[0].sourceEvidence.some(row => row[0] === null && row[7] === 'project_operation'));
  const compact = compactDashboard(dashboard);
  assert.equal(compact.projects[0].specs[0].completionMismatch, true);
  assert.equal(compact.projects[0].projectOperations.latestRelease.url, 'https://slack/release');
});

test('briefing exposes project lifecycle even when Agent analysis has not run', () => {
  const ops = operations();
  const dashboard = {
    metrics: {}, validationIssues: [], deltas: [], workItems: [], git: { repositories: [] },
    ai: { analysisStatus: 'not_run', overall: {} },
    projects: [{ name: '포지 앤 포춘', currentSprints: ['Sprint3'], sprintRequired: true, specs: [], stats: {}, projectOperations: ops }],
  };
  const html = briefingHtml(dashboard, null, () => '');
  assert.match(html, /프로젝트 운영 현황/);
  assert.match(html, /<strong>빌드<\/strong>/);
  assert.match(html, /QA 이후 CPI 테스트/);
  assert.match(html, /99\.9% 릴리즈/);
  assert.match(html, /데이터 분석/);
});
