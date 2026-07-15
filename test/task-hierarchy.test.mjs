import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { buildProjectSpecs, buildWorkload, excludePausedHierarchy, selectProjectTasks } from '../lib/task-hierarchy.mjs';

const tasks = [
  {
    id: 'spec-1',
    title: '마법 가마솥',
    project: '피자레디',
    status: '진행 중',
    team: '기획',
    assignees: ['시안', '웨이드'],
    parentIds: [],
    dependencyReviewStatus: '확정',
    core: true,
  },
  {
    id: 'task-1',
    title: '가마솥 기능 개발',
    project: '피자레디',
    status: '진행 예정',
    team: '개발',
    assignees: ['웨이드', '행크'],
    parentIds: ['spec-1'],
    due: null,
    url: '#task-1',
  },
  {
    id: 'task-2',
    title: '가마솥 리소스 적용',
    project: '피자레디',
    status: '진행 예정',
    team: '아트',
    assignees: [],
    parentIds: ['spec-1'],
    due: '2026-07-31',
    url: '#task-2',
  },
];

test('Given a top-level spec with assignees, When workload is built, Then only child task assignees are counted', () => {
  const result = buildWorkload(tasks, ['완료', '중단']);

  assert.deepEqual(result.workload.map(person => person.name), ['웨이드', '행크']);
  assert.equal(result.workload[0].count, 1);
  assert.equal(result.personalTaskLinks, 2);
  assert.equal(result.unassignedTasks.length, 1);
  assert.equal(result.waitImpactMeasured, false);
  assert.equal(result.workload[0].waitingOnMeCount, null);
});

test('Given child task dependencies, When workload is built, Then people are ordered by downstream waiting impact', () => {
  const dependencyTasks = [
    tasks[0],
    { ...tasks[1], id: 'predecessor', assignees: ['웨이드'], dependencyIds: [] },
    { ...tasks[1], id: 'unrelated', assignees: ['행크'], dependencyIds: [] },
    { ...tasks[2], id: 'downstream', assignees: ['시안'], dependencyIds: ['predecessor'] },
  ];

  const result = buildWorkload(dependencyTasks, ['완료', '중단']);

  assert.equal(result.waitImpactMeasured, true);
  assert.equal(result.workload[0].name, '웨이드');
  assert.equal(result.workload[0].waitingOnMeCount, 1);
  assert.equal(result.workload[0].waitingTasks[0].id, 'downstream');
  assert.equal(result.workload.find(person => person.name === '행크').waitingOnMeCount, 0);
});

test('Given a top-level task and its children, When specs are built, Then hierarchy and completion use all child tasks', () => {
  const specs = buildProjectSpecs(tasks, ['완료', '중단']);

  assert.equal(specs.length, 1);
  assert.equal(specs[0].title, '마법 가마솥');
  assert.equal(specs[0].childStats.total, 2);
  assert.equal(specs[0].childStats.done, 0);
  assert.equal(specs[0].childStats.unassigned, 1);
  assert.equal(specs[0].dependencyReviewStatus, 'confirmed');
});

test('Given a relation-none confirmation, When specs are built, Then it counts as reviewed coverage', () => {
  const specs = buildProjectSpecs([{ ...tasks[0], dependencyReviewStatus: '관계 없음 확인' }], ['완료', '중단']);

  assert.equal(specs[0].dependencyReviewStatus, 'none-confirmed');
});

test('Given collected Notion tasks, When the dashboard base is built, Then hierarchy functions own specs and personal workload', () => {
  const collector = fs.readFileSync(new URL('../collect.mjs', import.meta.url), 'utf8');

  assert.match(collector, /buildProjectSpecs\(pt, DONE_STATUSES\)/);
  assert.match(collector, /buildWorkload\(selectedTasks, DONE_STATUSES\)/);
  assert.match(collector, /hierarchyStats: \{ personalTaskLinks, waitImpactMeasured \}/);
  assert.match(collector, /parentIds: pick\(r, \['상위 항목'/);
  assert.match(collector, /dependencyReviewStatus: pick\(r, \['의존관계 검토'/);
});

test('Given the Notion project list, When collection scope is selected, Then only named projects with summary checked remain', () => {
  const collector = fs.readFileSync(new URL('../collect.mjs', import.meta.url), 'utf8');

  assert.match(collector, /\.filter\(p => p\.name && p\.summarize\)/);
  assert.match(collector, /selectProjectTasks\(tasks, projects\)/);
  assert.match(collector, /excludePausedHierarchy\(\[\.\.\.taskById\.values\(\)\]\)/);
});

test('Given tasks from checked and unchecked projects, When project scope is applied, Then unchecked tasks cannot re-enter cards or workload', () => {
  const scoped = selectProjectTasks([
    { id: 'a', project: '피자 레디' },
    { id: 'b', project: '포지 앤 포춘' },
    { id: 'c', project: '체크 해제 프로젝트' },
  ], [{ name: '피자레디' }, { name: '포지 앤 포춘' }]);

  assert.deepEqual(scoped.map(task => task.id), ['a', 'b']);
});

test('Given paused tasks and a paused parent spec, When collection scope is filtered, Then paused rows and all descendants are excluded', () => {
  const filtered = excludePausedHierarchy([
    { id: 'active-spec', status: '진행 중', parentIds: [] },
    { id: 'active-child', status: '진행 예정', parentIds: ['active-spec'] },
    { id: 'paused-spec', status: '일시 정지', parentIds: [] },
    { id: 'paused-child', status: '진행 예정', parentIds: ['paused-spec'] },
    { id: 'paused-grandchild', status: '진행 중', parentIds: ['paused-child'] },
    { id: 'paused-row', status: '일시정지', parentIds: ['active-spec'] },
  ]);

  assert.deepEqual(filtered.map(task => task.id), ['active-spec', 'active-child']);
});
