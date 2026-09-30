// Work items whose Notion state was left behind by their spec: the spec is done or
// cancelled but the item is still open, or the item's Sprint tag no longer matches the
// spec it belongs to. Found before collection drops done specs and their children, so
// the items a closed spec left open are still visible here.
import { normalizeSprint } from './sprint-rules.mjs';

const CLOSED = new Set(['완료', '중단']);

export function findUpdateGaps(tasks) {
  const byId = new Map(tasks.map(task => [task.id, task]));
  const gaps = [];
  for (const task of tasks) {
    const specId = (task.parentIds || [])[0];
    if (!specId || CLOSED.has(task.status)) continue;
    const spec = byId.get(specId);
    if (!spec || (spec.parentIds || []).length) continue;
    const base = {
      workItemId: task.id,
      specId: spec.id,
      project: task.project || spec.project || null,
      title: task.title || null,
      url: task.url || null,
      status: task.status || null,
      assignees: task.assignees || [],
      team: task.team || null,
      specTitle: spec.title || null,
      specStatus: spec.status || null,
      sprint: task.sprint || null,
      specSprint: spec.sprint || null,
    };
    if (CLOSED.has(spec.status)) gaps.push({ ...base, kind: 'open-under-closed-spec' });
    else if (task.sprint && spec.sprint && normalizeSprint(task.sprint) !== normalizeSprint(spec.sprint)) gaps.push({ ...base, kind: 'sprint-mismatch' });
  }
  return gaps;
}
