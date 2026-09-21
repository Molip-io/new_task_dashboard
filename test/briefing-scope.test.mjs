import assert from 'node:assert/strict';
import test from 'node:test';
import { scopeBriefing, sprintOptions } from '../public/briefing-scope.js';
import { briefingDetailItems } from '../public/dashboard-management.js';

const child = { id: 'child', project: 'A', sprint: 'sprint3.5', team: '개발', assignees: ['가'], status: '진행 중', overdueDays: 2 };
const parent = { id: 'parent', project: 'A', sprint: '스프린트3.5', team: '기획', assignees: ['나'], status: '시작 전', overdueDays: 3 };
const fixture = { projects: [{ name: 'A', stats: {} }, { name: 'B', stats: {} }], workItems: [child, { ...child, id: 'creative', project: 'B', sprint: '크리에이티브' }], guideViolationItems: [child, parent], progressSetupItems: [parent] };

test('sprint options deduplicate aliases and preserve decimal and named sprints', () => {
  assert.deepEqual(sprintOptions(fixture).map(item => item.key).sort(), ['sprint3.5', '크리에이티브'].sort());
});
test('selected sprint preserves overlapping queues and parent guide and setup items', () => {
  const scoped = scopeBriefing(fixture, { sprints: ['스프린트3.5'] });
  for (const [key, metric] of Object.entries({ 'work-items': 'inProgressWorkItems', overdue: 'overdueWorkItems', guide: 'guideViolationWorkItems', setup: 'progressSetupRequiredItems', projects: 'activeProjects' })) {
    assert.equal(scoped.metrics[metric], briefingDetailItems(scoped, key).length);
  }
  assert.equal(scoped.metrics.inProgressWorkItems, 1);
  assert.equal(scoped.metrics.overdueWorkItems, 1);
  assert.equal(scoped.metrics.guideViolationWorkItems, 2);
  assert.equal(scoped.metrics.progressSetupRequiredItems, 1);
  assert.equal(briefingDetailItems(scoped, 'setup')[0].id, 'parent');
});
test('multiple sprints and team/project/assignee compose without mutating source data', () => {
  const before = JSON.stringify(fixture);
  assert.equal(scopeBriefing(fixture).metrics.inProgressWorkItems, 2);
  const scoped = scopeBriefing(fixture, { sprints: ['3.5', '크리에이티브'], project: 'A', team: '기획', assignee: '나' });
  assert.equal(scoped.metrics.guideViolationWorkItems, 1);
  assert.equal(scoped.metrics.progressSetupRequiredItems, 1);
  assert.equal(scoped.metrics.inProgressWorkItems, 0);
  assert.equal(JSON.stringify(fixture), before);
});
