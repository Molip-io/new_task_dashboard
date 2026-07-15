function isChildTask(task) {
  return Array.isArray(task.parentIds) && task.parentIds.length > 0;
}

function normalizedName(value) {
  return String(value || '').replace(/\s+/g, '').toLowerCase();
}

export function selectProjectTasks(tasks, projects) {
  const selectedNames = new Set(projects.map(project => normalizedName(project.name)).filter(Boolean));
  return tasks.filter(task => selectedNames.has(normalizedName(task.project)));
}

export function excludePausedHierarchy(tasks) {
  const excludedIds = new Set(tasks
    .filter(task => normalizedName(task.status) === '일시정지')
    .map(task => task.id));

  let addedDescendant = true;
  while (addedDescendant) {
    addedDescendant = false;
    for (const task of tasks) {
      if (excludedIds.has(task.id)) continue;
      if ((task.parentIds || []).some(parentId => excludedIds.has(parentId))) {
        excludedIds.add(task.id);
        addedDescendant = true;
      }
    }
  }

  return tasks.filter(task => !excludedIds.has(task.id));
}

function normalizeReviewStatus(value) {
  const normalized = String(value || '').replace(/\s+/g, '').toLowerCase();
  if (['확정', '검토완료', 'confirmed'].includes(normalized)) return 'confirmed';
  if (['관계없음확인', '관계없음', 'none-confirmed'].includes(normalized)) return 'none-confirmed';
  return 'unreviewed';
}

function taskSummary(task, specTitle = null) {
  return {
    id: task.id,
    title: task.title,
    project: task.project,
    spec: specTitle,
    status: task.status,
    team: task.team,
    assignees: [...(task.assignees || [])],
    due: task.due || null,
    priority: task.priority || null,
    url: task.url || null,
  };
}

export function buildProjectSpecs(tasks, doneStatuses) {
  const done = new Set(doneStatuses);
  const childrenByParent = new Map();
  for (const task of tasks.filter(isChildTask)) {
    for (const parentId of task.parentIds) {
      const children = childrenByParent.get(parentId) || [];
      children.push(task);
      childrenByParent.set(parentId, children);
    }
  }

  return tasks.filter(task => !isChildTask(task)).map(spec => {
    const children = childrenByParent.get(spec.id) || [];
    const complete = children.filter(task => done.has(task.status));
    return {
      id: spec.id,
      title: spec.title,
      status: spec.status,
      core: spec.core !== false,
      owners: [...(spec.assignees || [])],
      scopeFreezePlannedAt: spec.scopeFreezePlannedAt || null,
      productionCompletePlannedAt: spec.productionCompletePlannedAt || null,
      targetAt: spec.targetAt || spec.due || null,
      dependencyIds: [...(spec.dependencyIds || [])],
      dependencyReviewStatus: normalizeReviewStatus(spec.dependencyReviewStatus),
      childStats: {
        total: children.length,
        done: complete.length,
        completionRate: children.length > 0 ? Math.round((complete.length / children.length) * 100) : 0,
        unassigned: children.filter(task => (task.assignees || []).length === 0).length,
      },
      tasks: children.map(task => taskSummary(task, spec.title)),
    };
  });
}

export function buildWorkload(tasks, doneStatuses) {
  const done = new Set(doneStatuses);
  const specs = new Map(tasks.filter(task => !isChildTask(task)).map(task => [task.id, task.title]));
  const childTasks = tasks.filter(isChildTask);
  const childTasksById = new Map(childTasks.map(task => [task.id, task]));
  const hasDependencyData = childTasks.some(task => (task.dependencyIds || []).length > 0);
  const downstreamWaitsByPerson = new Map();
  const people = new Map();
  const unassignedTasks = [];
  let personalTaskLinks = 0;

  for (const task of childTasks.filter(task => !done.has(task.status))) {
    const specTitle = task.parentIds.map(id => specs.get(id)).find(Boolean) || null;
    const assignees = task.assignees || [];
    if (assignees.length === 0) {
      unassignedTasks.push(taskSummary(task, specTitle));
      continue;
    }
    for (const assignee of assignees) {
      const person = people.get(assignee) || { name: assignee, teams: new Set(), tasks: [] };
      person.teams.add(task.team || '기타');
      person.tasks.push(taskSummary(task, specTitle));
      people.set(assignee, person);
      personalTaskLinks += 1;
    }
  }

  for (const downstream of childTasks.filter(task => !done.has(task.status))) {
    for (const dependencyId of downstream.dependencyIds || []) {
      const predecessor = childTasksById.get(dependencyId);
      if (!predecessor || done.has(predecessor.status)) continue;
      for (const assignee of predecessor.assignees || []) {
        const waits = downstreamWaitsByPerson.get(assignee) || [];
        if (!waits.some(task => task.id === downstream.id)) {
          waits.push(taskSummary(downstream, downstream.parentIds.map(id => specs.get(id)).find(Boolean) || null));
        }
        downstreamWaitsByPerson.set(assignee, waits);
      }
    }
  }

  const workload = [...people.values()].map(person => ({
    name: person.name,
    teams: [...person.teams],
    count: person.tasks.length,
    tasks: person.tasks,
    waitImpactMeasured: hasDependencyData,
    waitingOnMeCount: hasDependencyData ? (downstreamWaitsByPerson.get(person.name) || []).length : null,
    waitingTasks: hasDependencyData ? (downstreamWaitsByPerson.get(person.name) || []) : [],
  })).sort((left, right) => {
    if (hasDependencyData && right.waitingOnMeCount !== left.waitingOnMeCount) {
      return right.waitingOnMeCount - left.waitingOnMeCount;
    }
    return right.count - left.count;
  });

  return { workload, unassignedTasks, personalTaskLinks, waitImpactMeasured: hasDependencyData };
}
