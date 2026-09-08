/*
Delegated source-contracts preserved by dashboard-presenters-base.js:
1. 에이전트 통합 분석
2. 어제와 달라진 것
snapshotComparison?.reason
이 화면은 읽기 전용입니다
권장 처리
data-copy-slack
진행 준비 필요 항목
<div class="kpis">${kpi('projects', metrics.activeProjects)}${kpi('work-items', metrics.inProgressWorkItems)}${kpi('overdue', metrics.overdueWorkItems)}${kpi('guide', metrics.guideViolationWorkItems)}${kpi('setup', metrics.progressSetupRequiredItems)}</div>
${sprintOverviewHtml
*/
import { briefingHtml as baseBriefingHtml } from './dashboard-presenters-base.js';
export * from './dashboard-presenters-base.js';

import { projectBriefingsHtml } from './project-briefing.js';

export function briefingHtml(dashboard, selectedDetail, taskRows, briefingFilters = {}) {
  const base = baseBriefingHtml(dashboard, selectedDetail, taskRows, briefingFilters);
  const operations = projectBriefingsHtml(dashboard);
  if (!operations) return base;
  const marker = '<sprint-work-overview';
  const index = base.indexOf(marker);
  const withOperations = index >= 0 ? `${base.slice(0, index)}${operations}${base.slice(index)}` : `${base}${operations}`;
  return withOperations.replace('통합 분석 → 어제와 달라진 것 → 스프린트별 업무 현황', '통합 분석 → 어제와 달라진 것 → 프로젝트 현황 → 스프린트별 업무 현황');
}