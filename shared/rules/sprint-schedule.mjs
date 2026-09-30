// A sprint schedule is one standalone row per sprint in the task DB, titled
// "<Sprint tag> 일정" (e.g. "스프린트4 일정"). Its period runs from the worker kickoff
// to the target upload date. It is the sprint's baseline, not a spec or a work item,
// so it is split out before any work rule sees the task list.
import { normalizeSprint } from './sprint-rules.mjs';
import { buildSprintKey } from './build-notes.mjs';

const DONE = '완료';
const CANCELLED = '중단';

// planned: not kicked off yet (선행), no committed target date.
// development / testing: open. Testing means every committed spec is done: the team
// then runs internal QA, uploads the build and the publisher tests it. QA is not
// ticketed, so spec completion can lead the upload by several days.
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

const dayNumber = value => {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ''));
  return match ? Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / 86_400_000 : null;
};

// Where an open schedule stands against its own baseline on a given day (Asia/Seoul
// date). Planned and closed schedules have no committed target to compare against.
export function scheduleProgress(schedule, today) {
  if (!CURRENT_SCHEDULE_STAGES.has(schedule.stage)) return null;
  const now = dayNumber(today);
  const start = dayNumber(schedule.start);
  const due = dayNumber(schedule.due);
  const committed = schedule.committedSpecs || 0;
  const daysToTarget = due === null || now === null ? null : due - now;
  return {
    daysToTarget,
    overdueDays: schedule.stage === 'development' && daysToTarget !== null && daysToTarget < 0 ? -daysToTarget : 0,
    elapsedPercent: start === null || due === null || now === null || due <= start
      ? null
      : Math.max(0, Math.min(100, Math.round(((now - start) / (due - start)) * 100))),
    specDonePercent: committed ? Math.round(((committed - (schedule.openSpecs || 0)) / committed) * 100) : null,
    // Specs moved out of this sprint unfinished, against everything the sprint ever held.
    carryOverPercent: committed + (schedule.carriedOver || 0) + (schedule.deferredDone || 0)
      ? Math.round(((schedule.carriedOver || 0) / (committed + (schedule.carriedOver || 0) + (schedule.deferredDone || 0))) * 100)
      : null,
  };
}

// The build note's upload date is the real edge between internal QA and the publisher's
// test. An uploaded build for the sprint puts an open schedule in testing even if some
// spec status lags; a done sprint with no upload yet is still before the upload.
export function applyBuildUploads(schedules, builds) {
  return schedules.map(schedule => {
    const key = buildSprintKey(schedule.sprint);
    const buildUploadedAt = builds.filter(build => key && build.sprintKey === key && build.uploadedAt)
      .map(build => build.uploadedAt).sort()[0] || null;
    if (!CURRENT_SCHEDULE_STAGES.has(schedule.stage)) return { ...schedule, buildUploadedAt };
    if (buildUploadedAt) return { ...schedule, stage: 'testing', testingPhase: 'publisher-test', buildUploadedAt };
    return { ...schedule, buildUploadedAt, ...(schedule.stage === 'testing' ? { testingPhase: 'pre-upload' } : {}) };
  });
}
