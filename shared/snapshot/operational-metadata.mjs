import fs from 'node:fs';
import path from 'node:path';
import { CURRENT_SCHEDULE_STAGES } from '../rules/sprint-schedule.mjs';
import { normalizeSprint } from '../rules/sprint-rules.mjs';

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

function kstDay(isoDate) {
  return new Date(new Date(isoDate).getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function sourceStatus(successful, expected, hasError) {
  if (successful === 0 && expected > 0) return 'unavailable';
  if (hasError || successful < expected) return 'partial';
  return 'ok';
}

export function buildSourceHealth(dashboard) {
  const errors = dashboard.errors || [];
  const expectedChannels = unique(dashboard.projects.flatMap(project => project.config?.channels || []));
  const collectedChannels = unique(dashboard.projects.flatMap(project => (project.slack || []).map(channel => channel.channel)));
  const notionErrors = errors.some(error => /Notion|작업DB|업무현황 요약 DB/.test(error));
  const meetingDatabaseErrors = errors.some(error => /회의록DB/.test(error));
  const meetingBodyErrors = errors.some(error => /회의록\s*본문/.test(error))
    || (dashboard.meetings || []).some(meeting => meeting.contentChecked === false);
  const meetingErrors = meetingDatabaseErrors || meetingBodyErrors;
  const meetingCollectionSucceeded = !meetingDatabaseErrors || (dashboard.meetings || []).length > 0;
  const slackErrors = errors.some(error => /Slack|SLACK_TOKEN|^#/.test(error));
  const projectCount = dashboard.projects.length;
  const meetingDates = (dashboard.meetings || []).map(meeting => meeting.date).filter(Boolean).sort();
  const agentStatus = dashboard.ai?.analysisStatus || (dashboard.ai?.overall ? 'success' : 'not_run');
  const agentSourceStatus = agentStatus === 'success' ? 'ok'
    : ['partial', 'legacy', 'stale'].includes(agentStatus) ? 'partial'
      : 'unavailable';

  return {
    status: notionErrors || meetingErrors || slackErrors || collectedChannels.length < expectedChannels.length || agentSourceStatus !== 'ok' ? 'limited' : 'complete',
    sources: [
      {
        id: 'notion',
        status: sourceStatus(projectCount > 0 ? 1 : 0, 1, notionErrors),
        successful: projectCount > 0 ? 1 : 0,
        expected: 1,
        lastSuccessAt: projectCount > 0 ? dashboard.generatedAt : null,
      },
      {
        id: 'slack',
        status: sourceStatus(collectedChannels.length, expectedChannels.length, slackErrors),
        successful: collectedChannels.length,
        expected: expectedChannels.length,
        lastSuccessAt: collectedChannels.length > 0 ? dashboard.generatedAt : null,
      },
      {
        id: 'meetings',
        status: sourceStatus(meetingCollectionSucceeded ? 1 : 0, 1, meetingErrors),
        successful: meetingCollectionSucceeded ? 1 : 0,
        expected: 1,
        lastSuccessAt: meetingErrors ? null : dashboard.generatedAt,
        bodyReadIncomplete: meetingBodyErrors,
        lastEvidenceAt: meetingDates.at(-1) || null,
      },
      {
        id: 'agent-analysis',
        status: agentSourceStatus,
        successful: agentSourceStatus === 'unavailable' ? 0 : 1,
        expected: 1,
        lastSuccessAt: dashboard.ai?.generatedAt || null,
        analysisStatus: agentStatus,
        comparisonStatus: dashboard.ai?.sourceComparison?.status || 'not_run',
      },
    ],
  };
}

export function comparableSnapshot(dashboard) {
  return {
    generatedAt: dashboard.generatedAt,
    projects: dashboard.projects.map(project => ({
      name: project.name,
      status: project.aiStatus || project.notionSummary?.status || null,
      completionRate: project.stats.total > 0 ? Math.round((project.stats.done / project.stats.total) * 100) : 0,
      tasks: [...new Map((project.specs?.length
        ? project.specs.flatMap(spec => spec.tasks || [])
        : project.activeTasks || []).map(task => [task.id || task.title, task])).values()].map(task => ({
        id: task.id || task.title,
        title: task.title,
        status: task.status || null,
        due: task.due || null,
        assignees: [...(task.assignees || [])].sort(),
        statusSince: task.statusSince || null,
      })).sort((left, right) => left.id.localeCompare(right.id)),
      // The sprint baseline: which sprint each spec belongs to, and each schedule row's
      // period and stage. A change here is a re-plan, not progress.
      specs: (project.specs || []).map(spec => ({ id: spec.id, title: spec.title, sprint: spec.sprint || null, status: spec.status || null, statusSince: spec.statusSince || null }))
        .sort((left, right) => String(left.id).localeCompare(String(right.id))),
      schedules: (project.config?.sprintSchedules || []).map(schedule => ({ sprint: schedule.sprint, start: schedule.start || null, due: schedule.due || null, stage: schedule.stage, dueChanges: schedule.dueChanges || 0, replans: schedule.replans || 0, carriedOver: schedule.carriedOver || 0, deferredDone: schedule.deferredDone || 0 }))
        .sort((left, right) => String(left.sprint).localeCompare(String(right.sprint))),
    })).sort((left, right) => left.name.localeCompare(right.name)),
  };
}

function addDelta(deltas, project, field, from, to, task = null, observedAt = null) {
  if (JSON.stringify(from) === JSON.stringify(to)) return;
  deltas.push({
    // First moment a snapshot showed the item as done. It is when we noticed, not
    // when the work finished, so it must never be copied into a completion date.
    ...(field === 'task.status' && to === '완료' && observedAt ? { observedCompleteAt: observedAt } : {}),
    id: `${project}:${task?.id || 'project'}:${field}`,
    project,
    taskId: task?.id || null,
    taskTitle: task?.title || null,
    field,
    from,
    to,
  });
}

export function diffSnapshots(previous, current) {
  const deltas = [];
  const previousProjects = new Map(previous.projects.map(project => [project.name, project]));
  for (const project of current.projects) {
    const before = previousProjects.get(project.name);
    if (!before) continue;
    addDelta(deltas, project.name, 'project.status', before.status, project.status);
    addDelta(deltas, project.name, 'project.completionRate', before.completionRate, project.completionRate);
    const previousTasks = new Map(before.tasks.map(task => [task.id, task]));
    for (const task of project.tasks) {
      const priorTask = previousTasks.get(task.id);
      if (!priorTask) continue;
      addDelta(deltas, project.name, 'task.status', priorTask.status, task.status, task, current.generatedAt);
      addDelta(deltas, project.name, 'task.due', priorTask.due, task.due, task);
      addDelta(deltas, project.name, 'task.assignees', priorTask.assignees, task.assignees, task);
    }
    // Older snapshots carry no baseline; compare it only when both sides have one.
    if (Array.isArray(before.specs) && Array.isArray(project.specs)) {
      const previousSpecs = new Map(before.specs.map(spec => [spec.id, spec]));
      for (const spec of project.specs) {
        const priorSpec = previousSpecs.get(spec.id);
        if (priorSpec) addDelta(deltas, project.name, 'spec.sprint', priorSpec.sprint, spec.sprint, spec);
      }
    }
    if (Array.isArray(before.schedules) && Array.isArray(project.schedules)) {
      const previousSchedules = new Map(before.schedules.map(schedule => [schedule.sprint, schedule]));
      for (const schedule of project.schedules) {
        const prior = previousSchedules.get(schedule.sprint);
        if (!prior) continue;
        const row = { id: `schedule:${schedule.sprint}`, title: `${schedule.sprint} 일정` };
        addDelta(deltas, project.name, 'schedule.due', prior.due, schedule.due, row);
        addDelta(deltas, project.name, 'schedule.stage', prior.stage, schedule.stage, row);
      }
    }
  }
  return deltas;
}

// Notion has no status-change time and snapshots only compare two days, so running
// history is carried forward in the snapshot itself: how long each item has held its
// current status, and how often each open schedule was re-planned. With no earlier
// snapshot, observation starts today.
export function carryBaselineHistory(dashboard, previous, deltas) {
  const today = kstDay(dashboard.generatedAt);
  const previousDay = previous ? kstDay(previous.generatedAt) : null;
  const priorItems = new Map((previous?.projects || []).flatMap(project => [...(project.tasks || []), ...(project.specs || [])]
    .map(item => [`${project.name}:${item.id}`, item])));
  const since = new Map();
  for (const project of dashboard.projects || []) {
    const items = [...(project.specs || []), ...(project.specs || []).flatMap(spec => spec.tasks || []), ...(project.activeTasks || [])];
    for (const item of items) {
      const prior = priorItems.get(`${project.name}:${item.id}`);
      since.set(item.id, prior && prior.status === item.status ? (prior.statusSince || previousDay) : today);
    }
    const priorSchedules = new Map(((previous?.projects || []).find(entry => entry.name === project.name)?.schedules || []).map(schedule => [schedule.sprint, schedule]));
    const projectDeltas = deltas.filter(delta => delta.project === project.name);
    const specStatus = new Map((project.specs || []).map(spec => [spec.id, spec.status]));
    for (const schedule of project.config?.sprintSchedules || []) {
      const prior = priorSchedules.get(schedule.sprint);
      const key = normalizeSprint(schedule.sprint);
      const current = CURRENT_SCHEDULE_STAGES.has(schedule.stage);
      schedule.dueChanges = (prior?.dueChanges || 0) + projectDeltas.filter(delta => delta.field === 'schedule.due' && delta.taskId === `schedule:${schedule.sprint}`).length;
      schedule.replans = (prior?.replans || 0) + (current ? projectDeltas.filter(delta => delta.field === 'spec.sprint'
        && (normalizeSprint(delta.from) === key || normalizeSprint(delta.to) === key)).length : 0);
      // Moved out of this sprint: unfinished work is a carry-over, finished work held
      // back for a later build is a deferral, which is not a delay.
      const movedOut = current ? projectDeltas.filter(delta => delta.field === 'spec.sprint' && normalizeSprint(delta.from) === key) : [];
      schedule.carriedOver = (prior?.carriedOver || 0) + movedOut.filter(delta => specStatus.get(delta.taskId) !== '완료').length;
      schedule.deferredDone = (prior?.deferredDone || 0) + movedOut.filter(delta => specStatus.get(delta.taskId) === '완료').length;
    }
  }
  for (const item of [...(dashboard.workItems || []), ...(dashboard.ruleItems || []), ...(dashboard.projects || []).flatMap(project => [...(project.specs || []), ...(project.specs || []).flatMap(spec => spec.tasks || []), ...(project.activeTasks || [])])]) {
    if (since.has(item.id)) item.statusSince = since.get(item.id);
  }
  return dashboard;
}

export function loadPreviousSnapshot(dataDirectory, currentDay) {
  const snapshotDirectory = path.join(dataDirectory, 'snapshots');
  if (!fs.existsSync(snapshotDirectory)) return null;
  const previousFile = fs.readdirSync(snapshotDirectory)
    .filter(file => /^\d{4}-\d{2}-\d{2}\.json$/.test(file) && file.slice(0, 10) < currentDay)
    .sort()
    .at(-1);
  if (!previousFile) return null;
  return JSON.parse(fs.readFileSync(path.join(snapshotDirectory, previousFile), 'utf8'));
}

export function attachOperationalMetadata(dashboard, dataDirectory, suppliedPrevious = undefined) {
  const current = comparableSnapshot(dashboard);
  const previous = suppliedPrevious === undefined
    ? loadPreviousSnapshot(dataDirectory, kstDay(dashboard.generatedAt))
    : suppliedPrevious;
  const deltas = previous ? diffSnapshots(previous, current) : [];
  carryBaselineHistory(dashboard, previous, deltas);
  return {
    ...dashboard,
    sourceHealth: buildSourceHealth(dashboard),
    snapshotComparison: previous ? {
      available: true,
      previousGeneratedAt: previous.generatedAt,
      currentGeneratedAt: current.generatedAt,
      reason: null,
    } : {
      available: false,
      previousGeneratedAt: null,
      currentGeneratedAt: current.generatedAt,
      reason: '전일 스냅샷이 없어 변화 비교를 생성하지 않았습니다.',
    },
    deltas,
  };
}

export function saveDailySnapshot(dashboard, dataDirectory) {
  const snapshotDirectory = path.join(dataDirectory, 'snapshots');
  fs.mkdirSync(snapshotDirectory, { recursive: true });
  const file = path.join(snapshotDirectory, `${kstDay(dashboard.generatedAt)}.json`);
  fs.writeFileSync(file, JSON.stringify(comparableSnapshot(dashboard), null, 2));
  return file;
}
