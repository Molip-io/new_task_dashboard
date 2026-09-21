import { enrichValidationIssue } from './issue-catalog.mjs';

const CLOSED_PARENT = new Set(['완료', '일시 정지', '정지', '중단']);

export function enrichParentChildCompletion(validation, tasks = [], detectedAt = new Date().toISOString()) {
  const childrenByParent = new Map();
  for (const task of tasks.filter(item => (item.parentIds || []).length > 0)) {
    for (const parentId of task.parentIds || []) {
      const rows = childrenByParent.get(parentId) || [];
      rows.push(task);
      childrenByParent.set(parentId, rows);
    }
  }
  const existing = new Set((validation.issues || []).map(issue => `${issue.type}:${issue.specId || ''}`));
  for (const parent of tasks.filter(item => !(item.parentIds || []).length && !CLOSED_PARENT.has(item.status))) {
    const children = childrenByParent.get(parent.id) || [];
    if (!children.length || !children.every(child => child.status === '완료')) continue;
    const key = `PARENT_CHILD_STATUS_MISMATCH:${parent.id}`;
    if (existing.has(key)) continue;
    const issue = enrichValidationIssue({
      id: key,
      type: 'PARENT_CHILD_STATUS_MISMATCH',
      severity: 'check',
      message: `상위 작업은 ${parent.status || '상태 미정'}이지만 등록된 하위 작업항목 ${children.length}건이 모두 완료 상태`,
      project: parent.project || null,
      specId: parent.id,
      workItemId: null,
      detectedAt,
      recommendedAction: '상위 작업을 완료 처리할지, 추가 하위 작업항목이 누락됐는지 확인하세요.',
      metadata: { rule: 'parent-child-completion', parentStatus: parent.status || null, childCount: children.length, completedChildCount: children.length },
    });
    validation.issues.push(issue);
    const ruleItem = (validation.ruleItems || []).find(item => item.id === parent.id);
    if (ruleItem) {
      ruleItem.issues = [...(ruleItem.issues || []), issue];
      ruleItem.riskScore = (ruleItem.riskScore || 0) + 10;
      if (!['error', 'warning'].includes(ruleItem.guideStatus)) ruleItem.guideStatus = 'check';
    }
    existing.add(key);
  }
  return validation;
}
