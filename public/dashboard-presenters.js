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

const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
const safeUrl = value => /^(https?:\/\/|#)/.test(String(value || '')) ? value : '#';
const fmt = value => value ? String(value).replace('T', ' ').slice(0, 16) : '-';

function signal(event, label) {
  if (!event) return `<div class="briefing-row"><strong>${esc(label)}</strong><small>수집 범위 내 직접 근거 없음</small></div>`;
  const body = `<strong>${esc(label)}</strong><small>${esc(event.excerpt || '')}</small><small>${fmt(event.timestamp)}${event.channel ? ` · #${esc(event.channel)}` : ''}</small>`;
  const url = safeUrl(event.url);
  return url === '#' ? `<div class="briefing-row">${body}</div>` : `<a class="briefing-row" href="${esc(url)}" target="_blank" rel="noreferrer">${body}</a>`;
}

function projectOperationsHtml(projects = []) {
  const rows = projects.map(project => {
    const ops = project.projectOperations || {};
    const hasEvidence = Boolean(ops.evidence?.length || ops.latestBuild || ops.latestQa || ops.latestRelease || ops.latestData);
    return `<div class="card span-6"><h3>${esc(project.name)} · 프로젝트 운영 현황</h3>${hasEvidence ? '' : '<div class="summary">최근 Slack 운영 근거를 찾지 못했습니다.</div>'}${signal(ops.latestBuild, '빌드')}${signal(ops.latestQa, 'QA/리뷰')}${signal(ops.latestRelease, '배포/출시')}${signal(ops.latestData, '데이터')}</div>`;
  }).join('');
  return rows ? `<div class="bento project-operations-bento">${rows}</div>` : '';
}

export function briefingHtml(dashboard, selectedDetail, taskRows, briefingFilters = {}) {
  const base = baseBriefingHtml(dashboard, selectedDetail, taskRows, briefingFilters);
  const operations = projectOperationsHtml(dashboard.projects || []);
  if (!operations) return base;
  const marker = '<sprint-work-overview';
  const index = base.indexOf(marker);
  const withOperations = index >= 0 ? `${base.slice(0, index)}${operations}${base.slice(index)}` : `${base}${operations}`;
  return withOperations.replace('통합 분석 → 어제와 달라진 것 → 스프린트별 업무 현황', '통합 분석 → 어제와 달라진 것 → 프로젝트 운영 현황 → 스프린트별 업무 현황');
}
