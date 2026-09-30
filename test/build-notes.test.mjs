import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSprintKey, buildSummary, parseBuildNote, recentBuilds } from '../shared/rules/build-notes.mjs';
import { applyBuildUploads } from '../shared/rules/sprint-schedule.mjs';

const projects = new Map([['forge-page', '포지 앤 포춘'], ['pizza-page', '피자레디']]);
const row = (title, upload, qa = null, project = 'forge-page') => ({ _id: title, _url: null, 이름: title, '업로드 날짜': upload ? { start: upload, end: null } : null, 'QA 기간': qa, '🎮 프로젝트': [project] });

test('Given build-note titles, When they are parsed, Then sprint, build type, project and QA days are read', () => {
  const notes = [
    row('3.5.0(Sprint3)', '2026-09-04'),
    row('3.6.0(Sprint3.5)(Sprint3 Hotfix)', '2026-09-23'),
    row('3.7.0(Sprint1)(3.6.0과 동기비교테스트를 위한)', '2026-09-23'),
    row('Sprint 60', '2026-09-09', { start: '2026-08-20', end: '2026-08-31' }, 'pizza-page'),
    row('Sprint 59 M1 핫픽스', '2026-08-11', { start: '2026-08-11', end: null }, 'pizza-page'),
  ].map(note => parseBuildNote(note, projects));

  assert.deepEqual(notes.map(note => [note.sprintKey, note.type, note.project, note.qaDays]), [
    ['sprint3', 'regular', '포지 앤 포춘', null],
    ['sprint3.5', 'hotfix', '포지 앤 포춘', null],
    ['sprint1', 'rebuild', '포지 앤 포춘', null],
    ['sprint60', 'regular', '피자레디', 12],
    ['sprint59', 'hotfix', '피자레디', 1],
  ]);
  assert.deepEqual([buildSprintKey('스프린트3.5'), buildSprintKey('Sprint 04'), buildSprintKey('Alpha')], ['sprint3.5', 'sprint4', null]);

  const recent = recentBuilds(notes, '피자레디', '2026-09-30');
  const summary = buildSummary(recent);
  assert.deepEqual([summary.total, summary.offCycle, summary.offCyclePercent, summary.qaRecorded, summary.averageQaDays], [2, 1, 50, 2, 6.5]);
  assert.deepEqual(recent.map(build => build.title), ['Sprint 60', 'Sprint 59 M1 핫픽스']);
});

test('Given build uploads, When they are applied to schedules, Then an upload marks publisher testing and a done sprint without one stays before upload', () => {
  const builds = [{ sprintKey: 'sprint3', uploadedAt: '2026-09-04' }, { sprintKey: 'sprint3.5', uploadedAt: '2026-09-23' }];
  const schedules = applyBuildUploads([
    { sprint: '스프린트3', stage: 'development' },
    { sprint: '스프린트3.5', stage: 'testing' },
    { sprint: '스프린트4', stage: 'testing' },
    { sprint: '스프린트5', stage: 'development' },
    { sprint: '스프린트2', stage: 'closed' },
  ], builds);

  assert.deepEqual(schedules.map(schedule => [schedule.stage, schedule.testingPhase || null, schedule.buildUploadedAt]), [
    ['testing', 'publisher-test', '2026-09-04'],
    ['testing', 'publisher-test', '2026-09-23'],
    ['testing', 'pre-upload', null],
    ['development', null, null],
    ['closed', null, null],
  ]);
});
