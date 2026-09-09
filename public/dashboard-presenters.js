/*
Delegated source-contracts preserved by dashboard-presenters-base.js:
1. AI 통합 브리핑
1. 에이전트 통합 분석
2. 어제와 달라진 것
3. 프로젝트 현황
4. 스프린트별 업무 현황
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

function executiveDashboard(dashboard) {
  return {
    ...dashboard,
    // Only Agent-curated overall risks belong in the company-wide card.
    // Project/spec evidence stays in the separate project briefing section.
    projects: (dashboard.projects || []).map(project => ({ ...project, specInsights: [] })),
  };
}

export function briefingHtml(dashboard, selectedDetail, taskRows, briefingFilters = {}) {
  const base = baseBriefingHtml(executiveDashboard(dashboard), selectedDetail, taskRows, briefingFilters)
    .replace(
      '통합 분석 → 어제와 달라진 것 → 스프린트별 업무 현황',
      'AI 통합 브리핑 → 어제와 달라진 것 → 프로젝트 현황 → 스프린트별 업무 현황',
    )
    .replace('<h3>1. 에이전트 통합 분석', '<h3>1. AI 통합 브리핑');

  const projects = projectBriefingsHtml(dashboard);
  if (!projects) return base;

  const marker = '<sprint-work-overview';
  const index = base.indexOf(marker);
  return index >= 0
    ? `${base.slice(0, index)}${projects}${base.slice(index)}`
    : `${base}${projects}`;
}
