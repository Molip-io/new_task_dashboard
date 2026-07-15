import fs from 'node:fs';
import path from 'node:path';

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
  const meetingErrors = errors.some(error => /회의록DB/.test(error));
  const slackErrors = errors.some(error => /Slack|SLACK_TOKEN|^#/.test(error));
  const projectCount = dashboard.projects.length;
  const meetingDates = (dashboard.meetings || []).map(meeting => meeting.date).filter(Boolean).sort();
  const specs = dashboard.projects.flatMap(project => project.specs || []);
  const reviewedSpecs = specs.filter(spec => spec.dependencyReviewStatus === 'confirmed' || spec.dependencyReviewStatus === 'none-confirmed');

  return {
    status: notionErrors || meetingErrors || slackErrors || collectedChannels.length < expectedChannels.length ? 'limited' : 'complete',
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
        status: sourceStatus(meetingErrors ? 0 : 1, 1, meetingErrors),
        successful: meetingErrors ? 0 : 1,
        expected: 1,
        lastSuccessAt: meetingErrors ? null : dashboard.generatedAt,
        lastEvidenceAt: meetingDates.at(-1) || null,
      },
    ],
    dependencyCoverage: specs.length > 0 ? {
      status: reviewedSpecs.length === specs.length ? 'complete' : 'partial',
      reviewed: reviewedSpecs.length,
      total: specs.length,
      rate: Math.round((reviewedSpecs.length / specs.length) * 100),
    } : {
      status: 'unmeasured',
      reviewed: 0,
      total: 0,
      rate: null,
    },
  };
}

function comparableSnapshot(dashboard) {
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
      })).sort((left, right) => left.id.localeCompare(right.id)),
    })).sort((left, right) => left.name.localeCompare(right.name)),
  };
}

function addDelta(deltas, project, field, from, to, task = null) {
  if (JSON.stringify(from) === JSON.stringify(to)) return;
  deltas.push({
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
      addDelta(deltas, project.name, 'task.status', priorTask.status, task.status, task);
      addDelta(deltas, project.name, 'task.due', priorTask.due, task.due, task);
      addDelta(deltas, project.name, 'task.assignees', priorTask.assignees, task.assignees, task);
    }
  }
  return deltas;
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

export function attachOperationalMetadata(dashboard, dataDirectory) {
  const current = comparableSnapshot(dashboard);
  const previous = loadPreviousSnapshot(dataDirectory, kstDay(dashboard.generatedAt));
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
    deltas: previous ? diffSnapshots(previous, current) : [],
  };
}

export function saveDailySnapshot(dashboard, dataDirectory) {
  const snapshotDirectory = path.join(dataDirectory, 'snapshots');
  fs.mkdirSync(snapshotDirectory, { recursive: true });
  const file = path.join(snapshotDirectory, `${kstDay(dashboard.generatedAt)}.json`);
  fs.writeFileSync(file, JSON.stringify(comparableSnapshot(dashboard), null, 2));
  return file;
}
