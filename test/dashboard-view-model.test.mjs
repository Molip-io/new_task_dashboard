import assert from 'node:assert/strict';
import test from 'node:test';
import { filterWorkItems, groupIssuesByProject, sortPeople, sortProjects, sortWorkItems } from '../public/dashboard-view-model.js';

const workItems = [
  { id: 'a', title: 'A', project: '피자레디', team: '개발', sprint: 'S1', status: '진행 중', due: '2026-07-20', riskScore: 10, issues: [{ type: 'OVERDUE' }] },
  { id: 'b', title: 'B', project: '포지', team: '아트', sprint: 'S2', status: '완료', due: '2026-07-10', riskScore: 1, issues: [] },
];

test('Given shared dashboard filters, When work items are filtered, Then status, team, project, sprint, and issue filters compose', () => {
  const result = filterWorkItems(workItems, { status: '진행 중', team: '개발', project: '피자레디', sprint: 'S1', issueType: 'OVERDUE', includeCompleted: false });

  assert.deepEqual(result.map(item => item.id), ['a']);
});

test('Given work items, When risk sorting is selected, Then highest management risk appears first', () => {
  assert.deepEqual(sortWorkItems(workItems, 'risk').map(item => item.id), ['a', 'b']);
});

test('Given project summaries, When default sorting runs, Then checks and overdue counts outrank names', () => {
  const projects = [
    { name: '가', stats: { issueCount: 0, overdue: 0, stale: 0 }, nearestDue: '2026-07-20' },
    { name: '나', stats: { issueCount: 2, overdue: 0, stale: 0 }, nearestDue: '2026-07-30' },
  ];

  assert.deepEqual(sortProjects(projects).map(project => project.name), ['나', '가']);
});

test('Given people summaries, When default sorting runs, Then overdue, stale, active, and name are applied in order', () => {
  const people = [
    { name: 'A', overdueCount: 0, staleCount: 1, inProgressCount: 5 },
    { name: 'B', overdueCount: 1, staleCount: 0, inProgressCount: 1 },
  ];

  assert.deepEqual(sortPeople(people, 'default').map(person => person.name), ['B', 'A']);
});

test('Given validation issues, When grouped, Then unclassified projects are listed first and issues nest by type', () => {
  const groups = groupIssuesByProject([
    { type: 'OVERDUE', project: '피자레디', severity: 'warning' },
    { type: 'MISSING_PROJECT', project: null, severity: 'error' },
  ]);

  assert.equal(groups[0].project, '프로젝트 미분류');
  assert.equal(groups[1].types[0].type, 'OVERDUE');
});
