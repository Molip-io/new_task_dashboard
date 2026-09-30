import assert from 'node:assert/strict';
import test from 'node:test';
import { isSprintScheduleRow, splitSprintSchedules } from '../shared/rules/sprint-schedule.mjs';

const row = (sprint, status, extra = {}) => ({ id: `${sprint}-schedule`, title: `${sprint} 일정`, project: '포지 앤 포춘', parentIds: [], sprint, status, ...extra });
const spec = (id, sprint, status) => ({ id, title: id, project: '포지 앤 포춘', parentIds: [], sprint, status });

test('Given a standalone "<Sprint> 일정" row, When rows are checked, Then only the exact title without a parent is a schedule', () => {
  assert.equal(isSprintScheduleRow(row('스프린트4', '진행 중')), true);
  assert.equal(isSprintScheduleRow({ ...row('스프린트4', '진행 중'), title: '스프린트4 일정(테스트 중)' }), false);
  assert.equal(isSprintScheduleRow({ ...row('스프린트4', '진행 중'), parentIds: ['spec'] }), false);
  assert.equal(isSprintScheduleRow({ ...row('스프린트4', '진행 중'), sprint: null }), false);
});

test('Given schedule rows among tasks, When they are split, Then work tasks exclude them and each schedule gets its stage', () => {
  const tasks = [
    row('스프린트3', '진행 중'), spec('sp3-a', 'Sprint 3', '완료'), spec('sp3-b', '스프린트3', '중단'),
    row('스프린트4', '진행 중', { start: '2026-09-07', due: '2026-10-15' }), spec('sp4-a', '스프린트4', '완료'), spec('sp4-b', '스프린트4', '진행 중'),
    row('스프린트5', '시작 전'), row('스프린트2', '완료'), row('스프린트6', '진행 중'),
  ];

  const { tasks: work, schedulesByProject } = splitSprintSchedules(tasks);

  assert.deepEqual(work.map(task => task.id), ['sp3-a', 'sp3-b', 'sp4-a', 'sp4-b']);
  const stages = Object.fromEntries(schedulesByProject.get('포지 앤 포춘').map(schedule => [schedule.sprint, schedule.stage]));
  assert.deepEqual(stages, { 스프린트3: 'testing', 스프린트4: 'development', 스프린트5: 'planned', 스프린트2: 'closed', 스프린트6: 'development' });
  const sp4 = schedulesByProject.get('포지 앤 포춘').find(schedule => schedule.sprint === '스프린트4');
  assert.deepEqual([sp4.start, sp4.due, sp4.committedSpecs, sp4.openSpecs], ['2026-09-07', '2026-10-15', 2, 1]);
});
