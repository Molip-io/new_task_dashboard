/* Delegated exact-ID linking contract in dashboard-view-model-base.js:
item.specId && item.specId === spec.id
*/
export * from './dashboard-view-model-base.js';

const CLOSED_SPEC_STATUSES = new Set(['완료', '일시 정지', '정지', '중단']);

// Keep an active parent spec visible even when every registered child is complete.
// This is a management consistency signal: either the parent should be completed,
// or additional child work may still need to be registered. We do not infer which.
export function filterSpecsWithWorkItems(specs) {
  return specs.filter(spec => {
    const tasks = spec.tasks || [];
    if (!spec.status) return tasks.some(item => !CLOSED_SPEC_STATUSES.has(item?.status));
    return !CLOSED_SPEC_STATUSES.has(spec.status)
      || tasks.some(item => !CLOSED_SPEC_STATUSES.has(item?.status));
  });
}
