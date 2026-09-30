// A sprint schedule is one standalone row per sprint in the task DB, titled
// "<Sprint tag> 일정" (e.g. "스프린트4 일정"). Its period runs from the worker kickoff
// to the target upload date. It is the sprint's baseline, not a spec or a work item,
// so it is split out before any work rule sees the task list.
import { normalizeSprint } from './sprint-rules.mjs';

const DONE = '완료';
const CANCELLED = '중단';

// planned: not kicked off yet (선행), no committed target date.
// development / testing: open. Testing means every committed spec is done, which in
// this team's workflow means the build has been uploaded and the publisher is testing.
export const OPEN_SCHEDULE_STAGES = new Set(['planned', 'development', 'testing']);
export const CURRENT_SCHEDULE_STAGES = new Set(['development', 'testing']);

export function isSprintScheduleRow(task) {
  return !(task.parentIds || []).length
    && Boolean(task.sprint)
    && String(task.title || '').trim() === `${task.sprint} 일정`;
}

function scheduleStage(row, committedSpecs) {
  if (row.status === DONE) return 'closed';
  if (row.status === CANCELLED) return 'cancelled';
  if (row.status === '시작 전') return 'planned';
  return committedSpecs.length && committedSpecs.every(spec => spec.status === DONE) ? 'testing' : 'development';
}

// Must run before done specs are dropped from collection: the testing stage is read
// from specs that are already complete.
export function splitSprintSchedules(tasks) {
  const rows = [];
  const work = [];
  for (const task of tasks) (isSprintScheduleRow(task) ? rows : work).push(task);
  const schedulesByProject = new Map();
  for (const row of rows) {
    const sprintKey = normalizeSprint(row.sprint);
    const committedSpecs = work.filter(task => task.project === row.project
      && !(task.parentIds || []).length
      && normalizeSprint(task.sprint) === sprintKey
      && task.status !== CANCELLED);
    const schedules = schedulesByProject.get(row.project) || [];
    schedules.push({
      id: row.id,
      url: row.url || null,
      sprint: row.sprint,
      status: row.status || null,
      start: row.start || null,
      due: row.due || null,
      stage: scheduleStage(row, committedSpecs),
      committedSpecs: committedSpecs.length,
      openSpecs: committedSpecs.filter(spec => spec.status !== DONE).length,
    });
    schedulesByProject.set(row.project, schedules);
  }
  return { tasks: work, schedulesByProject };
}
