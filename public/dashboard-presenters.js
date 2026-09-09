/*
Delegated source-contracts preserved by dashboard-presenters-base.js:
1. AI 통합 브리핑
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

function executiveDashboard(dashboard) {
  return {
    ...dashboard,
    // The executive card must use Agent-curated overall.topRisks only.
    // Project/spec evidence remains available in the project briefing below,
    // but is not promoted into the company-wide summary a second time.
    projects: (dashboard.projects || []).map(project => ({ ...project, specInsights: [] })),
  };
}

function integratedProjectBriefings(dashboard) {
  const html = projectBriefingsHtml(dashboard);
  if (!html) return '';
  return html
    .replace('<section class="project-briefings"', '<section class="project-briefings project-briefings-integrated"')
    .replace('<h3 class="project-briefings-title">3. 프로젝트 현황</h3>', '<h4 class="project-briefings-title">프로젝트별 현황</h4>')
    .replace(
      '모든 관련 근거를 Agent가 종합한 현재 진행 · 빌드·출시 · 데이터 브리핑입니다. 원문은 ‘근거 보기’에서 확인합니다.',
      '전체 통합 요약 아래에서 각 프로젝트의 현재 진행 · 빌드·출시 · 데이터 · 병목 · 다음 행동을 이어서 확인합니다. 원문은 ‘근거 보기’에서 확인합니다.',
    );
}

export function briefingHtml(dashboard, selectedDetail, taskRows, briefingFilters = {}) {
  let html = baseBriefingHtml(executiveDashboard(dashboard), selectedDetail, taskRows, briefingFilters);

  html = html
    .replace('통합 분석 → 어제와 달라진 것 → 스프린트별 업무 현황', 'AI 통합 브리핑 → 어제와 달라진 것 → 스프린트별 업무 현황')
    .replace('<h3>1. 에이전트 통합 분석', '<h3>1. AI 통합 브리핑')
    .replace('<div class="card span-6"><h3>1. AI 통합 브리핑', '<div class="card span-12 ai-integrated-briefing-card"><h3>1. AI 통합 브리핑')
    .replace('<div class="card span-6"><h3>2. 어제와 달라진 것', '<div class="card span-12"><h3>2. 어제와 달라진 것');

  const projects = integratedProjectBriefings(dashboard);
  if (!projects) return html;

  const secondCard = '<div class="card span-12"><h3>2. 어제와 달라진 것';
  const boundary = `</div>\n    ${secondCard}`;
  if (!html.includes(boundary)) return html;

  return html.replace(boundary, `${projects}</div>\n    ${secondCard}`);
}